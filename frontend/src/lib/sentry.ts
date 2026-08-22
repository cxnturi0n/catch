import * as Sentry from '@sentry/react'

// Optional browser error tracking. No-op unless VITE_SENTRY_DSN is set at build.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined

export function initSentry() {
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Mask everything: community data must not land in error tooling.
    beforeSend(event) {
      delete event.request?.cookies
      return event
    },
  })
}

export const SentryErrorBoundary = Sentry.ErrorBoundary
