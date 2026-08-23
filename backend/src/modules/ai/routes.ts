import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { and, count, eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { integrations, usageEvents } from '../../db/schema/index.js'
import { HttpError } from '../../lib/errors.js'
import type { PlanTier } from '../../lib/quota.js'
import { buildReport, getReport, listReports } from './report/build.js'
import { aiEnabled, REPORT_MONTHLY_QUOTA, reportModel, reportNarrativesThisMonth } from './llm.js'
import { CHAT_DAILY_QUOTA, CHAT_EVENT, chatTurn, deleteConversation, getConversation, listConversations } from './chat/run.js'
import { PERIOD_KINDS, REPORT_PLATFORMS, SCOPES } from './report/template.js'

// Catch Intelligence — the only generative call in the product. The model
// sees a snapshot of numbers the client already computed and writes prose
// over them; it never touches the database (BP §9.2). Cost governance
// (BP §9.3): closed operation list, per-call caps, per-plan daily quota,
// every call recorded in usage_events.

const SYSTEM = `You write the "Status Update" briefing for a Web3 community manager who is about to walk into a call. They need to sound informed in fifteen seconds.
You receive a JSON snapshot of REAL measurements from their connected platforms. Your only job is to turn those numbers into prose.
Hard rules — these matter more than style:
- Use ONLY numbers present in the snapshot. Never estimate, extrapolate, or invent a figure.
- Never assert a cause. "Retention fell and the evening shift was uncovered" is allowed; "retention fell BECAUSE the shift was uncovered" is not — you cannot see causation in this data.
- If the snapshot is thin or a metric is missing, say so plainly. "Telegram has no history yet" is a useful sentence; a confident summary built on one data point is not.
- Never mention a platform that is not in the snapshot.
Style: direct, specific, no filler. Lead with what changed or what needs attention, not with a greeting. No emoji. Name the platform when you cite a number.`

const StatusUpdate = z.object({
  headline: z.string().describe('One line, max ~70 characters. The single most important thing right now.'),
  body: z.string().describe('Two to four sentences covering scale, the notable movers, and anything that needs attention.'),
  watch: z.array(z.string()).describe('Zero to three short bullets, each one specific thing to keep an eye on. Empty when nothing warrants it.'),
})

export const DAILY_QUOTA: Record<PlanTier, number> = { starter: 10, pro: 50, agency: 200, enterprise: 1000 }
const MAX_SNAPSHOT_BYTES = 32 * 1024
const EVENT = 'ai_status_update'

export async function usedToday(userId: string, eventType = EVENT): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const [row] = await db.select({ n: count() }).from(usageEvents).where(and(eq(usageEvents.userId, userId), eq(usageEvents.eventType, eventType), gte(usageEvents.occurredAt, since)))
  return row?.n ?? 0
}

