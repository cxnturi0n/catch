// Every number in the report is computed here, in SQL, for two equal windows:
// the period and the one right before it. Nothing downstream recomputes.
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../../../db/client.js'
import {
  contentSchedule,
  discordMembershipSnapshots,
  incidents,
  integrationSyncState,
  integrations,
  kols,
  meetings,
  memberMessages,
  messageActivity,
  moderatorShiftEvents,
  moderators,
  payments,
  platformMetrics,
  tasks,
  telegramMembershipEvents,
} from '../../../db/schema/index.js'
import { moderatorPerformance } from '../../../jobs/moderatorPerformance.js'
import type { Coverage } from './template.js'

export interface Window {
  /** Inclusive calendar days, UTC. */
  start: string
  end: string
  startTs: Date
  /** Exclusive. */
  endTs: Date
  days: number
}

export function windows(days: number, now = new Date()): { cur: Window; prev: Window } {
  const endTs = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const mk = (endExclusive: Date): Window => {
    const startTs = new Date(endExclusive.getTime() - days * 86_400_000)
    const lastDay = new Date(endExclusive.getTime() - 86_400_000)
    return { start: iso(startTs), end: iso(lastDay), startTs, endTs: endExclusive, days }
  }
  const cur = mk(endTs)
  const prev = mk(cur.startTs)
  return { cur, prev }
}
const iso = (d: Date) => d.toISOString().slice(0, 10)

export interface PlatformMembers {
  platform: string
  first: number | null
  last: number | null
  series: { t: string; v: number }[]
}

export interface GrowthData {
  platforms: PlatformMembers[]
  prevPlatforms: PlatformMembers[]
  telegram: { joins: number; leaves: number; prevJoins: number; prevLeaves: number } | null
  discord: { joins: number; leaves: number; prevJoins: number; prevLeaves: number } | null
}

export interface EngagementData {
  messages: number
  prevMessages: number
  activeMembers: number
  prevActiveMembers: number
  /** Distinct active members per day, averaged over days with data. */
  avgDailyActive: number | null
  daily: { t: string; v: number }[]
  /** 24 buckets, UTC hour → messages in period. */
  hourly: number[]
  topMembers: { handle: string; platform: string; messages: number }[]
}

export interface ModerationData {
  moderators: { id: string; name: string; status: string; shiftStartUtc: number | null; shiftEndUtc: number | null; shiftDays: number[] }[]
  performance: { moderatorId: string; messages: number; activeDays: number; lastActiveAt: Date | null }[]
  shifts: { moderatorId: string; evaluated: number; onTime: number; noShow: number }[]
  prevShifts: { evaluated: number; onTime: number; noShow: number }
  paid: { currency: string; amount: number }[]
}

export interface IncidentData {
  total: number
  prevTotal: number
  byStatus: Record<string, number>
  byType: { type: string; n: number }[]
  openOlderThan72h: number
}

export interface KolData {
  total: number
  byStatus: Record<string, number>
  activeInPeriod: number
  reach: number
}

export interface OperationsData {
  tasks: { total: number; done: number; overdue: number; doneInPeriod: number; prevDoneInPeriod: number }
  content: { scheduled: number; published: number; cancelled: number; prevPublished: number }
  meetings: { held: number; prevHeld: number }
}

export interface AllData {
  coverage: Coverage
  growth: GrowthData
  engagement: EngagementData
  moderation: ModerationData
  incidents: IncidentData
  kols: KolData
  operations: OperationsData
}

export async function collect(workspaceId: string, cur: Window, prev: Window): Promise<AllData> {
  const [coverage, growth, engagement, moderation, inc, kol, ops] = await Promise.all([
    coverageOf(workspaceId, cur),
    growthOf(workspaceId, cur, prev),
    engagementOf(workspaceId, cur, prev),
    moderationOf(workspaceId, cur, prev),
    incidentsOf(workspaceId, cur, prev),
    kolsOf(workspaceId, cur),
    operationsOf(workspaceId, cur, prev),
  ])
  return { coverage, growth, engagement, moderation, incidents: inc, kols: kol, operations: ops }
}

