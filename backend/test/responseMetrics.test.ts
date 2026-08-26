import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { computeResponses, recordResponseMetrics } = await import('../src/jobs/responseMetrics.js')
const { identityIndex, resolveModerator } = await import('../src/jobs/moderatorPerformance.js')
type ResponseMsg = import('../src/jobs/responseMetrics.js').ResponseMsg

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
let ws = ''
let cookie = ''
let modA = ''
let modB = ''

const T0 = Date.UTC(2026, 7, 20, 10, 0, 0)
const at = (min: number) => new Date(T0 + min * 60_000)
const msg = (id: string, min: number, memberRef: string, extra: Partial<ResponseMsg> = {}): ResponseMsg => ({ platform: 'discord', channelId: 'c1', messageId: id, memberRef, displayName: null, replyToMessageId: null, sentAt: at(min), ...extra })
const MODS = new Set(['m1', 'm2'])
const resolve = (m: ResponseMsg) => (MODS.has(m.memberRef) ? m.memberRef : undefined)

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
  const email = `rm-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: 'rm', email, password: 'response-test-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'response-test-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
  ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'RM' }, headers: { cookie } })).json().id
})
afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'rm-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('computeResponses (pure)', () => {
  it('explicit reply, implicit latest unanswered, window, moderator to moderator ignored', () => {
    const out = computeResponses(
      [
        msg('q1', 0, 'u1'),
        msg('q2', 2, 'u2'),
        msg('a1', 5, 'm1', { replyToMessageId: 'q1' }), // explicit → q1, 5 min
        msg('a2', 6, 'm2'), // implicit → latest unanswered = q2, 4 min
        msg('q3', 10, 'u3'),
        msg('mm', 12, 'm1', { replyToMessageId: 'a2' }), // reply to a moderator: no response
        msg('q4', 20, 'u4'),
        msg('a3', 90, 'm1'), // q3 and q4 older than 60 min: nothing to answer
        msg('q5', 100, 'u5', { channelId: 'c2' }),
        msg('a4', 101, 'm2', { channelId: 'c2' }), // other channel, 1 min
      ],
      resolve,
    )
    expect(out.map((r) => `${r.moderatorId}:${r.responseSeconds}`)).toEqual(['m1:300', 'm2:240', 'm2:60'])
  })
  it('identity: user id first, handle fallback, @ and case insensitive', () => {
    const idx = identityIndex([
      { id: 'A', discordHandle: 'Ann', telegramHandle: null, discordUserId: '111111111111111111', telegramUserId: null },
      { id: 'B', discordHandle: null, telegramHandle: '@Ben', discordUserId: null, telegramUserId: '222' },
    ])
    expect(resolveModerator(idx, 'discord', '111111111111111111', 'somebody-else')).toBe('A')
    expect(resolveModerator(idx, 'discord', '999', 'ANN')).toBe('A')
    expect(resolveModerator(idx, 'telegram', '222', null)).toBe('B')
    expect(resolveModerator(idx, 'telegram', '333', '@ben')).toBe('B')
    expect(resolveModerator(idx, 'telegram', '333', 'ann')).toBeUndefined()
  })
})

describe('response metrics + actions endpoints', () => {
  it('stores per moderator per day and feeds the actions attribution', async () => {
    const a = await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators`, payload: { fullName: 'Ann', discordUserId: '111111111111111111', discordHandle: 'ann' }, headers: { cookie } })
    expect(a.statusCode, a.body).toBe(201)
    expect(a.json().discordUserId).toBe('111111111111111111')
    modA = a.json().id
    const b = await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators`, payload: { fullName: 'Ben', telegramHandle: '@ben', discordUserId: '' }, headers: { cookie } })
    expect(b.statusCode, b.body).toBe(201)
    expect(b.json().discordUserId).toBeNull()
    modB = b.json().id
    const day = '2026-08-20'
    await db.insert(schema.platformMessages).values([
      { workspaceId: ws, platform: 'discord', messageId: 'q1', channelId: 'c1', memberRef: 'u1', sentAt: at(0), source: 'gateway' },
      { workspaceId: ws, platform: 'discord', messageId: 'a1', channelId: 'c1', memberRef: '111111111111111111', displayName: 'ann', sentAt: at(3), source: 'gateway' },
      { workspaceId: ws, platform: 'telegram', messageId: 't1', channelId: 'g', memberRef: '500', sentAt: at(0), source: 'webhook' },
      { workspaceId: ws, platform: 'telegram', messageId: 't2', channelId: 'g', memberRef: '501', displayName: '@Ben', sentAt: at(9), source: 'webhook' },
      // Ben on Discord: active, no answers → explicit zero row
      { workspaceId: ws, platform: 'discord', messageId: 'b1', channelId: 'c9', memberRef: '777', displayName: 'ben', sentAt: at(30), source: 'gateway' },
    ])
    expect(await recordResponseMetrics(ws, day)).toBe(2)
    const rm = await app.inject({ method: 'GET', url: `/workspaces/${ws}/moderators/response-metrics?sinceDays=30`, headers: { cookie } })
    const rows = rm.json().metrics as Array<{ moderatorId: string; platform: string; responsesCount: number; avgResponseSeconds: number | null }>
    expect(rows.find((r) => r.moderatorId === modA)).toMatchObject({ platform: 'discord', responsesCount: 1, avgResponseSeconds: 180 })
    expect(rows.find((r) => r.moderatorId === modB && r.platform === 'telegram')).toMatchObject({ responsesCount: 1, avgResponseSeconds: 540 })
    expect(rows.find((r) => r.moderatorId === modB && r.platform === 'discord')).toBeUndefined()
    const recompute = await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators/response-metrics/recompute`, payload: { days: 2 }, headers: { cookie } })
    expect(recompute.statusCode).toBe(200)

    await db.insert(schema.moderatorActions).values([
      { workspaceId: ws, platform: 'discord', actionId: '1', actionType: 'ban', executorRef: '111111111111111111', executorName: 'ann', occurredAt: new Date() },
      { workspaceId: ws, platform: 'discord', actionId: '2', actionType: 'timeout', executorRef: '111111111111111111', executorName: 'ann', occurredAt: new Date() },
      { workspaceId: ws, platform: 'telegram', actionId: '3', actionType: 'mute', executorRef: '501', executorName: '@ben', occurredAt: new Date() },
      { workspaceId: ws, platform: 'telegram', actionId: '4', actionType: 'ban', executorRef: '600', executorName: '@stranger', occurredAt: new Date() },
    ])
    const acts = await app.inject({ method: 'GET', url: `/workspaces/${ws}/moderators/actions?sinceDays=7`, headers: { cookie } })
    expect(acts.statusCode).toBe(200)
    const by = acts.json().byModerator as Array<Record<string, unknown>>
    expect(by.find((x) => x.moderatorId === modA)).toMatchObject({ bans: 1, timeouts: 1 })
    expect(by.find((x) => x.moderatorId === modB)).toMatchObject({ mutes: 1 })
    expect(by).toHaveLength(2)
    expect(acts.json().rows).toHaveLength(4)
  })
  it('member picker lists recent members and telegram admins', async () => {
    await db.insert(schema.memberMessages).values([
      { workspaceId: ws, platform: 'telegram', memberRef: '501', displayName: '@Ben', day: new Date().toISOString().slice(0, 10), messageCount: 4 },
      { workspaceId: ws, platform: 'telegram', memberRef: '502', displayName: 'Carla', day: new Date().toISOString().slice(0, 10), messageCount: 1 },
    ])
    await db.insert(schema.integrations).values({ workspaceId: ws, platform: 'telegram', status: 'connected', credentialsEnc: null, metadata: { admins: [{ id: '5', username: 'owner', first_name: null }, { id: '501', username: 'Ben', first_name: null }] } })
    const all = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/platform-members?platform=telegram`, headers: { cookie } })
    const rows = all.json().rows as Array<{ memberRef: string; isAdmin: boolean; messages: number }>
    expect(rows.map((r) => r.memberRef)).toEqual(['501', '502', '5'])
    expect(rows[0]).toMatchObject({ isAdmin: true, messages: 4 })
    const q = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/platform-members?platform=telegram&q=own`, headers: { cookie } })
    expect(q.json().rows.map((r: { memberRef: string }) => r.memberRef)).toEqual(['5'])
  })
})
