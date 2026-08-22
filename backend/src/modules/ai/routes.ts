import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { and, count, eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { usageEvents } from '../../db/schema/index.js'
import { HttpError } from '../../lib/errors.js'
import type { PlanTier } from '../../lib/quota.js'

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

export async function usedToday(userId: string): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const [row] = await db.select({ n: count() }).from(usageEvents).where(and(eq(usageEvents.userId, userId), eq(usageEvents.eventType, EVENT), gte(usageEvents.occurredAt, since)))
  return row?.n ?? 0
}

export async function aiRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get('/workspaces/:workspaceId/ai/quota', { preHandler: app.requireWorkspace, schema: { params: z.object({ workspaceId: z.uuid() }) } }, async (req) => {
    const plan = (req.auth!.user.plan ?? 'starter') as PlanTier
    const used = await usedToday(req.auth!.user.id)
    return { used, limit: DAILY_QUOTA[plan], configured: !!config.ANTHROPIC_API_KEY, model: config.LLM_MODEL }
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
}