async function coverageOf(workspaceId: string, cur: Window): Promise<Coverage> {
  const [ints, states, [days], [mods]] = await Promise.all([
    db.select({ platform: integrations.platform, status: integrations.status, lastSync: integrations.lastSync }).from(integrations).where(eq(integrations.workspaceId, workspaceId)),
    db.select({ platform: integrationSyncState.platform, lastSuccessAt: integrationSyncState.lastSuccessAt, lastError: integrationSyncState.lastError }).from(integrationSyncState).where(eq(integrationSyncState.workspaceId, workspaceId)),
    db
      .select({ n: sql<number>`count(distinct ${platformMetrics.date})::int` })
      .from(platformMetrics)
      .where(and(eq(platformMetrics.workspaceId, workspaceId), gte(platformMetrics.date, cur.start))),
    db.select({ n: sql<number>`count(*)::int` }).from(moderators).where(eq(moderators.workspaceId, workspaceId)),
  ])
  const stateBy = new Map(states.map((s) => [s.platform, s]))
  return {
    platforms: ints.map((i) => {
      const st = stateBy.get(i.platform)
      const last = st?.lastSuccessAt ?? i.lastSync
      return { platform: i.platform, status: i.status, lastSyncAt: last ? last.toISOString() : null, lastError: st?.lastError ?? null }
    }),
    daysWithData: days?.n ?? 0,
    periodDays: cur.days,
    moderators: mods?.n ?? 0,
  }
}

async function membersSeries(workspaceId: string, w: Window): Promise<PlatformMembers[]> {
  const rows = await db
    .select({ platform: platformMetrics.platform, date: platformMetrics.date, members: sql<number | null>`(${platformMetrics.metrics}->>'members')::numeric` })
    .from(platformMetrics)
    .where(and(eq(platformMetrics.workspaceId, workspaceId), gte(platformMetrics.date, w.start), sql`${platformMetrics.date} <= ${w.end}`))
    .orderBy(asc(platformMetrics.platform), asc(platformMetrics.date))
  const by = new Map<string, PlatformMembers>()
  for (const r of rows) {
    if (r.members === null) continue
    const v = Number(r.members)
    const p = by.get(r.platform) ?? { platform: r.platform, first: null, last: null, series: [] }
    if (p.first === null) p.first = v
    p.last = v
    p.series.push({ t: r.date, v })
    by.set(r.platform, p)
  }
  return [...by.values()]
}

async function growthOf(workspaceId: string, cur: Window, prev: Window): Promise<GrowthData> {
  const tgCount = (w: Window) =>
    db
      .select({ eventType: telegramMembershipEvents.eventType, n: sql<number>`count(*)::int` })
      .from(telegramMembershipEvents)
      .where(and(eq(telegramMembershipEvents.workspaceId, workspaceId), gte(telegramMembershipEvents.occurredAt, w.startTs), lt(telegramMembershipEvents.occurredAt, w.endTs)))
      .groupBy(telegramMembershipEvents.eventType)
  const dcCount = (w: Window) =>
    db
      .select({ joins: sql<number>`coalesce(sum(${discordMembershipSnapshots.newMembers}),0)::int`, leaves: sql<number>`coalesce(sum(${discordMembershipSnapshots.leftMembers}),0)::int`, n: sql<number>`count(*)::int` })
      .from(discordMembershipSnapshots)
      .where(and(eq(discordMembershipSnapshots.workspaceId, workspaceId), gte(discordMembershipSnapshots.capturedAt, w.startTs), lt(discordMembershipSnapshots.capturedAt, w.endTs)))
  const [platforms, prevPlatforms, tgCur, tgPrev, [dcCur], [dcPrev]] = await Promise.all([membersSeries(workspaceId, cur), membersSeries(workspaceId, prev), tgCount(cur), tgCount(prev), dcCount(cur), dcCount(prev)])
  const tg = (rows: { eventType: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.eventType, r.n]))
  const tc = tg(tgCur)
  const tp = tg(tgPrev)
  const hasTg = tgCur.length > 0 || tgPrev.length > 0
  const hasDc = (dcCur?.n ?? 0) > 0 || (dcPrev?.n ?? 0) > 0
  return {
    platforms,
    prevPlatforms,
    telegram: hasTg ? { joins: tc.join ?? 0, leaves: tc.leave ?? 0, prevJoins: tp.join ?? 0, prevLeaves: tp.leave ?? 0 } : null,
    discord: hasDc ? { joins: dcCur?.joins ?? 0, leaves: dcCur?.leaves ?? 0, prevJoins: dcPrev?.joins ?? 0, prevLeaves: dcPrev?.leaves ?? 0 } : null,
  }
}

