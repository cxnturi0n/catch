import { ArrowUpRight, Lock } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { formatLimit, PLANS, RESOURCE_LABELS, upgradeMailto, type QuotaResource } from '../lib/plan'
import { useCurrentPlan } from '../hooks/useCurrentPlan'

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
  resource: QuotaResource
  used: number
}

/**
 * Blocking modal shown when the user tries to create a resource beyond their
 * current plan limit. The only action forward is "Contact us" (mailto).
 */
export function UpgradeModal({ open, onClose, resource, used }: UpgradeModalProps) {
  const { tier, meta } = useCurrentPlan()
  const labels = RESOURCE_LABELS[resource]
  const nextTier = meta.next
  const nextMeta = nextTier ? PLANS[nextTier] : null
  const nextLimit = nextMeta ? nextMeta.limits[resource] : Number.POSITIVE_INFINITY
  const mailto = upgradeMailto(tier, resource)

  return (
    <Modal open={open} onClose={onClose} title="Plan limit reached">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-400">
            <Lock size={20} />
          </div>
          <div>
            <p className="text-sm text-white">
              You’re on the <span className="font-semibold">{meta.label}</span> plan, which allows{' '}
              <span className="font-semibold">
                {formatLimit(meta.limits[resource])} {labels.plural}
              </span>
              . You currently have <span className="font-semibold">{used}</span>.
            </p>
            {nextMeta && (
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Upgrading to <span className="font-semibold text-white">{nextMeta.label}</span> raises the cap to{' '}
                <span className="font-semibold text-white">{formatLimit(nextLimit)}</span> {labels.plural}
                {nextMeta.next && Number.isFinite(nextLimit) ? ' — and higher tiers are unlimited.' : '.'}
              </p>
            )}
            {!nextMeta && (
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                You’re already on our top tier. Get in touch to discuss a custom limit for your setup.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <a
            href={mailto}
            className="sheen inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:shadow-[var(--glow-emerald-strong)]"
          >
            Upgrade — contact us <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </Modal>
  )
}
