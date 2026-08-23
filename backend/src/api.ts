import { initSentry } from './lib/sentry.js'
initSentry('api')
import { buildApp } from './app.js'
import { loadHelpDocs } from './modules/ai/chat/help.js'
import { config } from './config.js'
import { closeDatabase } from './db/client.js'
import { closeEvents } from './lib/events.js'
import { logger } from './logger.js'

const app = await buildApp()
// Product docs for the chat's search_help tool (idempotent upsert).
try {
  const n = await loadHelpDocs()
  app.log.info({ docs: n }, 'help docs loaded')
} catch (err) {
  app.log.warn({ err }, 'help docs not loaded')
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down api')
  await app.close()
  await closeEvents()
  await closeDatabase()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT })
} catch (err) {
  logger.error({ err }, 'api failed to start')
  process.exit(1)
}
