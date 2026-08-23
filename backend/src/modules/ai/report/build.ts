// buildReport(): metrics → sections → insights → rule narrative → stored row.
// P2 adds an optional generative narrative between "insights" and "stored";
// everything before that stays byte-for-byte deterministic.
import { createHash } from 'node:crypto'
import { logger } from '../../../logger.js'
import { aiLog } from '../debug.js'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../../db/client.js'
import { aiReports, type AiReportRow } from '../../../db/schema/index.js'
import { runInsights, SEVERITY_RANK } from './insights.js'
import { collect, windows, windowsFor } from './metrics.js'
import { buildSections } from './sections.js'
import { applyNarrative, buildPack, callModel as defaultCallModel, gate, type CallModel } from './narrative.js'
import { aiEnabled, recordUsage, REPORT_EVENT, REPORT_MONTHLY_QUOTA, reportModel, reportNarrativesThisMonth } from '../llm.js'
import type { PlanTier } from '../../../lib/quota.js'
import { PERIOD_DAYS, REPORT_VERSION, SCOPE_SECTIONS, type Insight, type PeriodKind, type Recommendation, type Report, type ReportPlatform, type Scope, type Section, type SectionId } from './template.js'

export interface BuildOptions {
  workspace: { id: string; name: string }
  /** Preset period, or 'custom' with explicit range. */
  period: PeriodKind
  range?: { start: string; end: string }
  scope?: Scope
  platform?: ReportPlatform | null
  userId: string | null
  /** Plan of the caller (quota for AI narrative). Omit = rules only. */
  plan?: PlanTier
  now?: Date
  /** Reuse a stored report when the inputs have not changed (default true). */
  reuse?: boolean
  /** Test seam. */
  callModel?: CallModel
}

/** Deterministic part only: metrics → sections → rule narrative. No storage, no model. */
export async function composeReport(o: Pick<BuildOptions, 'workspace' | 'period' | 'range' | 'scope' | 'platform' | 'now'>) {
  const now = o.now ?? new Date()
  const scope = o.scope ?? 'overview'
  const platform = o.platform ?? null
  const { cur, prev } = o.period === 'custom' ? windowsFor(o.range!.start, o.range!.end) : windows(PERIOD_DAYS[o.period as Exclude<PeriodKind, 'custom'>], now)
  const data = await collect(o.workspace.id, cur, prev, platform ? [platform] : null)
  const sections = buildSections(data)
  const included = new Set<SectionId>(SCOPE_SECTIONS[scope])
  const insights = runInsights(sections).filter((i) => included.has(i.sectionId))
  for (const s of Object.values(sections)) {
    s.insights = insights.filter((i) => i.sectionId === s.id)
    s.note = ruleNote(s)
  }
  const ordered = SCOPE_SECTIONS[scope].map((id) => sections[id])
  const body = {
    version: REPORT_VERSION,
    workspace: o.workspace,
    period: { kind: o.period, days: cur.days, start: cur.start, end: cur.end, prevStart: prev.start, prevEnd: prev.end },
    scope,
    platform,
    coverage: data.coverage,
    summary: ruleSummary(ordered, insights),
    sections: ordered,
    recommendations: ruleRecommendations(insights),
    methodology: methodology(data.coverage, cur.days),
    narrativeSource: 'rules' as Report['narrativeSource'],
    narrativeMeta: { reason: 'disabled', llmSlots: 0, totalSlots: 2 + ordered.filter((s) => s.state === 'ok').length, model: null } as Report['narrativeMeta'],
  }
  return { body, cur, prev, scope, sections, data }
}

