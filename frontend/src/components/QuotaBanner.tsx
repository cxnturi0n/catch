import { AlertTriangle, ArrowUpRight, Info } from 'lucide-react'
import { computeQuota, formatLimit, PLANS, RESOURCE_LABELS, upgradeMailto, type QuotaResource } from '../lib/plan'
import { useCurrentPlan } from '../hooks/useCurrentPlan'

interface QuotaBannerProps {
  resource: QuotaResource
  used: number
  /**
   * If true, hides the banner when the quota is comfortably below the "near"
   * threshold. Set false to always render (useful in dashboards / settings).
   */
  hideWhenOk?: boolean
  className?: string
}

/**
 * Inline banner that surfaces quota state for a given resource:
 *   • ok    → hidden (unless hideWhenOk=false, then shows a soft info row)
 *   • near  → amber warning ("you're at X of Y")
 *   • reached → red block ("limit reached — upgrade")
 */
export function QuotaBanner({ resource, used, hideWhenOk = true, className = '' }: QuotaBannerProps) {
  const { tier, meta } = useCurrentPlan()
  const quota = computeQuota(resource, used, tier)
  const labels = RESOURCE_LABELS[resource]

  if (quota.unlimited || (quota.status === 'ok' && hideWhenOk)) return null

  const barPct = Math.round(quota.pct * 100)
  const next = meta.next ? PLANS[meta.next].label : null
  const mailto = upgradeMailto(tier, resource)

  if (quota.status === 'reached') {
    return (
      <div
        className={`relative overflow-hidden rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-500/[0.12] via-red-500/[0.06] to-transparent px-5 py-4 ${className}`}
        role="alert"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-400" />
            <div>
              <div className="text-sm font-semibold text-white">
                You’ve reached your {labels.singular} limit ({quota.used} of {formatLimit(quota.limit)})
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Your <span className="font-medium text-white">{meta.label}</span> plan caps {labels.plural} at{' '}
                {formatLimit(quota.limit)}.
                {next ? ` Upgrade to ${next} to add more.` : ''}
              </div>
            </div>
          </div>
          <a
            href={mailto}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-red-500 to-red-600 px-4 py-2 text-xs font-semibold text-white shadow-[0_0_24px_rgba(239,68,68,0.35)] transition-all hover:brightness-110"
          >
            Upgrade plan <ArrowUpRight size={13} />
          </a>
        </div>
      </div>
    )
  }

  if (quota.status === 'near') {
    return (
      <div
        className={`rounded-2xl border border-amber-500/35 bg-gradient-to-r from-amber-500/[0.10] via-amber-500/[0.04] to-transparent px-5 py-4 ${className}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-400" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">
                You’re close to your {labels.singular} limit — {quota.used} of {formatLimit(quota.limit)} used
              </div>
              <div className="mt-2 h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all"
                  style={{ width: `${barPct}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-400">
                {next ? `Upgrade to ${next} to unlock more ${labels.plural} before you hit the cap.` : ''}
              </div>
            </div>
          </div>
          <a
            href={mailto}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/[0.08] px-4 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/[0.16]"
          >
            Upgrade plan <ArrowUpRight size={13} />
          </a>
        </div>
      </div>
    )
  }

  // ok + hideWhenOk=false → soft info variant
  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-3 text-xs text-slate-400 ${className}`}>
      <div className="flex items-center gap-2">
        <Info size={14} className="text-[var(--accent-emerald)]" />
        <span>
          {quota.used} of {formatLimit(quota.limit)} {labels.plural} used · {meta.label} plan
        </span>
      </div>
    </div>
  )
}
