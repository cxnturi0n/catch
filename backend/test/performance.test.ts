import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { recordMemberMessage } = await import('../src/jobs/memberMessages.js')
const { evaluateShift, shiftWindow, recordShiftEvents, moderatorPerformance } = await import('../src/jobs/moderatorPerformance.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
let cookie = ''
let ws = ''

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
  const email = `perf-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: 'p', email, password: 'performance-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true, plan: 'pro' }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'performance-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
  ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Perf' }, headers: { cookie } })).json().id
})
afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'perf-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('shift evaluation (pure)', () => {
  it('overnight shifts end the next day; tolerance 15 min; early activity ignored', () => {
    const w = shiftWindow('2026-08-20', 22, 6)
    expect(w.end.toISOString()).toBe('2026-08-21T06:00:00.000Z')
    const onTime = evaluateShift({ day: '2026-08-20', startUtc: 9, endUtc: 17, firstMessages: [new Date('2026-08-20T09:10:00Z')] })
    expect(onTime).toMatchObject({ wasOnTime: true })
    const late = evaluateShift({ day: '2026-08-20', startUtc: 9, endUtc: 17, firstMessages: [new Date('2026-08-20T09:40:00Z')] })
    expect(late.wasOnTime).toBe(false)
    const noShow = evaluateShift({ day: '2026-08-20', startUtc: 9, endUtc: 17, firstMessages: [new Date('2026-08-20T07:00:00Z')] })
    expect(noShow).toEqual({ firstActivity: null, wasOnTime: false })
  })
})

describe('performance + punctuality from real member messages', () => {
  let lenaId = ''
  it('matches moderators by handle (case/@ insensitive) and aggregates', async () => {
    const c = await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators`, payload: { fullName: 'Lena', telegramHandle: '@Lena_Ortiz', discordHandle: 'lena', shiftStartUtc: 9, shiftEndUtc: 17, shiftDays: [0, 1, 2, 3, 4, 5, 6] }, headers: { cookie } })
    lenaId = c.json().id
    await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators`, payload: { fullName: 'Ghost' }, headers: { cookie } })

    const y = new Date()
    y.setUTCDate(y.getUTCDate() - 1)
    const day = y.toISOString().slice(0, 10)
    await recordMemberMessage(ws, 'telegram', '42', '@lena_ortiz', new Date(`${day}T09:05:00Z`))
    await recordMemberMessage(ws, 'telegram', '42', '@lena_ortiz', new Date(`${day}T12:00:00Z`))
    await recordMemberMessage(ws, 'discord', '777', 'lena', new Date(`${day}T15:00:00Z`))
    await recordMemberMessage(ws, 'telegram', '99', '@someone', new Date(`${day}T10:00:00Z`))

    const row = await db.query.memberMessages.findFirst({ where: eq(schema.memberMessages.memberRef, '42') })
    expect(row?.messageCount).toBe(2)
    expect(row?.firstMessageAt?.toISOString()).toBe(`${day}T09:05:00.000Z`)

    const perf = await moderatorPerformance(ws, 30)
    const lena = perf.find((p) => p.moderatorId === lenaId)!
    expect(lena).toMatchObject({ messages: 3, activeDays: 1, platforms: ['discord', 'telegram'] })
    expect(perf.find((p) => p.moderatorId !== lenaId)).toMatchObject({ messages: 0, activeDays: 0, lastActiveAt: null })

    const api = await app.inject({ method: 'GET', url: `/workspaces/${ws}/moderators/performance`, headers: { cookie } })
    expect(api.statusCode).toBe(200)
    expect(api.json().rows).toHaveLength(2)

    const written = await recordShiftEvents(ws, day)
    expect(written).toBe(1) // Ghost has no shift window
    const ev = await app.inject({ method: 'GET', url: `/workspaces/${ws}/moderators/shift-events?sinceDays=3`, headers: { cookie } })
    expect(ev.json().events[0]).toMatchObject({ moderatorId: lenaId, wasOnTime: true })
    expect(ev.json().events[0].firstActivityUtc).toContain('T09:05:00')

    const rc = await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators/shift-events/recompute`, payload: { days: 2 }, headers: { cookie } })
    expect(rc.json().events).toBe(2)
  })
})
