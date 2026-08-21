import type { FastifyInstance } from 'fastify'
import { count, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { user } from '../../db/schema/auth.js'
import { integrations, moderators, workspaces } from '../../db/schema/index.js'

// Platform-wide counters for the admin dashboard. Replaces the legacy
// `admin-analytics` edge function; gated by user.role = 'admin'.
export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/overview', { preHandler: app.requireAdmin }, async () => {
    const [[users], [ws], [mods], connected] = await Promise.all([
      db.select({ n: count() }).from(user),
      db.select({ n: count() }).from(workspaces),
      db.select({ n: count() }).from(moderators),
      db
        .select({ platform: integrations.platform, n: count() })
        .from(integrations)
        .where(sql`${integrations.status} = 'connected'`)
        .groupBy(integrations.platform),
    ])
    return {
      users: users?.n ?? 0,
      workspaces: ws?.n ?? 0,
      moderators: mods?.n ?? 0,
      connectedIntegrations: Object.fromEntries(connected.map((c) => [c.platform, c.n])),
    }
  })
}
