import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { memberMessages, moderators, moderatorShiftEvents, type Moderator } from '../db/schema/index.js'
import { publish } from '../lib/events.js'

// Links moderators to platform members by handle (the only identifier the
// roster stores), derives activity counters and daily punctuality events.
// Nothing is estimated: a moderator without a matching handle simply has no
// measured activity.

export const ON_TIME_TOLERANCE_MS = 15 * 60_000

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/^@/, '').toLowerCase()

/** (platform, normalised display name) → moderator id. */
export function handleIndex(mods: Pick<Moderator, 'id' | 'discordHandle' | 'telegramHandle'>[]): Map<string, string> {
  const idx = new Map<string, string>()
  for (const m of mods) {
    const d = norm(m.discordHandle)
    const t = norm(m.telegramHandle)
    if (d) idx.set(`discord:${d}`, m.id)
    if (t) idx.set(`telegram:${t}`, m.id)
  }
  return idx
}

export interface PerformanceRow {
  moderatorId: string
  messages: number
  activeDays: number
  lastActiveAt: Date | null
  platforms: string[]
}

export async function moderatorPerformance(workspaceId: string, sinceDays = 30): Promise<PerformanceRow[]> {
  const mods = await db.select({ id: moderators.id, discordHandle: moderators.discordHandle, telegramHandle: moderators.telegramHandle }).from(moderators).where(eq(moderators.workspaceId, workspaceId))
  const idx = handleIndex(mods)
  if (idx.size === 0) return mods.map((m) => ({ moderatorId: m.id, messages: 0, activeDays: 0, lastActiveAt: null, platforms: [] }))
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)
  const rows = await db
    .select({ platform: memberMessages.platform, displayName: memberMessages.displayName, day: memberMessages.day, count: memberMessages.messageCount, last: memberMessages.lastMessageAt })
    .from(memberMessages)
    .where(and(eq(memberMessages.workspaceId, workspaceId), gte(memberMessages.day, since)))
  const acc = new Map<string, PerformanceRow & { days: Set<string>; plats: Set<string> }>()
  for (const m of mods) acc.set(m.id, { moderatorId: m.id, messages: 0, activeDays: 0, lastActiveAt: null, platforms: [], days: new Set(), plats: new Set() })
  for (const r of rows) {
    const modId = idx.get(`${r.platform}:${norm(r.displayName)}`)
    if (!modId) continue
    const a = acc.get(modId)!
    a.messages += r.count
    a.days.add(r.day)
    a.plats.add(r.platform)
    if (r.last && (!a.lastActiveAt || r.last > a.lastActiveAt)) a.lastActiveAt = r.last
  }
  return [...acc.values()].map((a) => ({ moderatorId: a.moderatorId, messages: a.messages, activeDays: a.days.size, lastActiveAt: a.lastActiveAt, platforms: [...a.plats].sort() }))
}

// ---- punctuality -------------------------------------------------------------

/** Shift window for a UTC calendar day; overnight shifts end on the next day. */
export function shiftWindow(day: string, startUtc: number, endUtc: number): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00Z`)
  start.setUTCHours(startUtc)
  const end = new Date(`${day}T00:00:00Z`)
  end.setUTCHours(endUtc)
  if (end <= start) end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

export interface ShiftEvalInput {
  day: string
  startUtc: number
  endUtc: number
  /** First message timestamps of the moderator's members on `day` and the next day (overnight). */
  firstMessages: Date[]
}

export function evaluateShift(i: ShiftEvalInput): { firstActivity: Date | null; wasOnTime: boolean | null } {
  const { start, end } = shiftWindow(i.day, i.startUtc, i.endUtc)
  const inWindow = i.firstMessages.filter((t) => t.getTime() >= start.getTime() - ON_TIME_TOLERANCE_MS && t <= end).sort((a, b) => a.getTime() - b.getTime())
  const first = inWindow[0] ?? null
  return { firstActivity: first, wasOnTime: first ? first.getTime() <= start.getTime() + ON_TIME_TOLERANCE_MS : false }
}

/** Writes one shift event per scheduled moderator for `day` (YYYY-MM-DD, UTC). */
export async function recordShiftEvents(workspaceId: string, day: string): Promise<number> {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  const mods = await db.select().from(moderators).where(eq(moderators.workspaceId, workspaceId))
  const scheduled = mods.filter((m) => m.shiftStartUtc !== null && m.shiftEndUtc !== null && m.shiftDays.includes(weekday))
  if (scheduled.length === 0) return 0
  const idx = handleIndex(scheduled)
  const nextDay = new Date(`${day}T00:00:00Z`)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  const rows = await db
    .select({ platform: memberMessages.platform, displayName: memberMessages.displayName, first: memberMessages.firstMessageAt })
    .from(memberMessages)
    .where(and(eq(memberMessages.workspaceId, workspaceId), gte(memberMessages.day, day), lte(memberMessages.day, nextDay.toISOString().slice(0, 10))))
  const firstsByMod = new Map<string, Date[]>()
  for (const r of rows) {
    const id = idx.get(`${r.platform}:${norm(r.displayName)}`)
    if (!id || !r.first) continue
    firstsByMod.set(id, [...(firstsByMod.get(id) ?? []), r.first])
  }
  let written = 0
  for (const m of scheduled) {
    const { start, end } = shiftWindow(day, m.shiftStartUtc!, m.shiftEndUtc!)
    const ev = evaluateShift({ day, startUtc: m.shiftStartUtc!, endUtc: m.shiftEndUtc!, firstMessages: firstsByMod.get(m.id) ?? [] })
    await db
      .insert(moderatorShiftEvents)
      .values({ workspaceId, moderatorId: m.id, day, expectedStartUtc: start, expectedEndUtc: end, firstActivityUtc: ev.firstActivity, wasOnTime: ev.wasOnTime })
      .onConflictDoUpdate({ target: [moderatorShiftEvents.moderatorId, moderatorShiftEvents.day], set: { expectedStartUtc: start, expectedEndUtc: end, firstActivityUtc: ev.firstActivity, wasOnTime: ev.wasOnTime } })
    written++
  }
  if (written) await publish(workspaceId, 'moderator_shift_events')
  return written
}

/** Nightly: evaluate yesterday for every workspace that has scheduled moderators. */
export async function recordShiftEventsForAll(now = new Date()): Promise<{ workspaces: number; events: number }> {
  const y = new Date(now)
  y.setUTCDate(y.getUTCDate() - 1)
  const day = y.toISOString().slice(0, 10)
  const ws = await db.selectDistinct({ id: moderators.workspaceId }).from(moderators).where(sql`${moderators.shiftStartUtc} is not null`)
  let events = 0
  for (const w of ws) events += await recordShiftEvents(w.id, day)
  return { workspaces: ws.length, events }
}
