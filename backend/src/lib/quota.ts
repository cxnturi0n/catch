import { PLAN_TIERS } from '../db/schema/index.js'

export type PlanTier = (typeof PLAN_TIERS)[number]
export type QuotaResource = 'workspaces' | 'moderators'

// Server-side source of truth for plan limits. The SPA may mirror these for
// display, but enforcement happens here only. Infinity = unlimited.
export const PLAN_LIMITS: Record<PlanTier, Record<QuotaResource, number>> = {
  starter: { workspaces: 1, moderators: 3 },
  pro: { workspaces: 2, moderators: 10 },
  agency: { workspaces: 8, moderators: 40 },
  enterprise: { workspaces: Number.POSITIVE_INFINITY, moderators: Number.POSITIVE_INFINITY },
}

export interface QuotaState {
  resource: QuotaResource
  used: number
  limit: number
  remaining: number
  reached: boolean
}

export function quotaFor(plan: PlanTier, resource: QuotaResource, used: number): QuotaState {
  const limit = PLAN_LIMITS[plan][resource]
  return {
    resource,
    used,
    limit,
    remaining: Number.isFinite(limit) ? Math.max(0, limit - used) : Number.POSITIVE_INFINITY,
    reached: used >= limit,
  }
}

export class QuotaExceededError extends Error {
  statusCode = 403
  code = 'QUOTA_EXCEEDED'
  constructor(public quota: QuotaState) {
    super(`${quota.resource} limit reached (${quota.used}/${quota.limit})`)
  }
}
