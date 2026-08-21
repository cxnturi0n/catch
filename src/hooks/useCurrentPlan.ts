import { useAuth } from '../context/AuthContext'
import { getPlanOverride, PLANS, type PlanMeta, type PlanTier } from '../lib/plan'

// Resolves the effective plan for the current session:
//   1. `localStorage.catch:planOverride` (dev / sales demo)
//   2. `profiles.plan` loaded via AuthContext
//   3. 'starter' fallback for guests and pre-migration users
export function useCurrentPlan(): { tier: PlanTier; meta: PlanMeta; overridden: boolean } {
  const { user } = useAuth()
  const override = getPlanOverride()
  const tier: PlanTier = override ?? user?.plan ?? 'starter'
  return { tier, meta: PLANS[tier], overridden: override !== null }
}
