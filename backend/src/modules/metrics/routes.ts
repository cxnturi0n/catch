import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client.js'
import {
  integrations,
  channelActivity,
  platformChannels,
  platformMessages,
  discordMembershipSnapshots,
  discordMemberTenure,
  memberMessages,
  messageActivity,
  platformMetricSnapshots,
  platformMetrics,
  telegramMembershipEvents,
  xImports,
} from '../../db/schema/index.js'
import { notFound } from '../../lib/errors.js'

// Read-only analytics endpoints. Raw rows go out; the capability matrix in
// the SPA decides what is displayable. Writers are the sync service (API/worker)
// and the Telegram webhook.

const params = z.object({ workspaceId: z.uuid() })
const daysQuery = (def: number, max = 365) => z.object({ days: z.coerce.number().int().min(1).max(max).default(def) })
const platformsQuery = z.object({ platforms: z.string().optional() })

function sinceDay(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}
function sinceTs(hours: number) {
  return new Date(Date.now() - hours * 3_600_000)
}

export async function metricsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()
  const member = app.requireWorkspace
  const base = '/workspaces/:workspaceId/metrics'

  // Daily rollups (metrics jsonb intact), optionally filtered by platforms.
  r.get(`${base}/daily`, { preHandler: member, schema: { params, querystring: daysQuery(30).merge(platformsQuery) } }, async (req) => {
    const where = [eq(platformMetrics.workspaceId, req.workspace.id), gte(platformMetrics.date, sinceDay(req.query.days))]
    const list = req.query.platforms?.split(',').map((p) => p.trim()).filter(Boolean) ?? []
    if (list.length) where.push(inArray(platformMetrics.platform, list))
    const rows = await db
      .select({ platform: platformMetrics.platform, date: platformMetrics.date, metrics: platformMetrics.metrics })
      .from(platformMetrics)
      .where(and(...where))
      .orderBy(asc(platformMetrics.date))
    return { rows }
  })

  // Hourly snapshots for short windows (1h / 5h / 24h deltas).
  r.get(`${base}/snapshots`, { preHandler: member, schema: { params, querystring: z.object({ hours: z.coerce.number().int().min(1).max(24 * 90).default(24), platform: z.string().max(20).optional() }) } }, async (req) => {
    const where = [eq(platformMetricSnapshots.workspaceId, req.workspace.id), gte(platformMetricSnapshots.capturedAt, sinceTs(req.query.hours))]
    if (req.query.platform) where.push(eq(platformMetricSnapshots.platform, req.query.platform))
    const rows = await db
      .select({ platform: platformMetricSnapshots.platform, capturedAt: platformMetricSnapshots.capturedAt, metrics: platformMetricSnapshots.metrics })
      .from(platformMetricSnapshots)
      .where(and(...where))
      .orderBy(asc(platformMetricSnapshots.capturedAt))
    return { rows }
  })

  // Hour buckets of message counts (heatmap).
  r.get(`${base}/activity`, { preHandler: member, schema: { params, querystring: daysQuery(28).extend({ platform: z.enum(['telegram', 'discord']).optional() }) } }, async (req) => {
    const where = [eq(messageActivity.workspaceId, req.workspace.id), gte(messageActivity.bucketStart, sinceTs(req.query.days * 24))]
    if (req.query.platform) where.push(eq(messageActivity.platform, req.query.platform))
    const rows = await db
      .select({ platform: messageActivity.platform, bucketStart: messageActivity.bucketStart, count: messageActivity.messageCount })
      .from(messageActivity)
      .where(and(...where))
      .orderBy(asc(messageActivity.bucketStart))
    return { rows }
  })

  // Per-member totals (top first) and the daily volume trend, Telegram.
  r.get(`${base}/member-messages`, { preHandler: member, schema: { params, querystring: daysQuery(30).extend({ platform: z.enum(['telegram', 'discord']).default('telegram') }) } }, async (req) => {
    const where = and(eq(memberMessages.workspaceId, req.workspace.id), eq(memberMessages.platform, req.query.platform), gte(memberMessages.day, sinceDay(req.query.days)))
    const [members, trend] = await Promise.all([
      db
        .select({
          memberRef: memberMessages.memberRef,
          displayName: sql<string | null>`max(${memberMessages.displayName})`,
          messages: sql<number>`sum(${memberMessages.messageCount})::int`,
        })
        .from(memberMessages)
        .where(where)
        .groupBy(memberMessages.memberRef)
        .orderBy(desc(sql`sum(${memberMessages.messageCount})`))
        .limit(500),
      db
        .select({ date: memberMessages.day, value: sql<number>`sum(${memberMessages.messageCount})::int` })
        .from(memberMessages)
        .where(where)
        .groupBy(memberMessages.day)
        .orderBy(asc(memberMessages.day)),
    ])
    return { members, trend }
  })

  // Top channels: daily rollup for the volume, stored messages (30 days) for
  // the distinct author count.
  r.get(`${base}/channels`, { preHandler: member, schema: { params, querystring: daysQuery(30, 365).extend({ platform: z.enum(['telegram', 'discord']).optional() }) } }, async (req) => {
    const since = sinceDay(req.query.days)
    const sinceAt = new Date(`${since}T00:00:00Z`)
    const volWhere = [eq(channelActivity.workspaceId, req.workspace.id), gte(channelActivity.day, since)]
    if (req.query.platform) volWhere.push(eq(channelActivity.platform, req.query.platform))
    const volume = await db
      .select({ platform: channelActivity.platform, channelId: channelActivity.channelId, messages: sql<number>`sum(${channelActivity.messageCount})::int` })
      .from(channelActivity)
      .where(and(...volWhere))
      .groupBy(channelActivity.platform, channelActivity.channelId)
      .orderBy(desc(sql`sum(${channelActivity.messageCount})`))
      .limit(50)
    if (volume.length === 0) return { rows: [] }
    const ids = volume.map((v) => v.channelId)
    const [authors, channels] = await Promise.all([
      db
        .select({ platform: platformMessages.platform, channelId: platformMessages.channelId, activeMembers: sql<number>`count(distinct ${platformMessages.memberRef})::int` })
        .from(platformMessages)
        .where(and(eq(platformMessages.workspaceId, req.workspace.id), gte(platformMessages.sentAt, sinceAt), inArray(platformMessages.channelId, ids)))
        .groupBy(platformMessages.platform, platformMessages.channelId),
      db
        .select({ platform: platformChannels.platform, channelId: platformChannels.channelId, name: platformChannels.name, type: platformChannels.type, lastMessageAt: platformChannels.lastMessageAt })
        .from(platformChannels)
        .where(and(eq(platformChannels.workspaceId, req.workspace.id), inArray(platformChannels.channelId, ids))),
    ])
    const key = (p: string, c: string) => `${p}|${c}`
    const byAuthors = new Map(authors.map((a) => [key(a.platform, a.channelId), a.activeMembers]))
    const byChannel = new Map(channels.map((c) => [key(c.platform, c.channelId), c]))
    const rows = volume.map((v) => {
      const c = byChannel.get(key(v.platform, v.channelId))
      return { platform: v.platform, channelId: v.channelId, name: c?.name ?? null, type: c?.type ?? null, messages: v.messages, activeMembers: byAuthors.get(key(v.platform, v.channelId)) ?? 0, lastMessageAt: c?.lastMessageAt ?? null }
    })
    return { rows }
  })

  // Member picker for the moderator form: people seen in the last 30 days,
  // plus Telegram admins reported at connect time.
  r.get(`${base}/platform-members`, { preHandler: member, schema: { params, querystring: z.object({ platform: z.enum(['telegram', 'discord']), q: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }) } }, async (req) => {
    const q = req.query.q?.replace(/^@/, '') ?? ''
    const where = [eq(memberMessages.workspaceId, req.workspace.id), eq(memberMessages.platform, req.query.platform), gte(memberMessages.day, sinceDay(30))]
    if (q) where.push(sql`(${memberMessages.displayName} ilike ${'%' + q + '%'} or ${memberMessages.memberRef} = ${q})`)
    const seen = await db
      .select({ memberRef: memberMessages.memberRef, displayName: sql<string | null>`max(${memberMessages.displayName})`, messages: sql<number>`sum(${memberMessages.messageCount})::int`, lastMessageAt: sql<Date | null>`max(${memberMessages.lastMessageAt})` })
      .from(memberMessages)
      .where(and(...where))
      .groupBy(memberMessages.memberRef)
      .orderBy(desc(sql`sum(${memberMessages.messageCount})`))
      .limit(req.query.limit)
    const rows = seen.map((s) => ({ ...s, isAdmin: false }))
    if (req.query.platform === 'telegram') {
      const [row] = await db.select({ metadata: integrations.metadata }).from(integrations).where(and(eq(integrations.workspaceId, req.workspace.id), eq(integrations.platform, 'telegram'))).limit(1)
      const admins = (row?.metadata.admins as Array<{ id: string; username: string | null; first_name: string | null }> | undefined) ?? []
      for (const a of admins) {
        const name = a.username ? `@${a.username}` : (a.first_name ?? `id:${a.id}`)
        if (q && !name.toLowerCase().includes(q.toLowerCase()) && a.id !== q) continue
        const existing = rows.find((r) => r.memberRef === a.id)
        if (existing) existing.isAdmin = true
        else rows.push({ memberRef: a.id, displayName: name, messages: 0, lastMessageAt: null, isAdmin: true })
      }
    }
    return { rows: rows.slice(0, req.query.limit) }
  })

  // Exact Telegram joins/leaves in a window (from webhook events).
  r.get(`${base}/telegram-membership`, { preHandler: member, schema: { params, querystring: z.object({ hours: z.coerce.number().int().min(1).max(24 * 365).default(24) }) } }, async (req) => {
    const since = sinceTs(req.query.hours)
    const rows = await db
      .select({ eventType: telegramMembershipEvents.eventType, n: sql<number>`count(*)::int` })
      .from(telegramMembershipEvents)
      .where(and(eq(telegramMembershipEvents.workspaceId, req.workspace.id), gte(telegramMembershipEvents.occurredAt, since)))
      .groupBy(telegramMembershipEvents.eventType)
    const by = Object.fromEntries(rows.map((x) => [x.eventType, x.n]))
    return { joins: by.join ?? 0, leaves: by.leave ?? 0, since }
  })

  // Discord tenure + membership snapshots (retention panel).
  r.get(`${base}/discord-tenure`, { preHandler: member, schema: { params } }, async (req) => {
    const rows = await db
      .select({ memberRef: discordMemberTenure.memberRef, joinedAt: discordMemberTenure.joinedAt, firstSeen: discordMemberTenure.firstSeen, lastSeen: discordMemberTenure.lastSeen })
      .from(discordMemberTenure)
      .where(eq(discordMemberTenure.workspaceId, req.workspace.id))
      .orderBy(asc(discordMemberTenure.joinedAt))
      .limit(20_000)
    return { rows }
  })

  r.get(`${base}/discord-membership`, { preHandler: member, schema: { params, querystring: daysQuery(90) } }, async (req) => {
    const rows = await db
      .select({ capturedAt: discordMembershipSnapshots.capturedAt, totalMembers: discordMembershipSnapshots.totalMembers, newMembers: discordMembershipSnapshots.newMembers, leftMembers: discordMembershipSnapshots.leftMembers })
      .from(discordMembershipSnapshots)
      .where(and(eq(discordMembershipSnapshots.workspaceId, req.workspace.id), gte(discordMembershipSnapshots.capturedAt, sinceTs(req.query.days * 24))))
      .orderBy(asc(discordMembershipSnapshots.capturedAt))
    return { rows }
  })

  // X (Twitter) analytics: CSV parsed in the browser, rows stored here.
  const xRow = z.object({ date: z.string().max(32) }).catchall(z.union([z.number(), z.string(), z.null()]))
  r.get(`${base}/x-import`, { preHandler: member, schema: { params } }, async (req) => {
    const [row] = await db.select().from(xImports).where(eq(xImports.workspaceId, req.workspace.id)).orderBy(desc(xImports.createdAt)).limit(1)
    return { import: row ?? null }
  })
  r.put(`${base}/x-import`, { preHandler: app.requireWorkspaceRole(['owner', 'admin']), schema: { params, body: z.object({ filename: z.string().max(200).nullish(), periodStart: z.string().max(32).nullish(), periodEnd: z.string().max(32).nullish(), rows: z.array(xRow).max(5000) }) } }, async (req) => {
    // One import per workspace: replace instead of accumulating blobs.
    await db.delete(xImports).where(eq(xImports.workspaceId, req.workspace.id))
    const [row] = await db
      .insert(xImports)
      .values({ workspaceId: req.workspace.id, importedBy: req.auth!.user.id, filename: req.body.filename ?? null, periodStart: req.body.periodStart ?? null, periodEnd: req.body.periodEnd ?? null, rows: req.body.rows })
      .returning()
    return { import: row }
  })
  r.delete(`${base}/x-import`, { preHandler: app.requireWorkspaceRole(['owner', 'admin']), schema: { params } }, async (req, reply) => {
    const d = await db.delete(xImports).where(eq(xImports.workspaceId, req.workspace.id)).returning({ id: xImports.id })
    if (d.length === 0) throw notFound('Import')
    return reply.status(204).send()
  })
}
