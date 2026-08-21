import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, closeDatabase } from './client.js'
import { logger } from '../logger.js'

// Applies pending SQL migrations from ./drizzle. Run once per deploy, before
// the API starts. Drizzle takes an advisory lock so concurrent runs are safe.
async function main() {
  await migrate(db, { migrationsFolder: 'drizzle' })
  logger.info('migrations applied')
  await closeDatabase()
}

main().catch((err) => {
  logger.error({ err }, 'migration failed')
  process.exit(1)
})
