import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, like } from 'drizzle-orm'

// Telegram history backfill against a fake MTProto client.
const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { encryptJson } = await import('../src/lib/crypto.js')
const { runTelegramBackfill, TELEGRAM_BACKFILL_DAYS } = await import('../src/jobs/telegramBackfill.js')
const { withMtprotoLock } = await import('../src/integrations/telegram/mtproto.js')
type MtprotoClientLike = import('../src/integrations/telegram/mtproto.js').MtprotoClientLike
type MtprotoMessage = import('../src/integrations/telegram/mtproto.js').MtprotoMessage

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
const CHAT = '-1003333333333'
const nowUnix = Math.floor(Date.now() / 1000)
const DAY = 86_400

function fakeClient(pages: MtprotoMessage[][], opts: { isPublic?: boolean } = {}): MtprotoClientLike & { calls: string[] } {
  return {
    calls: [],
    async resolvePublicChat(username) {
      this.calls.push(`resolve:${username}`)
      return { id: '3333333333', title: 'Public', isPublic: opts.isPublic ?? true }
    },
    async *iterHistory(username, o) {
      this.calls.push(`iter:${username}:${o.max}`)
      for (const p of pages) yield p.filter((m) => m.date >= o.sinceUnix)
    },
    async disconnect() {},
  }
}
const m = (id: number, daysAgo: number, senderId: string | null, text: string | null = 'hi', extra: Partial<MtprotoMessage> = {}): MtprotoMessage => ({ id, date: nowUnix - daysAgo * DAY, text, senderId, senderName: senderId ? `@u${senderId}` : null, isBot: false, replyToId: null, topicId: null, ...extra })

let ws = ''
let cookie = ''

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
  const email = `mtp-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: 'mt', email, password: 'mtproto-test-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'mtproto-test-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
  ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'MT' }, headers: { cookie } })).json().id
  await db.insert(schema.integrations).values({ workspaceId: ws, platform: 'telegram', status: 'connected', credentialsEnc: encryptJson({ bot_token: 'x', chat_id: CHAT }), metadata: { username: 'publicchat', chat_numeric_id: CHAT, group_name: 'Public', backfill: { status: 'queued' } } })
})
afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'mtp-%@example.test'))
  await app.close()
  await closeDatabase()
})

const meta = async () => (await db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.platform, 'telegram')) }))!.metadata as { backfill: Record<string, unknown> }

describe('telegram mtproto backfill', () => {
  it('feature off → skipped not_configured; private group → skipped private_group', async () => {
    expect((await runTelegramBackfill(ws, { client: null }))?.reason).toBe('not_configured')
    expect((await meta()).backfill).toMatchObject({ status: 'skipped', reason: 'not_configured' })
    await db.update(schema.integrations).set({ metadata: { chat_numeric_id: CHAT, group_name: 'Private' } }).where(eq(schema.integrations.workspaceId, ws))
    expect((await runTelegramBackfill(ws, { client: fakeClient([]) }))?.reason).toBe('private_group')
    await db.update(schema.integrations).set({ metadata: { username: 'publicchat', chat_numeric_id: CHAT, group_name: 'Public' } }).where(eq(schema.integrations.workspaceId, ws))
  })

  it('imports pages inside the window, skips anonymous and bot senders, keys ids like the webhook', async () => {
    const client = fakeClient([
      [m(10, 0.1, '1', 'gm', { topicId: 7 }), m(9, 0.2, '2', 'reply', { replyToId: 10 }), m(8, 0.3, null, 'anon'), m(7, 0.4, '3', 'beep', { isBot: true })],
      [m(6, 2, '1', null), m(5, TELEGRAM_BACKFILL_DAYS + 1, '1', 'too old')],
    ])
    const r = await runTelegramBackfill(ws, { client })
    expect(r).toMatchObject({ status: 'done', channelsDone: 1, messages: 3 })
    expect(client.calls).toEqual(['resolve:publicchat', `iter:publicchat:50000`])
    const stored = await db.select().from(schema.platformMessages).where(eq(schema.platformMessages.workspaceId, ws))
    expect(stored.map((x) => x.messageId).sort()).toEqual([`${CHAT}:10`, `${CHAT}:6`, `${CHAT}:9`])
    expect(stored.find((x) => x.messageId === `${CHAT}:10`)).toMatchObject({ channelId: '7', source: 'mtproto', hasContent: true })
    expect(stored.find((x) => x.messageId === `${CHAT}:9`)).toMatchObject({ replyToMessageId: `${CHAT}:10`, channelId: CHAT })
    expect(stored.find((x) => x.messageId === `${CHAT}:6`)).toMatchObject({ hasContent: false })
    expect((await meta()).backfill).toMatchObject({ status: 'done', messages: 3 })
  })

  it('a webhook message with the same id is a duplicate, not a double count', async () => {
    const { processTelegramUpdate } = await import('../src/jobs/telegramUpdate.js')
    const out = await processTelegramUpdate({ update_id: 900, message: { message_id: 10, chat: { id: Number(CHAT) }, from: { id: 1, username: 'u1' }, date: nowUnix, text: 'gm' } }, { workspaceId: ws, chatId: CHAT })
    expect(out).toBe('duplicate')
    const mm = await app.inject({ method: 'GET', url: `/workspaces/${ws}/metrics/member-messages?days=40`, headers: { cookie } })
    expect(mm.json().members.find((x: { memberRef: string }) => x.memberRef === '1')?.messages).toBe(2)
  })

  it('failures are recorded and rethrown; the lock serialises walks', async () => {
    const bad: MtprotoClientLike = { ...fakeClient([]), async resolvePublicChat() { throw new Error('FLOOD') } }
    await expect(runTelegramBackfill(ws, { client: bad })).rejects.toThrow('FLOOD')
    expect((await meta()).backfill).toMatchObject({ status: 'failed', error: 'FLOOD' })
    const order: string[] = []
    await Promise.all([
      withMtprotoLock(async () => {
        order.push('a1')
        await new Promise((r) => setTimeout(r, 20))
        order.push('a2')
      }),
      withMtprotoLock(async () => void order.push('b')),
    ])
    expect(order).toEqual(['a1', 'a2', 'b'])
  })
})
