// Discord Gateway (websocket) connection for one bot in one guild. Pure state
// machine: the socket, the gateway URL lookup and the identify gate are
// injected so the protocol can be unit tested without a network.
//
// Protocol summary (v10, JSON encoding, no compression):
//   HELLO (10) → heartbeat every d.heartbeat_interval, first after a random
//   fraction of it → IDENTIFY (2) or RESUME (6) → READY / RESUMED dispatches.
//   Server HEARTBEAT (1) → answer at once. Missing HEARTBEAT_ACK (11) → close
//   and resume. RECONNECT (7) → close and resume. INVALID_SESSION (9) →
//   resume when d === true, otherwise wait 1 to 5 s and identify again.
//   Closing with 1000/1001 invalidates the session, so a voluntary close uses
//   4900 and the next process can RESUME.

export const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 } as const

export const INTENTS = { GUILDS: 1 << 0, GUILD_MEMBERS: 1 << 1, GUILD_MODERATION: 1 << 2, GUILD_MESSAGES: 1 << 9, MESSAGE_CONTENT: 1 << 15 } as const
export const FULL_INTENTS = INTENTS.GUILDS | INTENTS.GUILD_MEMBERS | INTENTS.GUILD_MODERATION | INTENTS.GUILD_MESSAGES | INTENTS.MESSAGE_CONTENT

// Close code 4014 (disallowed intents) walks down this ladder. Privileged
// intents the bot owner has not enabled are dropped one at a time.
export const INTENT_LADDER: ReadonlyArray<{ intents: number; missing: string[] }> = [
  { intents: FULL_INTENTS, missing: [] },
  { intents: FULL_INTENTS & ~INTENTS.MESSAGE_CONTENT, missing: ['message_content'] },
  { intents: FULL_INTENTS & ~INTENTS.GUILD_MEMBERS, missing: ['guild_members'] },
  { intents: FULL_INTENTS & ~INTENTS.MESSAGE_CONTENT & ~INTENTS.GUILD_MEMBERS, missing: ['message_content', 'guild_members'] },
]

export const CLOSE_RESUMABLE = 4900
export const CLOSE = { AUTH_FAILED: 4004, INVALID_SEQ: 4007, SESSION_TIMED_OUT: 4009, INVALID_SHARD: 4010, SHARDING_REQUIRED: 4011, INVALID_VERSION: 4012, INVALID_INTENTS: 4013, DISALLOWED_INTENTS: 4014 } as const
const FATAL = new Set<number>([CLOSE.INVALID_SHARD, CLOSE.SHARDING_REQUIRED, CLOSE.INVALID_VERSION, CLOSE.INVALID_INTENTS])
const FRESH_IDENTIFY = new Set<number>([CLOSE.INVALID_SEQ, CLOSE.SESSION_TIMED_OUT])
const MAX_BACKOFF_MS = 60_000

export type GatewayStatus = 'connecting' | 'identifying' | 'connected' | 'resuming' | 'backoff' | 'error' | 'disconnected'

export interface SocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number; reason?: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
}
export type SocketFactory = (url: string) => SocketLike

export interface ResumeState {
  sessionId: string
  resumeUrl: string
  seq: number
}

export interface GatewayStatePatch {
  status?: GatewayStatus
  sessionId?: string | null
  resumeUrl?: string | null
  seq?: number | null
  intents?: number
  missingIntents?: string[]
  lastCloseCode?: number | null
  lastError?: string | null
  connectedAt?: Date | null
  lastEventAt?: Date
  lastAckAt?: Date
}

export interface GatewayHooks {
  onDispatch(t: string, d: unknown, seq: number | null): Promise<void> | void
  onState(patch: GatewayStatePatch): void
  onLog?(event: string, data: Record<string, unknown>): void
}

export interface GatewayOptions {
  token: string
  guildId: string
  hooks: GatewayHooks
  /** Start lower on the ladder (e.g. known missing intents). */
  ladderIndex?: number
  resume?: ResumeState | null
  sockets?: SocketFactory
  /** Resolves the wss base URL (GET /gateway/bot). */
  gatewayUrl: () => Promise<string>
  /** Serialises IDENTIFY across connections (1 per 5 s per token). */
  identifyGate?: () => Promise<void>
  random?: () => number
}

const defaultSockets: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike

interface Payload {
  op: number
  d?: unknown
  s?: number | null
  t?: string | null
}

export class DiscordGatewayConnection {
  status: GatewayStatus = 'disconnected'
  private socket: SocketLike | null = null
  private seq: number | null = null
  private sessionId: string | null = null
  private resumeUrl: string | null = null
  private ladderIndex: number
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private awaitingAck = false
  private stopped = false
  private attempts = 0
  private generation = 0
  private readonly sockets: SocketFactory
  private readonly random: () => number