async function engagementOf(workspaceId: string, cur: Window, prev: Window): Promise<EngagementData> {
  const msgs = (w: Window) =>
    db
      .select({ n: sql<number>`coalesce(sum(${messageActivity.messageCount}),0)::int` })
      .from(messageActivity)
      .where(and(eq(messageActivity.workspaceId, workspaceId), gte(messageActivity.bucketStart, w.startTs), lt(messageActivity.bucketStart, w.endTs)))
  const active = (w: Window) =>
    db
      .select({ n: sql<number>`count(distinct ${memberMessages.platform} || ':' || ${memberMessages.memberRef})::int` })
      .from(memberMessages)
      .where(and(eq(memberMessages.workspaceId, workspaceId), gte(memberMessages.day, w.start), sql`${memberMessages.day} <= ${w.end}`))
  const where = and(eq(memberMessages.workspaceId, workspaceId), gte(memberMessages.day, cur.start), sql`${memberMessages.day} <= ${cur.end}`)
  const [[m], [pm], [a], [pa], daily, hourly, top] = await Promise.all([
    msgs(cur),
    msgs(prev),
    active(cur),
    active(prev),
    db
      .select({ t: memberMessages.day, v: sql<number>`sum(${memberMessages.messageCount})::int`, active: sql<number>`count(distinct ${memberMessages.memberRef})::int` })
      .from(memberMessages)
      .where(where)
      .groupBy(memberMessages.day)
      .orderBy(asc(memberMessages.day)),
    db
      .select({ h: sql<number>`extract(hour from ${messageActivity.bucketStart} at time zone 'UTC')::int`, n: sql<number>`sum(${messageActivity.messageCount})::int` })
      .from(messageActivity)
      .where(and(eq(messageActivity.workspaceId, workspaceId), gte(messageActivity.bucketStart, cur.startTs), lt(messageActivity.bucketStart, cur.endTs)))
      .groupBy(sql`1`),
    db
      .select({ handle: sql<string | null>`max(${memberMessages.displayName})`, platform: memberMessages.platform, messages: sql<number>`sum(${memberMessages.messageCount})::int` })
      .from(memberMessages)
      .where(where)
      .groupBy(memberMessages.platform, memberMessages.memberRef)
      .orderBy(desc(sql`sum(${memberMessages.messageCount})`))
      .limit(5),
  ])
  // message_activity exists only for live syncs; member_messages is the
  // denominator-safe fallback (demo/seeded data, Telegram webhook).
  const fromMembers = daily.reduce((s, d) => s + d.v, 0)
  const prevFromMembers = await db
    .select({ n: sql<number>`coalesce(sum(${memberMessages.messageCount}),0)::int` })
    .from(memberMessages)
    .where(and(eq(memberMessages.workspaceId, workspaceId), gte(memberMessages.day, prev.start), sql`${memberMessages.day} <= ${prev.end}`))
  const hours = new Array<number>(24).fill(0)
  for (const r of hourly) hours[r.h] = r.n
  return {
    messages: Math.max(m?.n ?? 0, fromMembers),
    prevMessages: Math.max(pm?.n ?? 0, prevFromMembers[0]?.n ?? 0),
    activeMembers: a?.n ?? 0,
    prevActiveMembers: pa?.n ?? 0,
    avgDailyActive: daily.length ? daily.reduce((s, d) => s + d.active, 0) / daily.length : null,
    daily: daily.map((d) => ({ t: d.t, v: d.v })),
    hourly: hours,
    topMembers: top.map((t) => ({ handle: t.handle ?? 'unknown', platform: t.platform, messages: t.messages })),
  }
}

async function moderationOf(workspaceId: string, cur: Window, prev: Window): Promise<ModerationData> {
  const shiftAgg = (w: Window) =>
    db
      .select({
        moderatorId: moderatorShiftEvents.moderatorId,
        evaluated: sql<number>`count(*)::int`,
        onTime: sql<number>`count(*) filter (where ${moderatorShiftEvents.wasOnTime})::int`,
        noShow: sql<number>`count(*) filter (where ${moderatorShiftEvents.firstActivityUtc} is null)::int`,
      })
      .from(moderatorShiftEvents)
      .where(and(eq(moderatorShiftEvents.workspaceId, workspaceId), gte(moderatorShiftEvents.day, w.start), sql`${moderatorShiftEvents.day} <= ${w.end}`))
      .groupBy(moderatorShiftEvents.moderatorId)
  const [mods, perf, shifts, prevShifts, paid] = await Promise.all([
    db
      .select({ id: moderators.id, name: moderators.fullName, status: moderators.status, shiftStartUtc: moderators.shiftStartUtc, shiftEndUtc: moderators.shiftEndUtc, shiftDays: moderators.shiftDays })
      .from(moderators)
      .where(eq(moderators.workspaceId, workspaceId))
      .orderBy(asc(moderators.createdAt)),
    moderatorPerformance(workspaceId, cur.days),
    shiftAgg(cur),
    shiftAgg(prev),
    db
      .select({ currency: payments.currency, amount: sql<number>`coalesce(sum(${payments.amount}),0)::float` })
      .from(payments)
      .where(and(eq(payments.workspaceId, workspaceId), gte(payments.paidAt, cur.startTs), lt(payments.paidAt, cur.endTs)))
      .groupBy(payments.currency),
  ])
  const p = prevShifts.reduce((a, s) => ({ evaluated: a.evaluated + s.evaluated, onTime: a.onTime + s.onTime, noShow: a.noShow + s.noShow }), { evaluated: 0, onTime: 0, noShow: 0 })
  return { moderators: mods, performance: perf, shifts, prevShifts: p, paid }
}

