import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, like } from 'drizzle-orm'

process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { encryptJson } = await import('../src/lib/crypto.js')
const { isDue, jitterMs, enqueueDueSyncs, PLATFORM_MIN_INTERVAL_MS } = await import('../src/jobs/scheduler.js')
const { classifyTransition } = await import('../src/jobs/telegramUpdate.js')
const { syncDiscordActivity } = await import('../src/jobs/discordActivity.js')
const { syncDiscordMembers } = await import('../src/jobs/discordMembers.js')
const { runRetention } = await import('../src/jobs/retention.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
const CHAT = '-1009876543210'

// Stubbed Discord: 2 text channels; channel A has 3 human + 1 bot message
// after the cursor, channel B is forbidden. Members endpoint: 2 humans + 1 bot,
// or 403 when `intentOff`.
let intentOff = false
const realFetch = globalThis.fetch
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
const BASE = Date.now() // stable ids across calls so re-reads dedupe
const snow = (msAgo: number, n = 1n) => String((BigInt(BASE - msAgo - 1_420_070_400_000) << 22n) | n)
function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  if (url.includes('/guilds/123456789012345678/channels')) return json(200, [{ id: '100', type: 0 }, { id: '200', type: 0 }, { id: '300', type: 2 }])
  if (url.includes('/channels/200/messages')) return json(403, {})
  if (url.includes('/channels/100/messages')) {
    if (!url.includes('after=')) return json(200, [{ id: snow(60_000) }]) // first run → anchor only
    return json(200, [
      { id: snow(30_000, 2n), author: { id: '11', username: 'ann', bot: false }, content: 'hello' },
      { id: snow(20_000, 3n), author: { id: '12', username: 'bot', bot: true } },
      { id: snow(10_000, 4n), author: { id: '11', username: 'ann', bot: false } },
      { id: snow(5_000, 5n), author: { id: '13', username: 'ben', bot: false } },
    ])
  }
  if (url.includes('/guilds/123456789012345678/members')) {
    if (intentOff) return json(403, { message: 'Missing Access' })
    return json(200, [{ user: { id: '1' }, joined_at: '2026-01-01T00:00:00Z' }, { user: { id: '2', bot: true } }, { user: { id: '3' }, joined_at: '2026-06-01T00:00:00Z' }])
  }
  if (url.includes('/guilds/123456789012345678')) return json(200, { name: 'G', icon: null, approximate_member_count: 10 })
  return realFetch(input, init)
}

async function makeUser(tag: string) {
  const email = `wk-${tag}-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: tag, email, password: 'worker-test-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'worker-test-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  return (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
}

let ws = ''
let cookie = ''
beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch)
  app = await buildApp()
  await db.delete(schema.rateLimit)
  cookie = await makeUser('a')
  ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Worker' }, headers: { cookie } })).json().id
  await db.insert(schema.integrations).values([
    { workspaceId: ws, platform: 'telegram', status: 'connected', credentialsEnc: encryptJson({ bot_token: 'x', chat_id: CHAT }), metadata: {} },
    { workspaceId: ws, platform: 'discord', status: 'connected', credentialsEnc: encryptJson({ bot_token: 'good', server_id: '123456789012345678' }), metadata: {} },
  ])
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await db.delete(schema.user).where(like(schema.user.email, 'wk-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('scheduler rules', () => {
  it('jitter is deterministic and inside the window', () => {
    expect(jitterMs(ws)).toBe(jitterMs(ws))
    expect(jitterMs(ws)).toBeLessThan(45_000)
  })
  it('due on last ATTEMPT with grace; platform floors', () => {
    const now = Date.now()
    expect(isDue(null, 60_000, now)).toBe(true)
    expect(isDue(new Date(now - 50_000), 60_000, now)).toBe(false)
    expect(isDue(new Date(now - 56_000), 60_000, now)).toBe(true)
    expect(PLATFORM_MIN_INTERVAL_MS.galxe).toBe(300_000)
  })
  it('enqueues one singleton job per due (workspace, platform)', async () => {
    const sent: Array<{ q: string; key?: string }> = []
    const boss = { send: async (q: string, _d: unknown, o: { singletonKey?: string }) => void sent.push({ q, key: o.singletonKey }) }
    const r = await enqueueDueSyncs(boss as never)
    expect(r.integrations).toBeGreaterThanOrEqual(2)
    const mine = sent.filter((s) => s.key?.startsWith(ws))
    expect(mine.map((s) => s.q).sort()).toEqual(['discord-activity', 'discord-members', 'sync-platform', 'sync-platform'])
  })
})

describe('telegram webhook', () => {
  const post = (body: unknown, secret = 'test-webhook-secret') => app.inject({ method: 'POST', url: '/webhooks/telegram', payload: body as object, headers: { 'x-telegram-bot-api-secret-token': secret } })

  it('rejects a bad secret', async () => {
    expect((await post({}, 'nope')).statusCode).toBe(401)
  })
  it('counts messages per member and per hour, dedups redeliveries, classifies membership', async () => {
    const msg = { update_id: 1, message: { chat: { id: Number(CHAT) }, from: { id: 42, username: 'lena' }, date: Math.floor(Date.now() / 1000) } }
    expect((await post(msg)).statusCode).toBe(200)
    expect((await post(msg)).statusCode).toBe(200) // redelivery
    await post({ update_id: 2, message: { chat: { id: Number(CHAT) }, from: { id: 42, username: 'lena' }, date: Math.floor(Date.now() / 1000) } })
    await post({ update_id: 3, message: { chat: { id: Number(CHAT) }, from: { id: 7, is_bot: true }, date: Math.floor(Date.now() / 1000) } })

    const mm = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/member-messages?days=2`, headers: { cookie } })
    expect(mm.json().members).toEqual([{ memberRef: '42', displayName: '@lena', messages: 2 }])
    const act = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/activity?days=1`, headers: { cookie } })
    expect(act.json().rows.reduce((s: number, r: { count: number }) => s + r.count, 0)).toBe(2)

    expect(classifyTransition({ status: 'left' }, { status: 'member' })).toBe('join')
    expect(classifyTransition({ status: 'member' }, { status: 'administrator' })).toBeNull()
    expect(classifyTransition({ status: 'member' }, { status: 'restricted', is_member: true })).toBeNull()
    expect(classifyTransition({ status: 'member' }, { status: 'kicked' })).toBe('leave')

    await post({ update_id: 4, chat_member: { chat: { id: Number(CHAT) }, date: Math.floor(Date.now() / 1000), old_chat_member: { user: { id: 9 }, status: 'left' }, new_chat_member: { user: { id: 9 }, status: 'member' } } })
    await post({ update_id: 5, chat_member: { chat: { id: Number(CHAT) }, date: Math.floor(Date.now() / 1000), old_chat_member: { user: { id: 9 }, status: 'member' }, new_chat_member: { user: { id: 9 }, status: 'administrator' } } })
    const tm = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/telegram-membership?hours=1`, headers: { cookie } })
    expect(tm.json()).toMatchObject({ joins: 1, leaves: 0 })
    expect((await post({ update_id: 6, message: { chat: { id: 555 }, from: { id: 1 }, date: 1 } })).statusCode).toBe(200) // unknown chat ignored
  })
})