  constructor(private readonly opts: GatewayOptions) {
    this.ladderIndex = Math.min(opts.ladderIndex ?? 0, INTENT_LADDER.length - 1)
    if (opts.resume) {
      this.sessionId = opts.resume.sessionId
      this.resumeUrl = opts.resume.resumeUrl
      this.seq = opts.resume.seq
    }
    this.sockets = opts.sockets ?? defaultSockets
    this.random = opts.random ?? Math.random
  }

  get intents(): number {
    return INTENT_LADDER[this.ladderIndex]!.intents
  }
  get missingIntents(): string[] {
    return INTENT_LADDER[this.ladderIndex]!.missing
  }
  get session(): ResumeState | null {
    return this.sessionId && this.resumeUrl && this.seq !== null ? { sessionId: this.sessionId, resumeUrl: this.resumeUrl, seq: this.seq } : null
  }

  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
  }

  async stop(code = CLOSE_RESUMABLE): Promise<void> {
    this.stopped = true
    this.clearTimers()
    const s = this.socket
    this.socket = null
    if (s) {
      s.onclose = null
      try {
        s.close(code, 'shutdown')
      } catch {
        /* already closed */
      }
    }
    this.setStatus('disconnected')
  }

  private log(event: string, data: Record<string, unknown> = {}) {
    this.opts.hooks.onLog?.(event, { guildId: this.opts.guildId, ...data })
  }

  private setStatus(status: GatewayStatus, extra: GatewayStatePatch = {}) {
    this.status = status
    this.opts.hooks.onState({ status, ...extra })
  }

  private clearTimers() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.heartbeatTimer = null
    this.reconnectTimer = null
    this.awaitingAck = false
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    const gen = ++this.generation
    const resuming = this.session !== null
    this.setStatus(resuming ? 'resuming' : 'connecting')
    let base: string
    try {
      base = resuming ? this.resumeUrl! : await this.opts.gatewayUrl()
    } catch (err) {
      this.log('gateway.url_failed', { error: err instanceof Error ? err.message : String(err) })
      this.scheduleReconnect()
      return
    }
    if (this.stopped || gen !== this.generation) return
    const url = base.includes('?') ? base : `${base.replace(/\/$/, '')}/?v=10&encoding=json`
    let s: SocketLike
    try {
      s = this.sockets(url)
    } catch (err) {
      this.log('gateway.socket_failed', { error: err instanceof Error ? err.message : String(err) })
      this.scheduleReconnect()
      return
    }
    this.socket = s
    s.onopen = () => this.log('gateway.open', { resuming })
    s.onmessage = (ev) => void this.onMessage(String(ev.data), gen)
    s.onerror = () => undefined // a close event always follows
    s.onclose = (ev) => this.onClose(ev.code, ev.reason ?? '', gen)
  }

  private send(payload: Payload) {
    try {
      this.socket?.send(JSON.stringify(payload))
    } catch (err) {
      this.log('gateway.send_failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  private async onMessage(raw: string, gen: number) {
    if (gen !== this.generation) return
    let p: Payload
    try {
      p = JSON.parse(raw) as Payload
    } catch {
      return
    }
    if (typeof p.s === 'number') this.seq = p.s
    switch (p.op) {
      case OP.HELLO: {
        const interval = Number((p.d as { heartbeat_interval?: number })?.heartbeat_interval) || 41_250
        this.startHeartbeat(interval)
        if (this.session) {
          this.log('gateway.resume', { seq: this.seq })
          this.send({ op: OP.RESUME, d: { token: this.opts.token, session_id: this.sessionId, seq: this.seq } })
        } else {
          this.setStatus('identifying')
          if (this.opts.identifyGate) await this.opts.identifyGate()
          if (gen !== this.generation || this.stopped) return
          this.log('gateway.identify', { intents: this.intents, missing: this.missingIntents })
          this.send({ op: OP.IDENTIFY, d: { token: this.opts.token, intents: this.intents, properties: { os: 'linux', browser: 'catch', device: 'catch' } } })
        }
        return
      }
      case OP.HEARTBEAT:
        this.sendHeartbeat()
        return
      case OP.HEARTBEAT_ACK:
        this.awaitingAck = false
        this.opts.hooks.onState({ lastAckAt: new Date() })
        return
      case OP.RECONNECT:
        this.log('gateway.reconnect_requested')
        this.dropSocket(CLOSE_RESUMABLE)
        this.scheduleReconnect(0)
        return
      case OP.INVALID_SESSION: {
        const resumable = p.d === true
        this.log('gateway.invalid_session', { resumable })
        if (!resumable) this.forgetSession()
        this.dropSocket(CLOSE_RESUMABLE)
        this.scheduleReconnect(resumable ? 0 : 1000 + Math.floor(this.random() * 4000))
        return
      }
      case OP.DISPATCH:
        await this.onDispatch(p.t ?? '', p.d)
        return
      default:
        return
    }
  }

  private async onDispatch(t: string, d: unknown) {
    const data = (d ?? {}) as { session_id?: string; resume_gateway_url?: string; guild_id?: string; id?: string }
    if (t === 'READY') {
      this.sessionId = data.session_id ?? null
      this.resumeUrl = data.resume_gateway_url ?? null
      this.attempts = 0
      this.setStatus('connected', { sessionId: this.sessionId, resumeUrl: this.resumeUrl, seq: this.seq, intents: this.intents, missingIntents: this.missingIntents, connectedAt: new Date(), lastError: null })
      this.log('gateway.ready', { intents: this.intents, missing: this.missingIntents })
    } else if (t === 'RESUMED') {
      this.attempts = 0
      this.setStatus('connected', { seq: this.seq, intents: this.intents, missingIntents: this.missingIntents, lastError: null })
      this.log('gateway.resumed', { seq: this.seq })
    } else {
      // The bot may sit in several guilds; only the connected one matters.
      const guild = t === 'GUILD_CREATE' || t === 'GUILD_UPDATE' || t === 'GUILD_DELETE' ? data.id : data.guild_id
      if (guild && guild !== this.opts.guildId) return
      this.opts.hooks.onState({ lastEventAt: new Date(), seq: this.seq })
    }
    try {
      await this.opts.hooks.onDispatch(t, d, this.seq)
    } catch (err) {
      this.log('gateway.dispatch_failed', { t, error: err instanceof Error ? err.message : String(err) })
    }
  }

  private startHeartbeat(intervalMs: number) {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.awaitingAck = false
    const first = Math.floor(intervalMs * this.random())
    const beat = () => {
      if (this.awaitingAck) {
        // Zombie connection: close resumable and reconnect.
        this.log('gateway.heartbeat_missed')
        this.dropSocket(CLOSE_RESUMABLE)
        this.scheduleReconnect(0)
        return
      }
      this.sendHeartbeat()
      this.heartbeatTimer = setTimeout(beat, intervalMs)
      this.heartbeatTimer.unref?.()
    }
    this.heartbeatTimer = setTimeout(beat, first)
    this.heartbeatTimer.unref?.()
  }

  private sendHeartbeat() {
    this.awaitingAck = true
    this.send({ op: OP.HEARTBEAT, d: this.seq })
  }

  private forgetSession() {
    this.sessionId = null
    this.resumeUrl = null
    this.seq = null
    this.opts.hooks.onState({ sessionId: null, resumeUrl: null, seq: null })
  }

  private dropSocket(code: number) {
    const s = this.socket
    this.socket = null
    this.generation++
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.awaitingAck = false
    if (s) {
      s.onclose = null
      try {
        s.close(code)
      } catch {
        /* ignore */
      }
    }
  }

  private onClose(code: number, reason: string, gen: number) {
    if (gen !== this.generation) return
    this.socket = null
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.awaitingAck = false
    if (this.stopped) {
      this.setStatus('disconnected')
      return
    }
    this.log('gateway.close', { code, reason })
    this.opts.hooks.onState({ lastCloseCode: code })
    if (code === CLOSE.AUTH_FAILED) {
      this.stopped = true
      this.forgetSession()
      this.setStatus('error', { lastError: 'AUTH_FAILED: Discord rejected the bot token' })
      return
    }
    if (FATAL.has(code)) {
      this.stopped = true
      this.forgetSession()
      this.setStatus('error', { lastError: `GATEWAY_${code}: ${reason || 'fatal close code'}` })
      return
    }
    if (code === CLOSE.DISALLOWED_INTENTS) {
      this.forgetSession()
      if (this.ladderIndex >= INTENT_LADDER.length - 1) {
        this.stopped = true
        this.setStatus('error', { lastError: 'DISALLOWED_INTENTS: enable the privileged intents in the Discord Developer Portal' })
        return
      }
      this.ladderIndex++
      this.log('gateway.intent_fallback', { intents: this.intents, missing: this.missingIntents })
      this.opts.hooks.onState({ intents: this.intents, missingIntents: this.missingIntents })
      this.scheduleReconnect(0)
      return
    }
    if (FRESH_IDENTIFY.has(code)) this.forgetSession()
    this.scheduleReconnect()
  }

  private scheduleReconnect(delayMs?: number) {
    if (this.stopped) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.attempts++
    const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.attempts - 1, 6)) + Math.floor(this.random() * 1000)
    const delay = delayMs ?? backoff
    this.setStatus('backoff')
    this.reconnectTimer = setTimeout(() => void this.connect(), delay)
    this.reconnectTimer.unref?.()
  }
}

// Process wide IDENTIFY spacing: Discord allows one per 5 s per token; a
// single queue for every token is simpler and always safe.
const IDENTIFY_SPACING_MS = 5_500
let lastIdentifyAt = 0
let identifyChain: Promise<void> = Promise.resolve()
export function identifyGate(): Promise<void> {
  identifyChain = identifyChain.then(async () => {
    const wait = lastIdentifyAt + IDENTIFY_SPACING_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastIdentifyAt = Date.now()
  })
  return identifyChain
}
