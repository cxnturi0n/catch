import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, like } from 'drizzle-orm'

// Telegram v2: per-integration webhook registered at connect, secret hash
// lookup, connect checks (privacy mode, admin, admins list), bot removal,
// admin actions, disconnect deletes the webhook.
const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { config } = await import('../src/config.js')
const { classifyAction } = await import('../src/jobs/telegramUpdate.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
const TOKEN = '222222222:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const CHAT = -1002222222222
const calls: Array<{ method: string; body: Record<string, unknown> }> = []
let botAdmin = true

const realFetch = globalThis.fetch
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  if (!url.startsWith('https://api.telegram.org/bot')) return realFetch(input, init)
  const method = url.split('/').pop()!
  calls.push({ method, body: JSON.parse(String(init?.body ?? '{}')) })
  if (!url.includes(`/bot${TOKEN}/`)) return json(401, { ok: false, description: 'Unauthorized' })
  switch (method) {
    case 'getMe':
      return json(200, { ok: true, result: { id: 222222222, is_bot: true, username: 'catch_v2_bot', can_read_all_group_messages: false } })
    case 'getChat':
      return json(200, { ok: true, result: { id: CHAT, title: 'Public Chat', type: 'supergroup', username: 'publicchat' } })
    case 'getChatMemberCount':
      return json(200, { ok: true, result: 77 })
    case 'getChatMember':
      return json(200, { ok: true, result: { status: botAdmin ? 'administrator' : 'member' } })
    case 'getChatAdministrators':
      return json(200, { ok: true, result: [{ status: 'creator', user: { id: 5, username: 'owner', first_name: 'O' } }, { status: 'administrator', user: { id: 6, is_bot: true, username: 'otherbot' } }] })
    case 'setWebhook':
    case 'deleteWebhook':
      return json(200, { ok: true, result: true })
    case 'getWebhookInfo':
      return json(200, { ok: true, result: { url: '' } })
    default:
      return json(400, { ok: false, description: `unknown ${method}` })
  }
}

let ws = ''
let cookie = ''
let integrationId = ''
let secret = ''

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch)
  app = await buildApp()
  await db.delete(schema.rateLimit)
  const email = `tgw-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: 'tg', email, password: 'telegram-test-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'telegram-test-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
  ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'TG' }, headers: { cookie } })).json().id
})
afterAll(async () => {
  vi.unstubAllGlobals()
  ;(config as { API_URL: string }).API_URL = 'http://localhost:3000'
  await db.delete(schema.user).where(like(schema.user.email, 'tgw-%@example.test'))
  await app.close()
  await closeDatabase()
})

const post = (body: unknown, s = secret, id = integrationId) => app.inject({ method: 'POST', url: `/webhooks/telegram/${id}`, payload: body as object, headers: { 'x-telegram-bot-api-secret-token': s } })

describe('telegram v2 connect', () => {
  it('records privacy mode, admin status and admins; registers the per-integration webhook', async () => {
    // Webhooks need a public https API; auth already happened over the test http URL.
    ;(config as { API_URL: string }).API_URL = 'https://staging.example.test/api'
    const r = await app.inject({ method: 'POST', url: `/workspaces/${ws}/integrations/telegram/connect`, payload: { botToken: TOKEN, chatId: '@publicchat' }, headers: { cookie } })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().metadata).toMatchObject({ group_name: 'Public Chat', chat_numeric_id: String(CHAT), username: 'publicchat', privacy_mode: true, bot_is_admin: true, webhook: 'set', backfill: { status: 'skipped', reason: 'not_configured' } })
    expect(r.json().metadata.admins).toEqual([{ id: '5', username: 'owner', first_name: 'O', status: 'creator' }])
    const row = await db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.platform, 'telegram')) })
    integrationId = row!.id
    expect(row!.webhookSecretHash).toMatch(/^[0-9a-f]{64}$/)
    const set = calls.find((c) => c.method === 'setWebhook')!
    expect(set.body.url).toBe(`https://staging.example.test/api/webhooks/telegram/${integrationId}`)
    expect(set.body.allowed_updates).toEqual(['message', 'edited_message', 'chat_member', 'my_chat_member'])
    secret = String(set.body.secret_token)
    expect(secret.length).toBeGreaterThan(30)
    expect(r.body).not.toContain(secret)
    const list = await app.inject({ method: 'GET', url: `/workspaces/${ws}/integrations`, headers: { cookie } })
    const tg = list.json().integrations.find((i: { platform: string }) => i.platform === 'telegram')
    expect(tg.health).toMatchObject({ webhook: 'set', privacyMode: true, botIsAdmin: true, username: 'publicchat' })
    expect(list.body).not.toContain(secret)
  })
})

