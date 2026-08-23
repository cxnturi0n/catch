// Microsoft Clarity loader, consent-gated. Clarity is only injected AFTER the
// user grants analytics consent AND only when a project id is configured via the
// VITE_CLARITY_PROJECT_ID build env var. No id → this is a total no-op, so the
// app ships safe until the owner wires the id in Vercel.
//
// Privacy: Clarity masks text content by default; keep the project's masking mode
// at Balanced/Strict in the Clarity dashboard so no client data is captured.

const PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined

export const clarityConfigured = Boolean(PROJECT_ID)

const CONSENT_KEY = 'catch:analytics-consent' // 'granted' | 'denied'

export type ConsentState = 'granted' | 'denied' | 'unset'

export function getConsent(): ConsentState {
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'granted' || v === 'denied' ? v : 'unset'
  } catch {
    return 'unset'
  }
}

export function setConsent(state: 'granted' | 'denied') {
  try {
    localStorage.setItem(CONSENT_KEY, state)
  } catch {
    /* storage unavailable, consent just won't persist */
  }
}

let injected = false

/** Injects the Clarity tag. Idempotent; no-ops without a project id. */
export function initClarity() {
  if (!PROJECT_ID || injected || typeof window === 'undefined' || typeof document === 'undefined') return
  injected = true
  // Standard Clarity bootstrap snippet.
  ;(function (c: any, l: Document, a: string, r: string, i: string) {
    c[a] =
      c[a] ||
      function (...args: unknown[]) {
        ;(c[a].q = c[a].q || []).push(args)
      }
    const t = l.createElement(r) as HTMLScriptElement
    t.async = true
    t.src = 'https://www.clarity.ms/tag/' + i
    const y = l.getElementsByTagName(r)[0]
    y.parentNode?.insertBefore(t, y)
  })(window as any, document, 'clarity', 'script', PROJECT_ID)
}
