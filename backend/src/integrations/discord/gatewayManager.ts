import { createHash } from 'node:crypto'
import { Client } from 'pg'
import { and, eq } from 'drizzle-orm'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { discordGatewayState, integrations, integrationSyncState } from '../../db/schema/index.js'
import { decryptJson } from '../../lib/crypto.js'
import { integrationLog } from '../../lib/integrationLog.js'
import { logger } from '../../logger.js'
import { captureException } from '../../lib/sentry.js'
import { publish } from '../../lib/events.js'
import { discordJson } from './rest.js'
import { DiscordGatewayConnection, identifyGate, INTENT_LADDER, type GatewayStatePatch, type ResumeState, type SocketFactory } from './gateway.js'
import { createDispatchHandler, type DispatchHandler } from './gatewayEvents.js'

// Supervisor: one gateway connection per connected Discord workspace. Every
// tick it reconciles running connections with the integrations table, takes a
// Postgres advisory lock per workspace (a second worker simply owns nothing),
// persists connection state for the UI and for RESUME after a restart.

const RESUME_MAX_AGE_MS = 10 * 60_000
const LADDER_RESET_MS = 24 * 60 * 60_000
const STATE_DEBOUNCE_MS = 5_000
const GATEWAY_URL_TTL_MS = 60 * 60_000

interface Running {
  conn: DiscordGatewayConnection
  handler: DispatchHandler
  credHash: string
  startedAt: number
  pending: GatewayStatePatch
  timer: NodeJS.Timeout | null
}

export interface GatewayManagerOptions {
  workerId?: string
  tickMs?: number
  sockets?: SocketFactory
  gatewayUrl?: (token: string) => Promise<string>
  identifyGate?: () => Promise<void>
}

export interface GatewayManager {
  tick(): Promise<void>
  stop(): Promise<void>
  running(): string[]
}

const urlCache = new Map<string, { url: string; at: number }>()
export async function fetchGatewayUrl(token: string): Promise<string> {
  const key = createHash('sha256').update(token).digest('hex').slice(0, 16)
  const cached = urlCache.get(key)
  if (cached && Date.now() - cached.at < GATEWAY_URL_TTL_MS) return cached.url
  const r = await discordJson<{ url: string; session_start_limit?: { remaining: number; reset_after: number } }>(token, '/gateway/bot')
  if (r.status === 401) throw new Error('AUTH_FAILED')
  if (!r.ok || !r.body?.url) throw new Error(`gateway url failed (${r.status})`)
  const limit = r.body.session_start_limit
  if (limit && limit.remaining <= 0) {
    integrationLog('gateway.session_limit', { resetAfterMs: limit.reset_after })
    await new Promise((res) => setTimeout(res, Math.min(limit.reset_after, 15 * 60_000)))
  }
  urlCache.set(key, { url: r.body.url, at: Date.now() })
  return r.body.url
}

