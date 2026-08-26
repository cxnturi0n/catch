import { initSentry, captureException } from './lib/sentry.js'
initSentry('worker')
import { closeDatabase, pingDatabase } from './db/client.js'
import { createBoss, startWorker } from './jobs/scheduler.js'
import { logger } from './logger.js'
import { config } from './config.js'
import { startGatewayManager, type GatewayManager } from './integrations/discord/gatewayManager.js'
import { flushThrottled } from './lib/events.js'

// Background worker: pg-boss scheduler on the same PostgreSQL. Runs as its own
// process so it can live on another container or host than the API.
async function main() {
  if (!(await pingDatabase())) throw new Error('database unreachable')
  const boss = createBoss()
  await startWorker(boss)
  let gateway: GatewayManager | null = null
  if (config.DISCORD_GATEWAY_ENABLED) {
    gateway = startGatewayManager()
    logger.info('discord gateway manager started')
  } else logger.info('discord gateway disabled (DISCORD_GATEWAY_ENABLED=false), REST polling only')

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker')
    // Gateway first: closes with a resumable code so the next process resumes.
    await gateway?.stop().catch(() => undefined)
    await boss.stop({ graceful: true, timeout: 20_000 }).catch(() => undefined)
    await flushThrottled().catch(() => undefined)
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