describe('telegram v2 webhook', () => {
  it('rejects bad secrets and unknown ids, accepts the right one', async () => {
    expect((await post({}, 'nope')).statusCode).toBe(401)
    expect((await post({}, secret, '00000000-0000-0000-0000-000000000000')).statusCode).toBe(401)
    expect((await post({}, secret, 'not-a-uuid')).statusCode).toBe(401)
    expect((await post({})).statusCode).toBe(200)
  })
  it('counts messages of the connected chat only, stores text and replies, ignores service messages', async () => {
    const now = Math.floor(Date.now() / 1000)
    await post({ update_id: 10, message: { message_id: 1, chat: { id: CHAT, title: 'Public Chat' }, from: { id: 42, username: 'lena' }, date: now, text: 'gm everyone' } })
    await post({ update_id: 10, message: { message_id: 1, chat: { id: CHAT }, from: { id: 42, username: 'lena' }, date: now, text: 'gm everyone' } }) // redelivery
    await post({ update_id: 11, message: { message_id: 2, chat: { id: CHAT }, from: { id: 43, first_name: 'Marco' }, date: now, text: 'gm', reply_to_message: { message_id: 1 } } })
    await post({ update_id: 12, message: { message_id: 3, chat: { id: CHAT }, from: { id: 44 }, date: now, new_chat_members: [{ id: 44 }] } })
    await post({ update_id: 13, message: { message_id: 4, chat: { id: 555 }, from: { id: 45, username: 'other' }, date: now, text: 'wrong chat' } })
    await post({ update_id: 14, edited_message: { message_id: 1, chat: { id: CHAT }, from: { id: 42 }, date: now, text: 'edited' } })
    const stored = await db.select().from(schema.platformMessages).where(eq(schema.platformMessages.workspaceId, ws))
    expect(stored.map((m) => m.messageId).sort()).toEqual([`${CHAT}:1`, `${CHAT}:2`])
    expect(stored.find((m) => m.messageId === `${CHAT}:2`)).toMatchObject({ replyToMessageId: `${CHAT}:1`, memberRef: '43', displayName: 'Marco', hasContent: true })
    expect(stored.every((m) => m.contentEnc?.startsWith('v1:'))).toBe(true)
    const mm = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/member-messages?days=2`, headers: { cookie } })
    expect(mm.json().members).toEqual([
      { memberRef: '42', displayName: '@lena', messages: 1 },
      { memberRef: '43', displayName: 'Marco', messages: 1 },
    ])
  })
  it('admin actions become moderator actions; membership events still recorded', async () => {
    expect(classifyAction({ status: 'member' }, { status: 'kicked' })).toBe('ban')
    expect(classifyAction({ status: 'kicked' }, { status: 'left' })).toBe('unban')
    expect(classifyAction({ status: 'member' }, { status: 'restricted', is_member: true, can_send_messages: false })).toBe('mute')
    expect(classifyAction({ status: 'restricted', can_send_messages: false }, { status: 'member' })).toBe('unmute')
    expect(classifyAction({ status: 'member' }, { status: 'administrator' })).toBeNull()
    const now = Math.floor(Date.now() / 1000)
    await post({ update_id: 20, chat_member: { chat: { id: CHAT }, date: now, from: { id: 5, username: 'owner' }, old_chat_member: { user: { id: 99, username: 'spammer' }, status: 'member' }, new_chat_member: { user: { id: 99, username: 'spammer' }, status: 'kicked' } } })
    await post({ update_id: 21, chat_member: { chat: { id: CHAT }, date: now, from: { id: 98 }, old_chat_member: { user: { id: 98 }, status: 'member' }, new_chat_member: { user: { id: 98 }, status: 'left' } } })
    const acts = await db.select().from(schema.moderatorActions).where(eq(schema.moderatorActions.workspaceId, ws))
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({ platform: 'telegram', actionType: 'ban', executorRef: '5', executorName: '@owner', targetRef: '99', actionId: `tg:${CHAT}:20` })
    const tm = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/telegram-membership?hours=1`, headers: { cookie } })
    expect(tm.json()).toMatchObject({ joins: 0, leaves: 2 })
  })
  it('bot removed → error with a readable reason; added back → connected', async () => {
    const now = Math.floor(Date.now() / 1000)
    await post({ update_id: 30, my_chat_member: { chat: { id: CHAT }, date: now, old_chat_member: { user: { id: 222222222, is_bot: true }, status: 'administrator' }, new_chat_member: { user: { id: 222222222, is_bot: true }, status: 'left' } } })
    let list = await app.inject({ method: 'GET', url: `/workspaces/${ws}/integrations`, headers: { cookie } })
    let tg = list.json().integrations.find((i: { platform: string }) => i.platform === 'telegram')
    expect(tg.status).toBe('error')
    expect(tg.lastError).toMatch(/^BOT_REMOVED/)
    await post({ update_id: 31, my_chat_member: { chat: { id: CHAT }, date: now, old_chat_member: { user: { id: 222222222, is_bot: true }, status: 'left' }, new_chat_member: { user: { id: 222222222, is_bot: true }, status: 'member' } } })
    list = await app.inject({ method: 'GET', url: `/workspaces/${ws}/integrations`, headers: { cookie } })
    tg = list.json().integrations.find((i: { platform: string }) => i.platform === 'telegram')
    expect(tg.status).toBe('connected')
    expect(tg.lastError).toBeNull()
  })
  it('disconnect deletes the webhook, the hash and the stored text', async () => {
    calls.length = 0
    const r = await app.inject({ method: 'DELETE', url: `/workspaces/${ws}/integrations/telegram`, headers: { cookie } })
    expect(r.statusCode).toBe(204)
    expect(calls.some((c) => c.method === 'deleteWebhook')).toBe(true)
    const row = await db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.platform, 'telegram')) })
    expect(row?.webhookSecretHash).toBeNull()
    expect((await post({})).statusCode).toBe(401)
    expect(await db.select().from(schema.platformMessages).where(eq(schema.platformMessages.workspaceId, ws))).toHaveLength(0)
    const mm = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/member-messages?days=2`, headers: { cookie } })
    expect(mm.json().members).toHaveLength(2) // counters survive
  })
})
