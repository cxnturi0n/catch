import type { FastifyInstance } from 'fastify'
import { count, countDistinct, eq, gte, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { user } from '../../db/schema/auth.js'
import { compensationConfigs, contentSchedule, discoveryResponses, feedback, incidents, integrations, kols, meetings, moderators, payments, resourceFolders, resources, tasks, workspaces } from '../../db/schema/index.js'

// Platform-wide analytics for the admin dashboard (user.role = 'admin').
// Shape mirrors what the legacy edge function returned.
export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/overview', { preHandler: app.requireAdmin }, async () => {
    const since30 = new Date(Date.now() - 30 * 86_400_000)
    const stale = new Date(Date.now() - 25 * 3_600_000)
    const n = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0

    const [users, byPlan, signups, wsTotal, wsNew, connected, staleSyncs, mods, tks, incs, kl, res, fold, pays, meets, content, leads, fb, fbPending, adoption] = await Promise.all([
      n(db.select({ n: count() }).from(user)),
      db.select({ plan: user.plan, n: count() }).from(user).groupBy(user.plan),
      db.select({ date: sql<string>`to_char(${user.createdAt}, 'YYYY-MM-DD')`, n: count() }).from(user).where(gte(user.createdAt, since30)).groupBy(sql`1`).orderBy(sql`1`),
      n(db.select({ n: count() }).from(workspaces)),
      n(db.select({ n: count() }).from(workspaces).where(gte(workspaces.createdAt, since30))),
      db.select({ platform: integrations.platform, n: count() }).from(integrations).where(eq(integrations.status, 'connected')).groupBy(integrations.platform),
      n(db.select({ n: count() }).from(integrations).where(sql`${integrations.status} = 'connected' and (${integrations.lastSync} is null or ${integrations.lastSync} < ${stale})`)),
      n(db.select({ n: count() }).from(moderators)),
      n(db.select({ n: count() }).from(tasks)),
      n(db.select({ n: count() }).from(incidents)),
      n(db.select({ n: count() }).from(kols)),
      n(db.select({ n: count() }).from(resources)),
      n(db.select({ n: count() }).from(resourceFolders)),
      n(db.select({ n: count() }).from(payments)),
      n(db.select({ n: count() }).from(meetings)),
      n(db.select({ n: count() }).from(contentSchedule)),
      db.select({ n: count(), avg: sql<number | null>`avg(${discoveryResponses.completionMs})` }).from(discoveryResponses),
      n(db.select({ n: count() }).from(feedback)),
      n(db.select({ n: count() }).from(feedback).where(eq(feedback.status, 'pending'))),
      Promise.all([
        n(db.select({ n: countDistinct(moderators.workspaceId) }).from(moderators)),
        n(db.select({ n: countDistinct(resources.workspaceId) }).from(resources)),
        n(db.select({ n: countDistinct(payments.workspaceId) }).from(payments)),
        n(db.select({ n: countDistinct(compensationConfigs.workspaceId) }).from(compensationConfigs)),
        n(db.select({ n: countDistinct(meetings.workspaceId) }).from(meetings)),
        n(db.select({ n: countDistinct(contentSchedule.workspaceId) }).from(contentSchedule)),
      ]),
    ])
    return {
      generatedAt: new Date().toISOString(),
      users: { total: users, byPlan: Object.fromEntries(byPlan.map((p) => [p.plan, p.n])), signups30d: signups.map((s) => ({ date: s.date, count: s.n })) },
      workspaces: { total: wsTotal, new30d: wsNew },
      integrations: { totalConnected: connected.reduce((s, x) => s + x.n, 0), connectedByPlatform: Object.fromEntries(connected.map((x) => [x.platform, x.n])), staleSyncs },
      content: { moderators: mods, tasks: tks, incidents: incs, kols: kl, resources: res, folders: fold, payments: pays, meetings: meets, contentScheduled: content },
      adoption: { total: wsTotal, withModerators: adoption[0], withResources: adoption[1], withPayments: adoption[2], withCompensation: adoption[3], withMeetings: adoption[4], withContent: adoption[5] },
      leads: { discoveryResponses: leads[0]?.n ?? 0, avgCompletionMs: leads[0]?.avg == null ? null : Number(leads[0].avg) },
      feedback: { total: fb, pending: fbPending },
    }
  })
}
