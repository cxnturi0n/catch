import { closeDatabase, pingDatabase } from './db/client.js'
import { logger } from './logger.js'

// Worker entrypoint. Step 1 only proves the process boots and reaches the
// database; the pg-boss scheduler and the integration sync jobs arrive in a
// later step. Kept as a separate process so it can run on its own container
// or host without the API.
async function main() {
  const dbOk = await pingDatabase()
  if (!dbOk) throw new Error('database unreachable')
  logger.info('worker started (no jobs registered yet)')

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker')
    await closeDatabase()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  // A pending promise alone does not keep Node alive once the pg pool goes
  // idle; hold a timer handle until the scheduler (next step) owns the loop.
  setInterval(() => {}, 60_000)
}

main().catch((err) => {
  logger.error({ err }, 'worker failed to start')
  process.exit(1)
})
