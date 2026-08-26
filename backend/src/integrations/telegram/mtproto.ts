import { TelegramClient, errors, extensions, sessions } from 'telegram'
import { LogLevel } from 'telegram/extensions/Logger.js'
import { config, telegramMtprotoEnabled } from '../../config.js'
import { PlatformError } from '../types.js'
import { integrationLog } from '../../lib/integrationLog.js'

// Telegram's user API (MTProto) through GramJS, used only to read the history
// of PUBLIC groups and channels, which the Bot API cannot do. Runs under a
// dedicated Catch account whose session string lives in the environment.
// The client is shared, connected lazily and dropped after five idle minutes.

export interface MtprotoMessage {
  id: number
  /** Unix seconds. */
  date: number
  text: string | null
  senderId: string | null
  senderName: string | null
  isBot: boolean
  replyToId: number | null
  topicId: number | null
}

export interface MtprotoClientLike {
  resolvePublicChat(username: string): Promise<{ id: string; title: string; isPublic: boolean }>
  iterHistory(username: string, opts: { sinceUnix: number; max: number }): AsyncIterable<MtprotoMessage[]>
  disconnect(): Promise<void>
}

export const PAGE_SIZE = 100
export const PAGE_PACING_MS = 1_000
export const FLOOD_WAIT_MAX_S = 300
const IDLE_MS = 5 * 60_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface GramSender {
  id?: unknown
  username?: string
  firstName?: string
  title?: string
  bot?: boolean
}

export class GramJsClient implements MtprotoClientLike {
  private client: TelegramClient
  private idle: NodeJS.Timeout | null = null
  private connecting: Promise<void> | null = null

  constructor(apiId: number, apiHash: string, session: string) {
    this.client = new TelegramClient(new sessions.StringSession(session), apiId, apiHash, { connectionRetries: 3, autoReconnect: false, baseLogger: new extensions.Logger(LogLevel.ERROR) })
  }

  private touch() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => void this.disconnect(), IDLE_MS)
    this.idle.unref?.()
  }

  private async ensure() {
    this.touch()
    if (this.client.connected) return
    if (!this.connecting) {
      this.connecting = this.client
        .connect()
        .then(async () => {
          if (!(await this.client.isUserAuthorized())) throw new PlatformError('TELEGRAM_SESSION is not authorised (run scripts/telegram-session.ts)', 'INVALID_CREDENTIALS')
        })
        .finally(() => {
          this.connecting = null
        })
    }
    await this.connecting
  }

  async resolvePublicChat(username: string) {
    await this.ensure()
    const e = (await this.client.getEntity(username)) as GramSender
    return { id: String(e.id ?? ''), title: e.title ?? username, isPublic: Boolean(e.username) }
  }

  async *iterHistory(username: string, opts: { sinceUnix: number; max: number }): AsyncIterable<MtprotoMessage[]> {
    await this.ensure()
    const entity = await this.client.getEntity(username)
    let offsetId = 0
    let n = 0
    while (n < opts.max) {
      this.touch()
      let raw: Array<{ id: number; date: number; message?: string; senderId?: unknown; sender?: GramSender; replyTo?: { replyToMsgId?: number; forumTopic?: boolean; replyToTopId?: number } }>
      try {
        raw = (await this.client.getMessages(entity, { limit: Math.min(PAGE_SIZE, opts.max - n), offsetId })) as unknown as typeof raw
      } catch (err) {
        if (err instanceof errors.FloodWaitError) {
          integrationLog('mtproto.flood_wait', { seconds: err.seconds })
          if (err.seconds > FLOOD_WAIT_MAX_S) throw new PlatformError(`Telegram asked to wait ${err.seconds}s`, 'RATE_LIMITED', 429)
          await sleep((err.seconds + 1) * 1000)
          continue
        }
        throw err
      }
      if (raw.length === 0) break
      const page: MtprotoMessage[] = []
      let past = false
      for (const m of raw) {
        if (typeof m.date !== 'number') continue
        if (m.date < opts.sinceUnix) {
          past = true
          break
        }
        const s = m.sender
        page.push({
          id: m.id,
          date: m.date,
          text: m.message || null,
          senderId: m.senderId !== undefined && m.senderId !== null ? String(m.senderId) : null,
          senderName: s?.username ? `@${s.username}` : (s?.firstName ?? s?.title ?? null),
          isBot: s?.bot === true,
          replyToId: m.replyTo?.replyToMsgId ?? null,
          topicId: m.replyTo?.forumTopic ? (m.replyTo.replyToTopId ?? m.replyTo.replyToMsgId ?? null) : null,
        })
      }
      n += raw.length
      if (page.length) yield page
      if (past || raw.length < PAGE_SIZE) break
      offsetId = raw[raw.length - 1]!.id
      await sleep(PAGE_PACING_MS)
    }
  }

  async disconnect() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    if (this.client.connected) await this.client.disconnect().catch(() => undefined)
  }
}

let shared: GramJsClient | null = null
export function getSharedClient(): MtprotoClientLike | null {
  if (!telegramMtprotoEnabled) return null
  shared ??= new GramJsClient(config.TELEGRAM_API_ID!, config.TELEGRAM_API_HASH!, config.TELEGRAM_SESSION!)
  return shared
}

// One history walk at a time across the process: the account is shared.
let chain: Promise<unknown> = Promise.resolve()
export function withMtprotoLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}
