// Read-only tools the chat model may call. Each one is a Zod-validated wrapper
// over existing queries, bound to the workspace of the session (the model
// never passes a workspace id). Parameters are enums/limits, results are
// capped, free text is sanitized. There are no write tools.
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../db/client.js'
import { aiReports, incidents, kols, tasks } from '../../../db/schema/index.js'
import { composeReport } from '../report/build.js'
import { sanitize } from '../report/sections.js'
import { PERIOD_KINDS, type PeriodKind, type Report, type Scope, type SectionId } from '../report/template.js'
import { searchHelp } from './help.js'

export interface ToolContext {
  workspace: { id: string; name: string }
  now: Date
}

export interface ToolDef<I extends z.ZodType = z.ZodType> {
  name: string
  description: string
  input: I
  run: (args: z.infer<I>, ctx: ToolContext) => Promise<unknown>
}
// Keeps per-tool argument types while storing heterogeneous tools in one list.
const tool = <I extends z.ZodType>(t: ToolDef<I>): ToolDef => t as unknown as ToolDef

const MAX_RESULT_BYTES = 4 * 1024
const period = z.enum(PERIOD_KINDS).default('30d').describe('Reporting window ending today')

// Report composition is the backbone: one cached computation per (workspace,
// period) serves several tools during a single chat turn.
type Composed = Awaited<ReturnType<typeof composeReport>>
const composeCache = new Map<string, Promise<Composed>>()
async function compose(ctx: ToolContext, p: PeriodKind, scope: Scope = 'overview') {
  const key = `${ctx.workspace.id}:${p}:${scope}:${ctx.now.toISOString().slice(0, 13)}`
  let hit = composeCache.get(key)
  if (!hit) {
    hit = composeReport({ workspace: ctx.workspace, period: p, scope, now: ctx.now })
    composeCache.set(key, hit)
    setTimeout(() => composeCache.delete(key), 5 * 60_000).unref()
  }
  return hit
}

const section = (r: Omit<Report, 'generatedAt'>, id: SectionId) => r.sections.find((s) => s.id === id)
const compactSection = (r: Omit<Report, 'generatedAt'>, id: SectionId) => {
  const s = section(r, id)
  if (!s) return null
  return { id: s.id, state: s.state, stateReason: s.stateReason, note: s.note, metrics: s.metrics.map((m) => ({ id: m.id, label: m.label, value: m.value, prev: m.prev, unit: m.unit, deltaPct: m.deltaPct })), insights: s.insights.map((i) => ({ id: i.id, severity: i.severity, text: i.text })), tables: s.tables }
}