describe('discord jobs', () => {
  it('activity: first run anchors cursors, second run counts humans only; forbidden channel skipped', async () => {
    const first = await syncDiscordActivity(ws)
    expect(first).toMatchObject({ channels: 2, messages: 0 })
    const second = await syncDiscordActivity(ws)
    expect(second?.messages).toBe(3)
    const cursor = await db.query.discordChannelCursors.findFirst({ where: and(eq(schema.discordChannelCursors.workspaceId, ws), eq(schema.discordChannelCursors.channelId, '100')) })
    expect(cursor?.lastMessageId).toBeTruthy()
    // Re-reading the same page (cursor reset) must not double count: the
    // message store is the source of truth for every counter.
    await db.update(schema.discordChannelCursors).set({ lastMessageId: '1' }).where(eq(schema.discordChannelCursors.workspaceId, ws))
    const third = await syncDiscordActivity(ws)
    expect(third?.messages).toBe(0)
    const mm = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/member-messages?days=2&platform=discord`, headers: { cookie } })
    expect(mm.json().members).toEqual([
      { memberRef: '11', displayName: 'ann', messages: 2 },
      { memberRef: '13', displayName: 'ben', messages: 1 },
    ])
    const stored = await db.select().from(schema.platformMessages).where(eq(schema.platformMessages.workspaceId, ws))
    expect(stored.filter((m) => m.platform === 'discord')).toHaveLength(3)
    expect(stored.find((m) => m.hasContent)?.contentEnc).toMatch(/^v1:/)
    const ch = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/channels?days=2`, headers: { cookie } })
    expect(ch.json().rows.find((r: { channelId: string }) => r.channelId === '100')).toMatchObject({ platform: 'discord', messages: 3, activeMembers: 2 })
  })
  it('members: records tenure + snapshot, reports the missing intent explicitly, manual route is gated', async () => {
    const r = await syncDiscordMembers(ws)
    expect(r).toMatchObject({ ok: true, total: 2, new: 2, left: 0 })
    const throttled = await syncDiscordMembers(ws)
    expect(throttled).toMatchObject({ ok: false, code: 'THROTTLED' })
    intentOff = true
    const manual = await app.inject({ method: 'POST', url: `/workspaces/${ws}/integrations/discord/members-sync`, headers: { cookie } })
    expect(manual.statusCode).toBe(422)
    expect(manual.json().error.code).toBe('MISSING_MEMBERS_INTENT')
    intentOff = false
    const tenure = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/discord-tenure`, headers: { cookie } })
    expect(tenure.json().rows).toHaveLength(2)
  })
})

describe('retention', () => {
  it('deletes snapshots older than 30 days only', async () => {
    await db.insert(schema.platformMetricSnapshots).values([
      { workspaceId: ws, platform: 'telegram', capturedAt: new Date(Date.now() - 40 * 86_400_000), metrics: { members: 1 } },
      { workspaceId: ws, platform: 'telegram', capturedAt: new Date(), metrics: { members: 2 } },
    ])
    const r = await runRetention()
    expect(r.snapshots).toBeGreaterThanOrEqual(1)
    const left = await db.select().from(schema.platformMetricSnapshots).where(eq(schema.platformMetricSnapshots.workspaceId, ws))
    expect(left).toHaveLength(1)
  })
})
