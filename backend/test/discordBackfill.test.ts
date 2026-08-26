import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, like } from 'drizzle-orm'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { encryptJson } = await import('../src/lib/crypto.js')
const { runDiscordBackfill, BACKFILL_DAYS } = await import('../src/jobs/discordBackfill.js')
const { enqueueDueSyncs } = await import('../src/jobs/scheduler.js')
const { resetRateLimitState } = await import('../src/integrations/discord/rest.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
const GUILD = '223456789012345678'
const BASE = Date.now()
const snow = (msAgo: number, n = 1n) => String((BigInt(BASE - msAgo - 1_420_070_400_000) << 22n) | n)
const DAY = 86_400_000

// Channel A: page 1 = 100 messages inside the window (2 bots), page 2 = 50
// messages, the last 10 older than the cutoff. Channel B: 403. Thread T: 5
// messages. One 429 on the first request of page 2. Audit log: 2 pages.
let rateLimitedOnce = false
const realFetch = globalThis.fetch
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }))
const msg = (msAgo: number, n: bigint, author: string, extra: Record<string, unknown> = {}) => ({ id: snow(msAgo, n), timestamp: new Date(BASE - msAgo).toISOString(), type: 0, author: { id: author, username: `u${author}` }, content: 'hi', ...extra })
const pageA1 = Array.from({ length: 100 }, (_, i) => msg((i + 1) * 60_000, BigInt(1000 + i), i % 2 === 0 ? '1' : '2', i < 2 ? { author: { id: '9', username: 'bot', bot: true } } : {}))
const pageA2 = [...Array.from({ length: 40 }, (_, i) => msg(2 * DAY + i * 60_000, BigInt(2000 + i), '3')), ...Array.from({ length: 10 }, (_, i) => msg((BACKFILL_DAYS + 1) * DAY + i * 60_000, BigInt(3000 + i), '4'))]
const pageT = Array.from({ length: 5 }, (_, i) => msg(3 * DAY + i * 60_000, BigInt(4000 + i), '5'))
const audit1 = Array.from({ length: 100 }, (_, i) => ({ id: snow(i * 3_600_000, BigInt(5000 + i)), action_type: i % 3 === 0 ? 22 : i % 3 === 1 ? 20 : 11, user_id: i % 2 === 0 ? '7' : '8', target_id: '1' }))
const audit2 = [{ id: snow(5 * DAY, 6000n), action_type: 22, user_id: '7', target_id: '2' }, { id: snow((BACKFILL_DAYS + 2) * DAY, 6001n), action_type: 22, user_id: '7', target_id: '3' }]

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  if (url.includes(`/guilds/${GUILD}/channels`)) return json(200, [{ id: 'A', type: 0, name: 'general' }, { id: 'B', type: 0, name: 'secret' }, { id: 'V', type: 2, name: 'voice' }])
  if (url.includes(`/guilds/${GUILD}/threads/active`)) return json(200, { threads: [{ id: 'T', type: 11, name: 'thread', parent_id: 'A' }] })
  if (url.includes('/channels/B/messages')) return json(403, { message: 'Missing Access' })
  if (url.includes('/channels/A/messages')) {
    if (!url.includes('before=')) return json(200, pageA1, { 'x-ratelimit-remaining': '4', 'x-ratelimit-reset-after': '1' })
    if (!rateLimitedOnce) {
      rateLimitedOnce = true
      return json(429, { retry_after: 0.01, global: false })
    }
    return json(200, pageA2)
  }
  if (url.includes('/channels/T/messages')) return json(200, url.includes('before=') ? [] : pageT)
  if (url.includes(`/guilds/${GUILD}/audit-logs`)) return json(200, url.includes('before=') ? { audit_log_entries: audit2, users: [{ id: '7', username: 'modseven' }] } : { audit_log_entries: audit1, users: [{ id: '7', username: 'modseven' }, { id: '8', username: 'modeight' }] })
  if (url.includes(`/guilds/${GUILD}`)) return json(200, { name: 'G', icon: null, approximate_member_count: 10 })
  return realFetch(input, init)
}