export async function buildReport(o: BuildOptions): Promise<{ report: Report; id: string; reused: boolean }> {
  const now = o.now ?? new Date()
  const { body, cur, scope } = await composeReport(o)
  // Hash covers the deterministic part only (rules narrative, no generatedAt),
  // so an unchanged dataset maps to one stored report per narrative source.
  const inputHash = createHash('sha256').update(JSON.stringify({ ...body, narrativeMeta: undefined })).digest('hex')

  // Can we narrate with the model? Quota is monthly, per workspace.
  let wantLlm = aiEnabled() && !!o.plan
  let quotaReason: Report['narrativeMeta']['reason'] = 'disabled'
  if (wantLlm) {
    const used = await reportNarrativesThisMonth(o.workspace.id, now)
    if (used >= REPORT_MONTHLY_QUOTA[o.plan!]) {
      wantLlm = false
      quotaReason = 'quota'
    }
  }

  if (o.reuse !== false) {
    const rows = await db
      .select()
      .from(aiReports)
      .where(and(eq(aiReports.workspaceId, o.workspace.id), eq(aiReports.inputHash, inputHash)))
      .orderBy(desc(aiReports.createdAt))
      .limit(5)
    // An AI-narrated copy of the same data is always the best one to reuse;
    // a rules copy is reused only when we could not do better now.
    const llmRow = rows.find((r) => r.narrativeSource === 'llm')
    const rulesRow = rows.find((r) => r.narrativeSource === 'rules')
    const hit = llmRow ?? (wantLlm ? undefined : rulesRow)
    aiLog('report.cache', { workspaceId: o.workspace.id, period: o.period, scope, hit: hit ? hit.narrativeSource : null, wantLlm, quotaReason })
    if (hit) return { report: hit.report as unknown as Report, id: hit.id, reused: true }
  }

  let narrativeSource: Report['narrativeSource'] = 'rules'
  let usage: { model: string; input: number; output: number } | null = null
  body.narrativeMeta.reason = quotaReason
  if (wantLlm) {
    const pack = buildPack(body)
    try {
      const res = await (o.callModel ?? defaultCallModel)(pack, SCOPE_SECTIONS[scope] as SectionId[])
      await recordUsage({ workspaceId: o.workspace.id, userId: o.userId, eventType: REPORT_EVENT, usage: res.usage, metadata: { stop: res.stop, period: o.period, scope } })
      usage = { model: res.usage.model, input: res.usage.input, output: res.usage.output }
      if (res.narrative) {
        const g = gate(pack, res.narrative)
        const { llmSlots, totalSlots } = applyNarrative(body, g)
        narrativeSource = llmSlots > 0 ? 'llm' : 'rules'
        body.narrativeSource = narrativeSource
        body.narrativeMeta = { reason: llmSlots === 0 ? 'gated' : llmSlots < totalSlots ? 'partial' : 'ok', llmSlots, totalSlots, model: res.usage.model }
      } else {
        body.narrativeMeta = { reason: 'failed', llmSlots: 0, totalSlots: body.narrativeMeta.totalSlots, model: res.usage.model }
      }
    } catch (err) {
      logger.error({ err }, 'report narrative call failed; using rule narrative')
      body.narrativeMeta = { reason: 'failed', llmSlots: 0, totalSlots: body.narrativeMeta.totalSlots, model: reportModel() }
    }
  }

  aiLog('report.built', { workspaceId: o.workspace.id, period: o.period, scope, narrativeSource, meta: body.narrativeMeta, sections: body.sections.map((s) => `${s.id}:${s.state}`), insights: body.sections.reduce((n, s) => n + s.insights.length, 0) })
  const report: Report = { ...body, generatedAt: now.toISOString() }
  const [row] = await db
    .insert(aiReports)
    .values({
      workspaceId: o.workspace.id,
      periodKind: o.period,
      periodStart: cur.start,
      periodEnd: cur.end,
      inputHash,
      report: report as unknown as Record<string, unknown>,
      narrativeSource,
      model: usage?.model ?? null,
      inputTokens: usage?.input ?? null,
      outputTokens: usage?.output ?? null,
      createdBy: o.userId,
    })
    .returning({ id: aiReports.id })
  return { report, id: row!.id, reused: false }
}

export async function listReports(workspaceId: string, limit = 20): Promise<Pick<AiReportRow, 'id' | 'periodKind' | 'periodStart' | 'periodEnd' | 'narrativeSource' | 'createdAt' | 'report'>[]> {
  return db
    .select({ id: aiReports.id, periodKind: aiReports.periodKind, periodStart: aiReports.periodStart, periodEnd: aiReports.periodEnd, narrativeSource: aiReports.narrativeSource, createdAt: aiReports.createdAt, report: aiReports.report })
    .from(aiReports)
    .where(eq(aiReports.workspaceId, workspaceId))
    .orderBy(desc(aiReports.createdAt))
    .limit(limit)
}

export async function getReport(workspaceId: string, id: string): Promise<AiReportRow | undefined> {
  const [row] = await db.select().from(aiReports).where(and(eq(aiReports.workspaceId, workspaceId), eq(aiReports.id, id))).limit(1)
  return row
}

// ---- rule narrative ---------------------------------------------------------

function ruleNote(s: Section): string {
  if (s.state !== 'ok') return s.stateReason ?? ''
  const sorted = [...s.insights].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  if (sorted.length === 0) return 'No notable change against the previous period.'
  return sorted
    .slice(0, 3)
    .map((i) => i.text)
    .join(' ')
}

function ruleSummary(sections: Section[], insights: Insight[]): string[] {
  const sorted = [...insights].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  const lines = sorted.slice(0, 3).map((i) => i.text)
  const okCount = sections.filter((s) => s.state === 'ok').length
  while (lines.length < 3) {
    if (lines.length === 0) lines.push(`${okCount} of ${sections.length} report sections have data for this period; no threshold was crossed.`)
    else if (lines.length === 1) lines.push(`${insights.filter((i) => i.severity === 'critical' || i.severity === 'warning').length} item${insights.length === 1 ? '' : 's'} need attention, ${insights.filter((i) => i.severity === 'positive').length} positive signal${insights.filter((i) => i.severity === 'positive').length === 1 ? '' : 's'}.`)
    else lines.push('Every figure in this report is computed directly from synced platform data for the stated period.')
  }
  return lines
}

