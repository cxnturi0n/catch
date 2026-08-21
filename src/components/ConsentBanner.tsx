import { useEffect, useState } from 'react'
import { clarityConfigured, getConsent, initClarity, setConsent } from '../lib/clarity'

// Cookie/analytics consent banner. Only appears when analytics is actually
// configured (a Clarity id is set) AND the user hasn't decided yet. On grant it
// starts Clarity; on a prior grant it re-starts it silently on load. Fully
// GDPR-friendly: nothing is tracked until "Accept".
export function ConsentBanner() {
  const [decided, setDecided] = useState<boolean>(() => getConsent() !== 'unset')

  // Returning visitor who already accepted → start analytics without a banner.
  useEffect(() => {
    if (clarityConfigured && getConsent() === 'granted') initClarity()
  }, [])

  if (!clarityConfigured || decided) return null

  function accept() {
    setConsent('granted')
    initClarity()
    setDecided(true)
  }
  function decline() {
    setConsent('denied')
    setDecided(true)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex justify-center px-4 pb-4">
      <div className="glass flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-[var(--border-card)] p-4 shadow-xl sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--text-secondary)]">
          We use privacy-friendly product analytics (Microsoft Clarity) to see how the app is used and improve it.
          Sensitive content is masked. You can decline.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={decline}
            className="rounded-lg border border-[var(--border-card)] bg-white/[0.02] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-white/[0.06]"
          >
            Decline
          </button>
          <button
            onClick={accept}
            className="sheen rounded-lg bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)] px-4 py-2 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:shadow-[var(--glow-emerald-strong)]"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
