// Plan tiers, quota limits and upgrade helpers.
// Prices are quote-based ("Contact us") so the app only cares about limits
// and gating, never about billing amounts.

export type PlanTier = 'starter' | 'pro' | 'agency' | 'enterprise'

export interface PlanLimits {
  workspaces: number
  moderators: number
}

export interface PlanMeta {
  tier: PlanTier
  label: string
  next: PlanTier | null
  limits: PlanLimits
}

// Numeric.POSITIVE_INFINITY means unlimited, displayed as "∞" in the UI.
export const PLANS: Record<PlanTier, PlanMeta> = {
  starter: {
    tier: 'starter',
    label: 'Starter',
    next: 'pro',
    limits: { workspaces: 1, moderators: 3 },
  },
  pro: {
    tier: 'pro',
    label: 'Pro',
    next: 'agency',
    limits: { workspaces: 2, moderators: 10 },
  },
  agency: {
    tier: 'agency',
    label: 'Agency',
    next: 'enterprise',
    limits: { workspaces: 8, moderators: 40 },
  },
  enterprise: {
    tier: 'enterprise',
    label: 'Enterprise',
    next: null,
    limits: { workspaces: Number.POSITIVE_INFINITY, moderators: Number.POSITIVE_INFINITY },
  },
}

const VALID_TIERS: PlanTier[] = ['starter', 'pro', 'agency', 'enterprise']

export function isPlanTier(v: unknown): v is PlanTier {
  return typeof v === 'string' && (VALID_TIERS as string[]).includes(v)
}

// Local override for demoing higher tiers to clients without touching the DB.
// Set `localStorage.setItem('catch:planOverride', 'agency')` in DevTools.
const OVERRIDE_KEY = 'catch:planOverride'

export function getPlanOverride(): PlanTier | null {
  // Demo override exists only in development builds; production trusts the server.
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const v = window.localStorage.getItem(OVERRIDE_KEY)
  return isPlanTier(v) ? v : null
}

export type QuotaResource = keyof PlanLimits

export interface QuotaState {
  resource: QuotaResource
  used: number
  limit: number
  remaining: number
  pct: number
  status: 'ok' | 'near' | 'reached'
  unlimited: boolean
}

const NEAR_THRESHOLD = 0.8

export function computeQuota(resource: QuotaResource, used: number, plan: PlanTier): QuotaState {
  const limit = PLANS[plan].limits[resource]
  const unlimited = !Number.isFinite(limit)
  if (unlimited) {
    return { resource, used, limit, remaining: Number.POSITIVE_INFINITY, pct: 0, status: 'ok', unlimited: true }
  }
  const pct = limit === 0 ? 1 : used / limit
  const status: QuotaState['status'] = used >= limit ? 'reached' : pct >= NEAR_THRESHOLD ? 'near' : 'ok'
  return { resource, used, limit, remaining: Math.max(0, limit - used), pct: Math.min(pct, 1), status, unlimited: false }
}

export const RESOURCE_LABELS: Record<QuotaResource, { singular: string; plural: string }> = {
  workspaces: { singular: 'workspace', plural: 'workspaces' },
  moderators: { singular: 'moderator', plural: 'moderators' },
}

// Deep-links a mailto for the "Upgrade → Contact us" CTAs. Kept in sync with
// the CONTACT_EMAIL in Landing.tsx.
export const CONTACT_EMAIL = 'hello@catch.app'

export function upgradeMailto(currentPlan: PlanTier, resource: QuotaResource | null): string {
  const target = PLANS[currentPlan].next
  const targetLabel = target ? PLANS[target].label : 'Enterprise'
  const subject =
    resource === null
      ? `Catch, upgrade to ${targetLabel}`
      : `Catch, ${targetLabel} upgrade (${RESOURCE_LABELS[resource].plural} limit reached)`
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
}

export function formatLimit(limit: number): string {
  return Number.isFinite(limit) ? String(limit) : '∞'
}
