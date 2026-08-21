import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { config } from '../config.js'
import * as schema from './schema/index.js'

// One pool per process. API and worker each create their own on boot.
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

export const db = drizzle(pool, { schema })
export type Db = typeof db
// Accepts either the root client or a transaction handle.
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query('select 1')
    return true
  } catch {
    return false
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end()
}
