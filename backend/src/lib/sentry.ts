import * as Sentry from '@sentry/node'
import { config } from '../config.js'

// Error tracking is optional: with no SENTRY_DSN every call is a no-op.
export const sentryEnabled = Boolean(config.SENTRY_DSN)

export function initSentry(serverName: 'api' | 'worker') {
  if (!sentryEnabled) return
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    serverName,
    release: process.env.APP_VERSION,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Never ship request bodies or cookies (tokens, passwords).
      if (event.request) {
        delete event.request.data
        delete event.request.cookies
        if (event.request.headers) delete event.request.headers.cookie
      }
      return event
    },
  })
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (!sentryEnabled) return
  Sentry.captureException(err, context ? { extra: context } : undefined)
}

export { Sentry }