async function incidentsOf(workspaceId: string, cur: Window, prev: Window): Promise<IncidentData> {
  const inWindow = (w: Window) => and(eq(incidents.workspaceId, workspaceId), gte(incidents.date, w.start), sql`${incidents.date} <= ${w.end}`)
  const [byStatus, byType, [prevTotal], [stale]] = await Promise.all([
    db.select({ status: incidents.status, n: sql<number>`count(*)::int` }).from(incidents).where(inWindow(cur)).groupBy(incidents.status),
    db.select({ type: incidents.type, n: sql<number>`count(*)::int` }).from(incidents).where(inWindow(cur)).groupBy(incidents.type).orderBy(desc(sql`count(*)`)).limit(5),
    db.select({ n: sql<number>`count(*)::int` }).from(incidents).where(inWindow(prev)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidents)
      .where(and(eq(incidents.workspaceId, workspaceId), inArray(incidents.status, ['Open', 'Escalated']), sql`${incidents.createdAt} < now() - interval '72 hours'`)),
  ])
  const st = Object.fromEntries(byStatus.map((r) => [r.status, r.n]))
  return { total: byStatus.reduce((s, r) => s + r.n, 0), prevTotal: prevTotal?.n ?? 0, byStatus: st, byType, openOlderThan72h: stale?.n ?? 0 }
}

async function kolsOf(workspaceId: string, cur: Window): Promise<KolData> {
  const rows = await db.select({ status: kols.status, reach: kols.reach, lastActivity: kols.lastActivity }).from(kols).where(eq(kols.workspaceId, workspaceId))
  const byStatus: Record<string, number> = {}
  let active = 0
  let reach = 0
  for (const k of rows) {
    byStatus[k.status] = (byStatus[k.status] ?? 0) + 1
    reach += k.reach
    if (k.lastActivity && k.lastActivity >= cur.start) active += 1
  }
  return { total: rows.length, byStatus, activeInPeriod: active, reach }
}

async function operationsOf(workspaceId: string, cur: Window, prev: Window): Promise<OperationsData> {
  const doneIn = (w: Window) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, 'Done'), gte(tasks.updatedAt, w.startTs), lt(tasks.updatedAt, w.endTs)))
  const contentIn = (w: Window) =>
    db
      .select({ status: contentSchedule.status, n: sql<number>`count(*)::int` })
      .from(contentSchedule)
      .where(and(eq(contentSchedule.workspaceId, workspaceId), gte(contentSchedule.scheduledAt, w.startTs), lt(contentSchedule.scheduledAt, w.endTs)))
      .groupBy(contentSchedule.status)
  const meetingsIn = (w: Window) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(eq(meetings.workspaceId, workspaceId), gte(meetings.startsAt, w.startTs), lt(meetings.startsAt, w.endTs)))
  const [taskRows, [doneCur], [donePrev], cCur, cPrev, [mCur], [mPrev]] = await Promise.all([
    db
      .select({ status: tasks.status, overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < current_date and ${tasks.status} <> 'Done')::int`, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.workspaceId, workspaceId))
      .groupBy(tasks.status),
    doneIn(cur),
    doneIn(prev),
    contentIn(cur),
    contentIn(prev),
    meetingsIn(cur),
    meetingsIn(prev),
  ])
  const c = (rows: { status: string; n: number }[], s: string) => rows.find((r) => r.status === s)?.n ?? 0
  return {
    tasks: {
      total: taskRows.reduce((s, r) => s + r.n, 0),
      done: c(taskRows, 'Done'),
      overdue: taskRows.reduce((s, r) => s + r.overdue, 0),
      doneInPeriod: doneCur?.n ?? 0,
      prevDoneInPeriod: donePrev?.n ?? 0,
    },
    content: { scheduled: c(cCur, 'scheduled'), published: c(cCur, 'published'), cancelled: c(cCur, 'cancelled'), prevPublished: c(cPrev, 'published') },
    meetings: { held: mCur?.n ?? 0, prevHeld: mPrev?.n ?? 0 },
  }
}