let ws = ''
let cookie = ''

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch)
  resetRateLimitState()
  app = await buildApp()
  await db.delete(schema.rateLimit)
  const email = `bf-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: 'bf', email, password: 'backfill-test-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'backfill-test-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
  ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Backfill' }, headers: { cookie } })).json().id
  await db.insert(schema.integrations).values({ workspaceId: ws, platform: 'discord', status: 'connected', credentialsEnc: encryptJson({ bot_token: 'good', server_id: GUILD }), metadata: { backfill: { status: 'queued' } } })
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await db.delete(schema.user).where(like(schema.user.email, 'bf-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('discord backfill', () => {
  it('the tick enqueues a queued backfill once (singleton key)', async () => {
    const sent: Array<{ q: string; key?: string }> = []
    const boss = { send: async (q: string, _d: unknown, o: { singletonKey?: string }) => void sent.push({ q, key: o.singletonKey }) }
    await enqueueDueSyncs(boss as never)
    expect(sent.filter((s) => s.key === `${ws}:discord-backfill`).map((s) => s.q)).toEqual(['discord-backfill'])
  })

  it('walks channels and threads to the cutoff, survives a 429 and a 403, imports the audit log', async () => {
    const r = await runDiscordBackfill(ws)
    expect(r).toMatchObject({ status: 'done', channelsTotal: 3, channelsDone: 2, channelsSkipped: 1 })
    // A: 98 humans page 1 + 40 in window page 2; T: 5. Bots and pre-cutoff rows excluded.
    expect(r!.messages).toBe(98 + 40 + 5)
    const stored = await db.select().from(schema.platformMessages).where(eq(schema.platformMessages.workspaceId, ws))
    expect(stored).toHaveLength(143)
    expect(stored.every((m) => m.source === 'backfill')).toBe(true)
    const cursor = await db.query.discordChannelCursors.findFirst({ where: and(eq(schema.discordChannelCursors.workspaceId, ws), eq(schema.discordChannelCursors.channelId, 'A')) })
    expect(cursor?.lastMessageId).toBe(pageA1[0]!.id)
    const [integ] = await db.select().from(schema.integrations).where(and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.platform, 'discord')))
    expect(integ!.metadata).toMatchObject({ audit_log: 'ok', backfill: { status: 'done', messages: 143 } })
    const channels = await db.select().from(schema.platformChannels).where(eq(schema.platformChannels.workspaceId, ws))
    expect(channels.map((c) => c.channelId).sort()).toEqual(['A', 'B', 'T', 'V'])
    // Audit: page 1 has 34 bans (i % 3 === 0) + 33 kicks, page 2 adds 1 ban in window, 1 outside.
    const actions = await db.select().from(schema.moderatorActions).where(eq(schema.moderatorActions.workspaceId, ws))
    expect(actions.filter((a) => a.actionType === 'ban')).toHaveLength(35)
    expect(actions.filter((a) => a.actionType === 'kick')).toHaveLength(33)
    expect(actions.find((a) => a.executorRef === '7')?.executorName).toBe('modseven')
    expect(r!.actions).toBe(68)
  })

  it('re-running is idempotent and the manual endpoint guards against overlap', async () => {
    const again = await runDiscordBackfill(ws)
    expect(again!.messages).toBe(0)
    const stored = await db.select().from(schema.platformMessages).where(eq(schema.platformMessages.workspaceId, ws))
    expect(stored).toHaveLength(143)
    const mm = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/member-messages?days=40&platform=discord`, headers: { cookie } })
    const total = (mm.json().members as Array<{ messages: number }>).reduce((s, m) => s + m.messages, 0)
    expect(total).toBe(143)
    const ok = await app.inject({ method: 'POST', url: `/workspaces/${ws}/integrations/discord/backfill`, headers: { cookie } })
    expect(ok.statusCode).toBe(200)
    const dup = await app.inject({ method: 'POST', url: `/workspaces/${ws}/integrations/discord/backfill`, headers: { cookie } })
    expect(dup.statusCode).toBe(409)
  })
})
