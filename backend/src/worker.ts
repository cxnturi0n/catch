import { initSentry, captureException } from './lib/sentry.js'
initSentry('worker')
import { closeDatabase, pingDatabase } from './db/client.js'
import { createBoss, startWorker } from './jobs/scheduler.js'
import { logger } from './logger.js'

// Background worker: pg-boss scheduler on the same PostgreSQL. Runs as its own
// process so it can live on another container or host than the API.
async function main() {
  if (!(await pingDatabase())) throw new Error('database unreachable')
  const boss = createBoss()
  await startWorker(boss)

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker')
    await boss.stop({ graceful: true, timeout: 20_000 }).catch(() => undefined)
    await closeDatabase()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  captureException(err)
  logger.error({ err }, 'worker failed to start')
  process.exit(1)
})
