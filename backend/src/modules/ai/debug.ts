// AI diagnostics. On staging (APP_ENV=staging) every event is logged at info
// so behaviour can be followed in `docker compose logs api`; in production the
// same events go out at debug level and stay silent under LOG_LEVEL=info.
// Never logs prompt text, tool results or user messages, only shapes and sizes.
import { config } from '../../config.js'
import { logger } from '../../logger.js'

const verbose = config.APP_ENV === 'staging' || config.NODE_ENV !== 'production'

export function aiLog(event: string, data: Record<string, unknown> = {}) {
  const entry = { ai: event, ...data }
  if (verbose) logger.info(entry, `ai:${event}`)
  else logger.debug(entry, `ai:${event}`)
}

export const bytes = (s: string | object) => Buffer.byteLength(typeof s === 'string' ? s : JSON.stringify(s))