export function startGatewayManager(opts: GatewayManagerOptions = {}): GatewayManager {
  const workerId = opts.workerId ?? config.WORKER_ID ?? `${process.pid}`
  const tickMs = opts.tickMs ?? 60_000
  const running = new Map<string, Running>()
  let lock: Client | null = null
  let stopped = false

  async function lockClient(): Promise<Client> {
    if (lock) return lock
    const c = new Client({ connectionString: config.DATABASE_URL })
    await c.connect()
    c.on('error', (err) => {
      logger.error({ err }, 'gateway lock connection lost')
      lock = null
    })
    lock = c
    return c
  }
  async function tryLock(ws: string): Promise<boolean> {
    const c = await lockClient()
    const r = await c.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) as ok', [`discord-gateway:${ws}`])
    return r.rows[0]?.ok === true
  }
  async function unlock(ws: string) {
    try {
      await (await lockClient()).query('select pg_advisory_unlock(hashtext($1))', [`discord-gateway:${ws}`])
    } catch {
      /* connection gone: lock is released with it */
    }
  }

  async function persist(ws: string, patch: GatewayStatePatch) {
    const set: Record<string, unknown> = { workerId, updatedAt: new Date() }
    if (patch.status !== undefined) set.status = patch.status
    if (patch.sessionId !== undefined) set.sessionId = patch.sessionId
    if (patch.resumeUrl !== undefined) set.resumeUrl = patch.resumeUrl
    if (patch.seq !== undefined) set.seq = patch.seq
    if (patch.intents !== undefined) set.intents = patch.intents
    if (patch.missingIntents !== undefined) set.missingIntents = patch.missingIntents
    if (patch.lastCloseCode !== undefined) set.lastCloseCode = patch.lastCloseCode
    if (patch.lastError !== undefined) set.lastError = patch.lastError
    if (patch.connectedAt !== undefined) set.connectedAt = patch.connectedAt
    if (patch.lastEventAt !== undefined) set.lastEventAt = patch.lastEventAt
    if (patch.lastAckAt !== undefined) set.lastAckAt = patch.lastAckAt
    await db
      .insert(discordGatewayState)
      .values({ workspaceId: ws, ...(set as object) })
      .onConflictDoUpdate({ target: discordGatewayState.workspaceId, set })
    if (patch.status !== undefined) await publish(ws, 'integrations')
    if (patch.status === 'error' && patch.lastError?.startsWith('AUTH_FAILED')) {
      await db.update(integrations).set({ status: 'error', updatedAt: new Date() }).where(and(eq(integrations.workspaceId, ws), eq(integrations.platform, 'discord')))
      await db
        .insert(integrationSyncState)
        .values({ workspaceId: ws, platform: 'discord', lastAttemptAt: new Date(), lastError: patch.lastError })
        .onConflictDoUpdate({ target: [integrationSyncState.workspaceId, integrationSyncState.platform], set: { lastError: patch.lastError } })
    }
  }

  function queueState(ws: string, r: Running, patch: GatewayStatePatch) {
    Object.assign(r.pending, patch)
    const flush = () => {
      if (r.timer) clearTimeout(r.timer)
      r.timer = null
      const p = r.pending
      r.pending = {}
      if (Object.keys(p).length === 0) return
      persist(ws, p).catch((err) => {
        logger.warn({ err, ws }, 'gateway state persist failed')
      })
    }
    if (patch.status !== undefined) return flush()
    if (!r.timer) {
      r.timer = setTimeout(flush, STATE_DEBOUNCE_MS)
      r.timer.unref?.()
    }
  }

  async function start(ws: string, credentialsEnc: string, credHash: string) {
    let creds: { bot_token: string; server_id: string }
    try {
      creds = decryptJson(credentialsEnc)
    } catch (err) {
      logger.warn({ err, ws }, 'gateway: cannot decrypt credentials')
      return
    }
    if (!(await tryLock(ws))) {
      integrationLog('gateway.lock_busy', { workspaceId: ws })
      return
    }
    const [state] = await db.select().from(discordGatewayState).where(eq(discordGatewayState.workspaceId, ws)).limit(1)
    const fresh = state && Date.now() - state.updatedAt.getTime() < RESUME_MAX_AGE_MS
    const resume: ResumeState | null = fresh && state.sessionId && state.resumeUrl && state.seq !== null ? { sessionId: state.sessionId, resumeUrl: state.resumeUrl, seq: state.seq } : null
    const ladderIndex = state?.missingIntents?.length ? INTENT_LADDER.findIndex((l) => l.missing.join() === state.missingIntents.join()) : 0
    const handler = createDispatchHandler({ workspaceId: ws, guildId: creds.server_id })
    const entry: Running = { conn: null as unknown as DiscordGatewayConnection, handler, credHash, startedAt: Date.now(), pending: {}, timer: null }
    entry.conn = new DiscordGatewayConnection({
      token: creds.bot_token,
      guildId: creds.server_id,
      ladderIndex: ladderIndex < 0 ? 0 : ladderIndex,
      resume,
      sockets: opts.sockets,
      gatewayUrl: () => (opts.gatewayUrl ?? fetchGatewayUrl)(creds.bot_token),
      identifyGate: opts.identifyGate ?? identifyGate,
      hooks: {
        onDispatch: (t, d) => handler.handle(t, d),
        onState: (patch) => queueState(ws, entry, patch),
        onLog: (event, data) => integrationLog(event, { workspaceId: ws, ...data }),
      },
    })
    running.set(ws, entry)
    integrationLog('gateway.start', { workspaceId: ws, resume: resume !== null, ladderIndex })
    await entry.conn.start()
  }

  async function stopOne(ws: string, reason: string) {
    const r = running.get(ws)
    if (!r) return
    running.delete(ws)
    await r.conn.stop()
    if (r.timer) clearTimeout(r.timer)
    await r.handler.flushCursors().catch(() => undefined)
    // Session details are kept so the next process can RESUME.
    await persist(ws, { ...r.pending, status: 'disconnected', seq: r.conn.session?.seq ?? null, sessionId: r.conn.session?.sessionId ?? null, resumeUrl: r.conn.session?.resumeUrl ?? null }).catch(() => undefined)
    await unlock(ws)
    integrationLog('gateway.stop', { workspaceId: ws, reason })
  }

  async function tick() {
    if (stopped) return
    const rows = await db
      .select({ workspaceId: integrations.workspaceId, enc: integrations.credentialsEnc })
      .from(integrations)
      .where(and(eq(integrations.platform, 'discord'), eq(integrations.status, 'connected')))
    const wanted = new Map(rows.filter((r) => r.enc).map((r) => [r.workspaceId, r.enc!]))
    for (const ws of [...running.keys()]) {
      const r = running.get(ws)!
      const enc = wanted.get(ws)
      if (!enc) {
        await stopOne(ws, 'not connected')
        continue
      }
      const hash = createHash('sha256').update(enc).digest('hex')
      if (hash !== r.credHash) {
        await stopOne(ws, 'credentials changed')
        continue
      }
      if (r.conn.status === 'error') {
        await stopOne(ws, 'error')
        // Auth failures flip the row to error, so it will not be retried until reconnected.
        continue
      }
      if (r.conn.missingIntents.length && Date.now() - r.startedAt > LADDER_RESET_MS) {
        await stopOne(ws, 'intent ladder reset')
        await db.update(discordGatewayState).set({ missingIntents: [] }).where(eq(discordGatewayState.workspaceId, ws))
        continue
      }
      await r.handler.flushCursors().catch((err) => logger.warn({ err, ws }, 'cursor flush failed'))
      if (r.conn.status === 'connected') queueState(ws, r, { lastAckAt: r.pending.lastAckAt ?? new Date() })
    }
    for (const [ws, enc] of wanted) {
      if (running.has(ws)) continue
      try {
        await start(ws, enc, createHash('sha256').update(enc).digest('hex'))
      } catch (err) {
        logger.error({ err, ws }, 'gateway start failed')
        captureException(err, { ws })
      }
    }
  }

  const interval = setInterval(() => void tick().catch((err) => logger.error({ err }, 'gateway tick failed')), tickMs)
  interval.unref?.()
  void tick().catch((err) => logger.error({ err }, 'gateway tick failed'))

  return {
    tick,
    running: () => [...running.keys()],
    async stop() {
      stopped = true
      clearInterval(interval)
      for (const ws of [...running.keys()]) await stopOne(ws, 'shutdown')
      await lock?.end().catch(() => undefined)
      lock = null
    },
  }
}
