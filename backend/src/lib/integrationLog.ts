// Integration diagnostics (gateway, backfill, webhooks, MTProto). On staging
// (APP_ENV=staging) every event is logged at info so behaviour can be followed
// in `docker compose logs worker`; in production the same events go out at
// debug level and stay silent under LOG_LEVEL=info. Never logs tokens,
// secrets or message text, only ids, counts and timings.
import { config } from '../config.js'
import { logger } from '../logger.js'

const verbose = config.APP_ENV === 'staging' || config.NODE_ENV !== 'production'

export function integrationLog(event: string, data: Record<string, unknown> = {}) {
  const entry = { integration: event, ...data }
  if (verbose) logger.info(entry, `integration:${event}`)
  else logger.debug(entry, `integration:${event}`)
}