export async function aiRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get('/workspaces/:workspaceId/ai/quota', { preHandler: app.requireWorkspace, schema: { params: z.object({ workspaceId: z.uuid() }) } }, async (req) => {
    const plan = (req.auth!.user.plan ?? 'starter') as PlanTier
    const used = await usedToday(req.auth!.user.id)
    const reportsUsed = await reportNarrativesThisMonth(req.workspace.id)
    const chatUsed = await usedToday(req.auth!.user.id, CHAT_EVENT)
    return { used, limit: DAILY_QUOTA[plan], configured: aiEnabled(), model: config.LLM_MODEL, reports: { used: reportsUsed, limit: REPORT_MONTHLY_QUOTA[plan], model: reportModel() }, chat: { used: chatUsed, limit: CHAT_DAILY_QUOTA[plan] } }
  })

  r.post(
    '/workspaces/:workspaceId/ai/status-update',
    { preHandler: app.requireWorkspace, config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { params: z.object({ workspaceId: z.uuid() }), body: z.object({ snapshot: z.record(z.string(), z.unknown()), lang: z.enum(['en', 'pt']).default('en') }) } },
    async (req) => {
      if (!config.ANTHROPIC_API_KEY) throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI summaries are not configured on this deployment')
      const snapshotJson = JSON.stringify(req.body.snapshot, null, 1)
      if (Buffer.byteLength(snapshotJson) > MAX_SNAPSHOT_BYTES) throw new HttpError(413, 'SNAPSHOT_TOO_LARGE', 'Snapshot exceeds 32 KB')

      const plan = (req.auth!.user.plan ?? 'starter') as PlanTier
      const used = await usedToday(req.auth!.user.id)
      if (used >= DAILY_QUOTA[plan]) throw new HttpError(429, 'AI_QUOTA_EXCEEDED', `Daily limit of ${DAILY_QUOTA[plan]} summaries reached for the ${plan} plan`)

      const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 60_000 })
      const language = req.body.lang === 'pt' ? 'Brazilian Portuguese' : 'English'
      const response = await client.messages.parse({
        model: config.LLM_MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(StatusUpdate) },
        messages: [{ role: 'user', content: `Write the status update in ${language}.\n\nSnapshot:\n${snapshotJson}` }],
      })

      await db.insert(usageEvents).values({
        workspaceId: req.workspace.id,
        userId: req.auth!.user.id,
        eventType: EVENT,
        quantity: String(response.usage.input_tokens + response.usage.output_tokens),
        unit: 'tokens',
        metadata: { model: response.model, input: response.usage.input_tokens, output: response.usage.output_tokens, stop: response.stop_reason },
      })

      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        throw new HttpError(502, 'AI_DECLINED', 'The model did not produce an update')
      }
      return { ok: true, update: response.parsed_output, model: response.model, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens }, quota: { used: used + 1, limit: DAILY_QUOTA[plan] } }
    },
  )

  // ---- Deterministic intelligence report (docs/AI_REPORTS_AND_CHAT_PLAN.md).
  // Structure is fixed by code; numbers come from SQL; narrative is rule-based
  // in P1. Stored per workspace, deduped by input hash.
  r.post(
    '/workspaces/:workspaceId/ai/report',
    {
      preHandler: app.requireWorkspace,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ workspaceId: z.uuid() }),
        body: z
          .object({
            period: z.enum([...PERIOD_KINDS, 'custom']).default('30d'),
            start: z.iso.date().optional(),
            end: z.iso.date().optional(),
            scope: z.enum(SCOPES).default('overview'),
            platform: z.enum(REPORT_PLATFORMS).nullable().default(null),
          })
          .refine((b) => b.period !== 'custom' || (b.start && b.end && b.start <= b.end), { message: 'custom period needs start <= end' })
          .refine((b) => b.period !== 'custom' || (Date.parse(b.end!) - Date.parse(b.start!)) / 86_400_000 < 365, { message: 'custom period must be under 365 days' }),
      },
    },
    async (req) => {
      const b = req.body
      const { report, id, reused } = await buildReport({
        workspace: { id: req.workspace.id, name: req.workspace.name },
        period: b.period,
        range: b.period === 'custom' ? { start: b.start!, end: b.end! } : undefined,
        scope: b.scope,
        platform: b.platform,
        userId: req.auth!.user.id,
        plan: (req.auth!.user.plan ?? 'starter') as PlanTier,
      })
      return { id, reused, report }
    },
  )

  r.get('/workspaces/:workspaceId/ai/reports', { preHandler: app.requireWorkspace, schema: { params: z.object({ workspaceId: z.uuid() }) } }, async (req) => ({ reports: await listReports(req.workspace.id) }))

  r.get('/workspaces/:workspaceId/ai/reports/:id', { preHandler: app.requireWorkspace, schema: { params: z.object({ workspaceId: z.uuid(), id: z.uuid() }) } }, async (req) => {
    const row = await getReport(req.workspace.id, req.params.id)
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Report not found')
    return { id: row.id, report: row.report, narrativeSource: row.narrativeSource, createdAt: row.createdAt }
  })

  // ---- Chat over workspace data (read-only tools). SSE: status events while
  // tools run, then one `done` event with the answer.
  const convParams = z.object({ workspaceId: z.uuid(), id: z.uuid() })
  r.post(
    '/workspaces/:workspaceId/ai/chat',
    { preHandler: app.requireWorkspace, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { params: z.object({ workspaceId: z.uuid() }), body: z.object({ conversationId: z.uuid().nullable().default(null), message: z.string().min(1).max(2000) }) } },
    async (req, reply) => {
      if (!aiEnabled()) throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI chat is not configured on this deployment')
      const plan = (req.auth!.user.plan ?? 'starter') as PlanTier
      const used = await usedToday(req.auth!.user.id, CHAT_EVENT)
      if (used >= CHAT_DAILY_QUOTA[plan]) throw new HttpError(429, 'AI_QUOTA_EXCEEDED', `Daily limit of ${CHAT_DAILY_QUOTA[plan]} chat messages reached for the ${plan} plan`)
      const platforms = await db.select({ platform: integrations.platform }).from(integrations).where(and(eq(integrations.workspaceId, req.workspace.id), eq(integrations.status, 'connected')))

      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      const send = (e: unknown) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`)
      const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 10_000)
      try {
        const out = await chatTurn({
          workspace: { id: req.workspace.id, name: req.workspace.name, platforms: platforms.map((p) => p.platform) },
          user: { id: req.auth!.user.id, plan },
          conversationId: req.body.conversationId,
          message: req.body.message,
          onEvent: send,
        })
        send({ type: 'done', conversationId: out.conversationId, messageId: out.messageId, content: out.content, tools: out.tools.map((t) => ({ name: t.name, ok: t.ok })), quota: { used: used + 1, limit: CHAT_DAILY_QUOTA[plan] } })
      } catch (err) {
        req.log.error({ err }, 'chat turn failed')
        send({ type: 'error', code: 'AI_FAILED', message: 'The assistant could not answer. Try again.' })
      } finally {
        clearInterval(heartbeat)
        reply.raw.end()
      }
      return reply
    },
  )

  r.get('/workspaces/:workspaceId/ai/conversations', { preHandler: app.requireWorkspace, schema: { params: z.object({ workspaceId: z.uuid() }) } }, async (req) => ({ conversations: await listConversations(req.workspace.id, req.auth!.user.id) }))
  r.get('/workspaces/:workspaceId/ai/conversations/:id', { preHandler: app.requireWorkspace, schema: { params: convParams } }, async (req) => {
    const c = await getConversation(req.workspace.id, req.auth!.user.id, req.params.id)
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found')
    return c
  })
  r.delete('/workspaces/:workspaceId/ai/conversations/:id', { preHandler: app.requireWorkspace, schema: { params: convParams } }, async (req, reply) => {
    if (!(await deleteConversation(req.workspace.id, req.auth!.user.id, req.params.id))) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found')
    return reply.status(204).send()
  })
}
