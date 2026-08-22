import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, like } from 'drizzle-orm'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()

// Fake platform APIs. Discord: valid token "Bot good", guild 123…; Telegram: token 111:AAA…
let tgMembers = 500
const realFetch = globalThis.fetch
function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
  if (url.startsWith('https://discord.com/api/v10/guilds/')) {
    const auth = (init?.headers as Record<string, string>)?.Authorization
    if (auth !== 'Bot good-token-good-token-good') return json(401, { message: 'Unauthorized' })
    if (url.includes('/audit-logs')) return json(200, { audit_log_entries: [{ id: String((BigInt(Date.now() - 1_420_070_400_000) << 22n) | 1n) }] })
    if (url.includes('/guilds/999999999999999999')) return json(404, {})
    return json(200, { name: 'Test Guild', icon: null, approximate_member_count: 1234 })
  }
  if (url.startsWith('https://api.telegram.org/bot')) {
    if (!url.includes('/bot111111111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/')) return json(401, { ok: false, description: 'Unauthorized' })
    if (url.includes('getChat?')) return json(200, { ok: true, result: { title: 'Test Chat', type: 'supergroup' } })
    if (url.includes('getChatMemberCount')) return json(200, { ok: true, result: tgMembers })
  }
  return realFetch(input, init)
}

async function makeUser(tag: string) {
  const email = `int-${tag}-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: tag, email, password: 'integrations-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'integrations-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  return (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch)
  app = await buildApp()
  await db.delete(schema.rateLimit)
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await db.delete(schema.user).where(like(schema.user.email, 'int-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('integrations connect/sync + metrics', () => {
  let cookie = ''
  let ws = ''
  const base = () => `/workspaces/${ws}/integrations`

  it('setup', async () => {
    cookie = await makeUser('a')
    ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Int' }, headers: { cookie } })).json().id
  })

  it('rejects bad credentials with a clean 400 and stores nothing', async () => {
    const r = await app.inject({ method: 'POST', url: `${base()}/discord/connect`, payload: { botToken: 'wrong-token-wrong-token-wrong', serverId: '123456789012345678' }, headers: { cookie } })
    expect(r.statusCode, r.body).toBe(400)
    expect(r.json().error.code).toBe('PLATFORM_INVALID_CREDENTIALS')
    expect(await db.query.integrations.findFirst({ where: eq(schema.integrations.workspaceId, ws) })).toBeUndefined()

    const shape = await app.inject({ method: 'POST', url: `${base()}/discord/connect`, payload: { botToken: 'x', serverId: 'abc' }, headers: { cookie } })
    expect(shape.statusCode).toBe(400)
    expect(shape.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('connects Discord and Telegram, runs a first sync, never leaks credentials', async () => {
    const d = await app.inject({ method: 'POST', url: `${base()}/discord/connect`, payload: { botToken: 'good-token-good-token-good', serverId: '123456789012345678' }, headers: { cookie } })
    expect(d.statusCode, d.body).toBe(200)
    expect(d.json().metadata).toMatchObject({ server_name: 'Test Guild', member_count: 1234 })
    expect(d.json().firstSync).toMatchObject({ members: 1234, bans_7d: 1 })
    expect(d.body).not.toContain('good-token')

    const t = await app.inject({ method: 'POST', url: `${base()}/telegram/connect`, payload: { botToken: '111111111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', chatId: '-1001234567890' }, headers: { cookie } })
    expect(t.statusCode, t.body).toBe(200)
    expect(t.json().firstSync).toEqual({ members: 500 })

    const list = await app.inject({ method: 'GET', url: base(), headers: { cookie } })
    const tg = list.json().integrations.find((i: { platform: string }) => i.platform === 'telegram')
    expect(tg.status).toBe('connected')
    expect(tg.lastSync).toBeTruthy()
    expect(list.body).not.toContain('AAAAAAAA')

    const row = await db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.platform, 'telegram')) })
    expect(row?.credentialsEnc).toMatch(/^v1:/)
  })

  it('sync writes the daily rollup and snapshots only on change', async () => {
    const snaps = () => db.select().from(schema.platformMetricSnapshots).where(and(eq(schema.platformMetricSnapshots.workspaceId, ws), eq(schema.platformMetricSnapshots.platform, 'telegram')))
    expect((await snaps()).length).toBe(1)
    await app.inject({ method: 'POST', url: `${base()}/telegram/sync`, headers: { cookie } })
    expect((await snaps()).length).toBe(1) // unchanged → no new snapshot
    tgMembers = 505
    const s = await app.inject({ method: 'POST', url: `${base()}/telegram/sync`, headers: { cookie } })
    expect(s.json().metrics).toEqual({ members: 505 })
    expect((await snaps()).length).toBe(2)

    const daily = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/daily?platforms=telegram,discord`, headers: { cookie } })
    expect(daily.json().rows).toHaveLength(2)
    expect(daily.json().rows.find((r: { platform: string }) => r.platform === 'telegram').metrics).toEqual({ members: 505 })

    const snapshots = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/snapshots?hours=1&platform=telegram`, headers: { cookie } })
    expect(snapshots.json().rows).toHaveLength(2)
  })

  it('a failing sync records last_error; invalid credentials flip status to error', async () => {
    const row = await db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.platform, 'discord')) })
    // Corrupt stored credentials to simulate a revoked token.
    const { encryptJson } = await import('../src/lib/crypto.js')
    await db.update(schema.integrations).set({ credentialsEnc: encryptJson({ bot_token: 'revoked-token-revoked-token', server_id: '123456789012345678' }) }).where(eq(schema.integrations.id, row!.id))
    const s = await app.inject({ method: 'POST', url: `${base()}/discord/sync`, headers: { cookie } })
    expect(s.statusCode).toBe(400)
    const list = await app.inject({ method: 'GET', url: base(), headers: { cookie } })
    const dc = list.json().integrations.find((i: { platform: string }) => i.platform === 'discord')
    expect(dc.status).toBe('error')
    expect(dc.lastError).toContain('INVALID_CREDENTIALS')
  })

  it('X import round-trip and other read endpoints respond', async () => {
    const put = await app.inject({ method: 'PUT', url: `/workspaces/${ws}/metrics/x-import`, payload: { filename: 'x.csv', rows: [{ date: '2026-08-01', impressions: 100, likes: 5 }] }, headers: { cookie } })
    expect(put.statusCode, put.body).toBe(200)
    const get = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/x-import`, headers: { cookie } })
    expect(get.json().import.rows).toHaveLength(1)
    for (const p of ['activity', 'member-messages', 'telegram-membership', 'discord-tenure', 'discord-membership']) {
      const r = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/${p}`, headers: { cookie } })
      expect(r.statusCode, p).toBe(200)
    }
  })
})

import { and } from 'drizzle-orm'
