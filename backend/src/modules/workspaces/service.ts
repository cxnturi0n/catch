import { sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { QuotaExceededError, quotaFor, type PlanTier } from '../../lib/quota.js'
import * as repo from './repo.js'

// Creation is quota-gated inside a transaction so two concurrent requests
// cannot both pass the count check.
export async function createWorkspace(user: { id: string; plan: PlanTier }, input: repo.NewWorkspace) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`workspaces:${user.id}`}))`)
    const used = await repo.countOwnedBy(user.id, tx)
    const quota = quotaFor(user.plan, 'workspaces', used)
    if (quota.reached) throw new QuotaExceededError(quota)
    return repo.create(user.id, input, tx)
  })
}