const ACTIONS: Record<string, { title: string; rationale: string; priority: Recommendation['priority'] }> = {
  'moderation.coverageGap': { title: 'Schedule a moderator on the uncovered peak hours', rationale: 'Activity peaks where no shift is planned; response times and incident handling suffer most there.', priority: 'high' },
  'moderation.noShows': { title: 'Follow up on missed shifts', rationale: 'No-show shifts leave the community unattended during planned coverage.', priority: 'high' },
  'moderation.punctuality.low': { title: 'Review shift start times with the team', rationale: 'Low punctuality usually means the shift window does not match the moderator’s timezone.', priority: 'medium' },
  'moderation.inactive': { title: 'Fix moderator handles that do not match platform names', rationale: 'Unmatched moderators show zero activity and distort performance and compensation.', priority: 'medium' },
  'moderation.share': { title: 'Run a member-led activity (AMA, contest) to shift conversation to members', rationale: 'Staff is carrying the conversation; member-driven threads retain better.', priority: 'medium' },
  'growth.negative': { title: 'Investigate the drop in members and pause paid acquisition until it is explained', rationale: 'Net loss while spending on growth wastes budget.', priority: 'high' },
  'growth.churn.high': { title: 'Add an onboarding flow for new joiners', rationale: 'High leave rate within the period points to weak first-week experience.', priority: 'high' },
  'growth.platform.divergence': { title: 'Cross-promote the shrinking platform from the growing one', rationale: 'Members are migrating between platforms; the shrinking one risks going silent.', priority: 'medium' },
  'engagement.rate.low': { title: 'Launch a recurring engagement format (weekly thread, quests)', rationale: 'A small active core inside a large base is the typical pre-churn pattern.', priority: 'high' },
  'engagement.messages.change': { title: 'Compare this period’s content calendar with the previous one', rationale: 'Large swings in volume usually follow campaign or content changes.', priority: 'low' },
  'engagement.concentration': { title: 'Align content publishing with the peak hours', rationale: 'Posts landing in the busiest window get the most reach.', priority: 'low' },
  'incidents.spike': { title: 'Review the incident types driving the spike and update moderation rules', rationale: 'A doubling of incidents signals a new pattern (raid, scam wave) rather than noise.', priority: 'high' },
  'incidents.stale': { title: 'Close or escalate incidents open for more than 72 hours', rationale: 'Stale incidents erode trust and skew the resolution rate.', priority: 'medium' },
  'incidents.resolution': { title: 'Assign an owner to unresolved incidents', rationale: 'Low resolution rate means issues are logged but not worked.', priority: 'medium' },
  'kols.inactive': { title: 'Re-engage or replace inactive KOLs', rationale: 'Tracked KOLs without activity add no reach.', priority: 'medium' },
  'operations.overdue': { title: 'Clear or re-plan overdue tasks', rationale: 'Overdue items accumulate and hide real blockers.', priority: 'medium' },
  'operations.completion.low': { title: 'Reduce open tasks to what the team can finish this period', rationale: 'Low completion with many tasks means over-commitment, not low effort.', priority: 'low' },
  'operations.content.adherence': { title: 'Review the content calendar for items that keep slipping', rationale: 'Missed publishing dates reduce consistency, which drives engagement.', priority: 'medium' },
}

function ruleRecommendations(insights: Insight[]): Recommendation[] {
  const sorted = [...insights].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  const out: Recommendation[] = []
  for (const i of sorted) {
    const a = ACTIONS[i.id]
    if (!a) continue
    out.push({ id: `rec.${i.id}`, title: a.title, rationale: a.rationale, priority: a.priority, metricIds: i.metricIds, insightIds: [i.id] })
    if (out.length === 5) break
  }
  const rank = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) => rank[a.priority] - rank[b.priority])
}

function methodology(c: Report['coverage'], days: number): string[] {
  const lines = [
    `Period of ${days} days compared with the ${days} days before it; all days are UTC calendar days.`,
    `Membership comes from daily platform snapshots (${c.daysWithData} of ${c.periodDays} days have data). Net growth is last minus first snapshot in the period.`,
    'Messages and active members come from per-member daily counts; message text is never stored.',
    'Moderator activity is matched by platform handle; punctuality uses a 15-minute tolerance on the configured UTC shift window.',
    'Sentiment is not collected yet.',
  ]
  for (const p of c.platforms) if (p.status !== 'connected') lines.push(`${p.platform} is ${p.status}; its figures are absent.`)
  for (const p of c.platforms) if (p.lastError) lines.push(`${p.platform}: last sync reported an error.`)
  return lines
}

export type { Report, Section, SectionId }