export const TOOLS: ToolDef[] = [
  tool({
    name: 'get_overview',
    description: 'Headline metrics for every section (growth, engagement, moderation, incidents, KOLs, operations) for a period, each compared with the previous period of equal length, plus rule-detected insights and the executive summary. Start here for any "how is the community doing" question.',
    input: z.object({ period }),
    run: async ({ period: p }, ctx) => {
      const { body } = await compose(ctx, p as PeriodKind)
      return {
        period: body.period,
        coverage: body.coverage,
        summary: body.summary,
        sections: body.sections.map((s) => ({ id: s.id, state: s.state, metrics: s.metrics.slice(0, 6).map((m) => ({ id: m.id, label: m.label, value: m.value, prev: m.prev, unit: m.unit, deltaPct: m.deltaPct })), insights: s.insights.map((i) => i.text) })),
        recommendations: body.recommendations.map((r) => ({ title: r.title, priority: r.priority, metricIds: r.metricIds })),
      }
    },
  }),
  tool({
    name: 'get_section',
    description: 'Full detail of one report section for a period: all metrics with previous-period comparison, insights and tables (e.g. moderator activity table, most active members, incidents by type).',
    input: z.object({ section: z.enum(['growth', 'engagement', 'moderation', 'incidents', 'kols', 'operations', 'sentiment']), period }),
    run: async ({ section: id, period: p }, ctx) => {
      const { body } = await compose(ctx, p as PeriodKind)
      return compactSection(body, id as SectionId)
    },
  }),
  tool({
    name: 'get_metric_series',
    description: 'Daily series for a metric over a period: members per platform, messages per day, or messages by UTC hour.',
    input: z.object({ series: z.enum(['members', 'messages_daily', 'messages_hourly']), period }),
    run: async ({ series, period: p }, ctx) => {
      const { body } = await compose(ctx, p as PeriodKind)
      const growth = section(body, 'growth')
      const eng = section(body, 'engagement')
      const pick = series === 'members' ? (growth?.series ?? []) : series === 'messages_daily' ? (eng?.series ?? []).filter((s) => s.id === 'engagement.daily') : (eng?.series ?? []).filter((s) => s.id === 'engagement.hourly')
      // Downsample long series so the result stays small.
      return pick.map((s) => ({ id: s.id, label: s.label, points: s.points.length > 45 ? s.points.filter((_, i) => i % Math.ceil(s.points.length / 45) === 0) : s.points }))
    },
  }),
  tool({
    name: 'get_moderators',
    description: 'Per-moderator activity for a period: messages, active days, punctuality, no-shows, plus the uncovered peak hours. Use for questions about the team or a specific moderator.',
    input: z.object({ period }),
    run: async ({ period: p }, ctx) => {
      const { body } = await compose(ctx, p as PeriodKind, 'moderation')
      return compactSection(body, 'moderation')
    },
  }),
  tool({
    name: 'list_incidents',
    description: 'Most recent moderation incidents (date, type, channel, status, action taken), optionally filtered by status.',
    input: z.object({ status: z.enum(['Open', 'Resolved', 'Escalated']).optional(), limit: z.number().int().min(1).max(25).default(10) }),
    run: async ({ status, limit }, ctx) => {
      const rows = await db
        .select({ date: incidents.date, type: incidents.type, channel: incidents.channel, status: incidents.status, actionTaken: incidents.actionTaken })
        .from(incidents)
        .where(and(eq(incidents.workspaceId, ctx.workspace.id), ...(status ? [eq(incidents.status, status)] : [])))
        .orderBy(desc(incidents.date))
        .limit(limit)
      return rows.map((r) => ({ ...r, type: sanitize(r.type, 40), channel: sanitize(r.channel, 40), actionTaken: sanitize(r.actionTaken, 120) || null }))
    },
  }),
  tool({
    name: 'list_kols',
    description: 'Tracked KOLs with status, channel, reach and last activity date.',
    input: z.object({ limit: z.number().int().min(1).max(25).default(15) }),
    run: async ({ limit }, ctx) => {
      const rows = await db.select({ name: kols.name, handle: kols.handle, channel: kols.channel, reach: kols.reach, status: kols.status, lastActivity: kols.lastActivity }).from(kols).where(eq(kols.workspaceId, ctx.workspace.id)).orderBy(desc(kols.reach)).limit(limit)
      return rows.map((r) => ({ ...r, name: sanitize(r.name, 40), handle: sanitize(r.handle, 40) || null, channel: sanitize(r.channel, 30) || null, status: sanitize(r.status, 20) }))
    },
  }),
  tool({
    name: 'list_tasks',
    description: 'Tasks with status, priority, assignee and due date; optionally only overdue or by status.',
    input: z.object({ status: z.enum(['To Do', 'In Progress', 'Review', 'Done']).optional(), overdueOnly: z.boolean().default(false), limit: z.number().int().min(1).max(25).default(15) }),
    run: async ({ status, overdueOnly, limit }, ctx) => {
      const rows = await db
        .select({ title: tasks.title, assignee: tasks.assignee, area: tasks.area, priority: tasks.priority, status: tasks.status, dueDate: tasks.dueDate })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, ctx.workspace.id), ...(status ? [eq(tasks.status, status)] : []), ...(overdueOnly ? [sql`${tasks.dueDate} < current_date and ${tasks.status} <> 'Done'`] : [])))
        .orderBy(desc(tasks.updatedAt))
        .limit(limit)
      return rows.map((r) => ({ ...r, title: sanitize(r.title, 80), assignee: sanitize(r.assignee, 40) || null, area: sanitize(r.area, 30) || null }))
    },
  }),
  tool({
    name: 'get_latest_report',
    description: 'The most recent generated report for this workspace: period, executive summary, recommendations and per-section notes. Use when the user refers to "the report".',
    input: z.object({}),
    run: async (_a, ctx) => {
      const [row] = await db.select({ report: aiReports.report, createdAt: aiReports.createdAt }).from(aiReports).where(eq(aiReports.workspaceId, ctx.workspace.id)).orderBy(desc(aiReports.createdAt)).limit(1)
      if (!row) return { found: false }
      const r = row.report as unknown as Report
      return { found: true, generatedAt: r.generatedAt, period: r.period, scope: r.scope, summary: r.summary, notes: Object.fromEntries(r.sections.map((s) => [s.id, s.note])), recommendations: r.recommendations.map((x) => ({ title: x.title, priority: x.priority, rationale: x.rationale })) }
    },
  }),
  tool({
    name: 'search_help',
    description: 'Search the Catch product documentation: how features work, how metrics are defined, how to connect a platform, plan limits. Use for any "how do I / what does X mean" question.',
    input: z.object({ query: z.string().min(2).max(200) }),
    run: async ({ query }) => searchHelp(query, 3),
  }),
]

/** Anthropic tool definitions (JSON schema from Zod). Stable order → cacheable prefix. */
export function toolDefinitions() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: z.toJSONSchema(t.input) as Record<string, unknown> & { type: 'object' } }))
}

export interface ToolRunRecord {
  name: string
  input: Record<string, unknown>
  ok: boolean
  ms: number
}

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; record: ToolRunRecord }> {
  const t0 = Date.now()
  const tool = TOOLS.find((x) => x.name === name)
  if (!tool) return { content: JSON.stringify({ error: `unknown tool ${name}` }), record: { name, input: {}, ok: false, ms: 0 } }
  const parsed = tool.input.safeParse(rawInput ?? {})
  if (!parsed.success) return { content: JSON.stringify({ error: 'invalid arguments', issues: parsed.error.issues.map((i) => i.message).slice(0, 5) }), record: { name, input: {}, ok: false, ms: Date.now() - t0 } }
  try {
    const result = await tool.run(parsed.data, ctx)
    let content = JSON.stringify({ source: 'workspace_data', data: result })
    if (content.length > MAX_RESULT_BYTES) content = content.slice(0, MAX_RESULT_BYTES - 20) + '…"truncated":true}'
    return { content, record: { name, input: parsed.data as Record<string, unknown>, ok: true, ms: Date.now() - t0 } }
  } catch (err) {
    return { content: JSON.stringify({ error: 'tool failed', message: err instanceof Error ? err.message.slice(0, 200) : 'error' }), record: { name, input: parsed.data as Record<string, unknown>, ok: false, ms: Date.now() - t0 } }
  }
}

// Tool-name → "what I'm doing" label for progress events in the UI.
export const TOOL_LABELS: Record<string, string> = {
  get_overview: 'Reading the overview',
  get_section: 'Reading a report section',
  get_metric_series: 'Fetching the series',
  get_moderators: 'Checking moderator activity',
  list_incidents: 'Listing incidents',
  list_kols: 'Listing KOLs',
  list_tasks: 'Listing tasks',
  get_latest_report: 'Opening the latest report',
  search_help: 'Searching the documentation',
}

