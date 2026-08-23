// Single place that talks to the model. Every call goes through here so the
// kill switch, model selection and usage accounting cannot be bypassed.
import Anthropic from '@anthropic-ai/sdk'
import { and, count, eq, gte, sql } from 'drizzle-orm'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { usageEvents } from '../../db/schema/index.js'
import type { PlanTier } from '../../lib/quota.js'

export const aiEnabled = (): boolean => config.AI_ENABLED && !!config.ANTHROPIC_API_KEY

let client: Anthropic | null = null
export function anthropic(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 })
  return client
}

export const reportModel = (): string => config.LLM_MODEL_REPORT ?? config.LLM_MODEL

/** Monthly cap on AI-narrated reports, charged to the workspace. */
export const REPORT_MONTHLY_QUOTA: Record<PlanTier, number> = { starter: 4, pro: 30, agency: 150, enterprise: 1000 }
export const REPORT_EVENT = 'ai_report_narrative'

export async function reportNarrativesThisMonth(workspaceId: string, now = new Date()): Promise<number> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [row] = await db
    .select({ n: count() })
    .from(usageEvents)
    .where(and(eq(usageEvents.workspaceId, workspaceId), eq(usageEvents.eventType, REPORT_EVENT), gte(usageEvents.occurredAt, since)))
  return row?.n ?? 0
}

export interface Usage {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export async function recordUsage(o: { workspaceId: string; userId: string | null; eventType: string; usage: Usage; metadata?: Record<string, unknown> }) {
  await db.insert(usageEvents).values({
    workspaceId: o.workspaceId,
    userId: o.userId,
    eventType: o.eventType,
    quantity: String(o.usage.input + o.usage.output),
    unit: 'tokens',
    costHintUsd: String(estimateUsd(o.usage)),
    metadata: { ...o.usage, ...o.metadata },
  })
}

/** Rough list-price estimate; only a hint for the admin dashboard. */
export function estimateUsd(u: Usage): number {
  const sonnetish = /sonnet|haiku/i.test(u.model)
  const inRate = sonnetish ? 3 : 5
  const outRate = sonnetish ? 15 : 25
  const usd = (u.input * inRate + u.cacheWrite * inRate * 1.25 + u.cacheRead * inRate * 0.1 + u.output * outRate) / 1_000_000
  return Math.round(usd * 1e6) / 1e6
}

export const monthStart = (now = new Date()) => sql`date_trunc('month', ${now.toISOString()}::timestamptz)`
