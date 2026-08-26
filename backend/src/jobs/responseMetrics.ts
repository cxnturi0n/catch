import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { moderatorResponseMetrics, moderators, platformMessages } from '../db/schema/index.js'
import { publish } from '../lib/events.js'
import { workspaceIdentityIndex, resolveModerator } from './moderatorPerformance.js'

// Response time: how quickly a moderator answers members. Per channel, the
// first moderator message within 60 minutes after a member message counts
// as its response (an explicit reply targets that message, otherwise the
// latest unanswered member message). Computed nightly from the stored
// messages and written per moderator, platform and day.

export const RESPONSE_WINDOW_MS = 60 * 60_000

export interface ResponseMsg {
  platform: 'discord' | 'telegram'
  channelId: string
  messageId: string
  memberRef: string
  displayName: string | null
  replyToMessageId: string | null
  sentAt: Date
}

export interface Response {
  moderatorId: string
  platform: 'discord' | 'telegram'
  respondedAt: Date
  responseSeconds: number
}

export function computeResponses(messages: ResponseMsg[], resolve: (m: ResponseMsg) => string | undefined): Response[] {
  const byChannel = new Map<string, ResponseMsg[]>()
  for (const m of messages) {
    const k = `${m.platform}|${m.channelId}`
    const list = byChannel.get(k)
    if (list) list.push(m)
    else byChannel.set(k, [m])
  }
  const out: Response[] = []
  for (const list of byChannel.values()) {
    list.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
    // Unanswered member messages, oldest first.
    const pending: ResponseMsg[] = []
    for (const m of list) {
      const modId = resolve(m)
      const horizon = m.sentAt.getTime() - RESPONSE_WINDOW_MS
      while (pending.length && pending[0]!.sentAt.getTime() < horizon) pending.shift()
      if (!modId) {
        pending.push(m)
        continue
      }
      let idx = -1
      if (m.replyToMessageId) {
        idx = pending.findIndex((p) => p.messageId === m.replyToMessageId)
        if (idx < 0) continue // reply to something that is not an open member message (another moderator, an old thread)
      } else if (pending.length) idx = pending.length - 1
      if (idx < 0) continue
      const target = pending[idx]!
      pending.splice(idx, 1)
      out.push({ moderatorId: modId, platform: m.platform, respondedAt: m.sentAt, responseSeconds: Math.round((m.sentAt.getTime() - target.sentAt.getTime()) / 1000) })
    }
  }
  return out
}

/** Computes and stores response metrics for one UTC day. Returns rows written. */
export async function recordResponseMetrics(workspaceId: string, day: string): Promise<number> {
  const idx = await workspaceIdentityIndex(workspaceId)
  if (idx.byRef.size === 0 && idx.byHandle.size === 0) return 0
  const start = new Date(`${day}T00:00:00Z`)
  const end = new Date(start.getTime() + 86_400_000)
  // Include the hour before the day so an answer at 00:10 finds its question,
  // and the hour after so a question at 23:50 can still be answered on `day`.
  const rows = await db
    .select({ platform: platformMessages.platform, channelId: platformMessages.channelId, messageId: platformMessages.messageId, memberRef: platformMessages.memberRef, displayName: platformMessages.displayName, replyToMessageId: platformMessages.replyToMessageId, sentAt: platformMessages.sentAt })
    .from(platformMessages)
    .where(and(eq(platformMessages.workspaceId, workspaceId), gte(platformMessages.sentAt, new Date(start.getTime() - RESPONSE_WINDOW_MS)), lt(platformMessages.sentAt, new Date(end.getTime() + RESPONSE_WINDOW_MS))))
  const responses = computeResponses(rows, (m) => resolveModerator(idx, m.platform, m.memberRef, m.displayName)).filter((r) => r.respondedAt >= start && r.respondedAt < end)
  const agg = new Map<string, { moderatorId: string; platform: 'discord' | 'telegram'; n: number; total: number }>()
  for (const r of responses) {
    const k = `${r.moderatorId}|${r.platform}`
    const a = agg.get(k)
    if (a) {
      a.n++
      a.total += r.responseSeconds
    } else agg.set(k, { moderatorId: r.moderatorId, platform: r.platform, n: 1, total: r.responseSeconds })
  }
  // Moderators active that day but with no responses get an explicit zero so
  // the average is honest (no row means "not computed").
  const active = new Set(rows.map((m) => resolveModerator(idx, m.platform, m.memberRef, m.displayName)).filter((x): x is string => !!x))
  for (const modId of active) for (const platform of ['discord', 'telegram'] as const) agg.set(`${modId}|${platform}`, agg.get(`${modId}|${platform}`) ?? { moderatorId: modId, platform, n: 0, total: 0 })
  let written = 0
  for (const a of agg.values()) {
    if (a.n === 0 && !rows.some((m) => m.platform === a.platform && resolveModerator(idx, m.platform, m.memberRef, m.displayName) === a.moderatorId)) continue
    await db
      .insert(moderatorResponseMetrics)
      .values({ workspaceId, moderatorId: a.moderatorId, platform: a.platform, day, responsesCount: a.n, avgResponseSeconds: a.n ? Math.round(a.total / a.n) : null })
      .onConflictDoUpdate({ target: [moderatorResponseMetrics.moderatorId, moderatorResponseMetrics.platform, moderatorResponseMetrics.day], set: { responsesCount: a.n, avgResponseSeconds: a.n ? Math.round(a.total / a.n) : null } })
    written++
  }
  if (written) await publish(workspaceId, 'moderator_response_metrics')
  return written
}

/** Nightly: yesterday for every workspace with moderators. */
export async function recordResponseMetricsForAll(now = new Date()): Promise<{ workspaces: number; rows: number }> {
  const y = new Date(now)
  y.setUTCDate(y.getUTCDate() - 1)
  const day = y.toISOString().slice(0, 10)
  const ws = await db.selectDistinct({ id: moderators.workspaceId }).from(moderators).where(sql`${moderators.discordUserId} is not null or ${moderators.telegramUserId} is not null or ${moderators.discordHandle} is not null or ${moderators.telegramHandle} is not null`)
  let rows = 0
  for (const w of ws) rows += await recordResponseMetrics(w.id, day)
  return { workspaces: ws.length, rows }
}
