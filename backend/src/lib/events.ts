import { Client } from 'pg'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { sql } from 'drizzle-orm'
import { logger } from '../logger.js'

// Workspace change notifications over Postgres LISTEN/NOTIFY: any process
// (API or worker) publishes after writing; the API fans out to SSE clients.
// Payload is tiny on purpose, subscribers refetch through the normal routes.

const CHANNEL = 'catch_events'

export interface WorkspaceEvent {
  workspaceId: string
  /** Table-ish topic the SPA already understands (e.g. 'platform_metrics'). */
  topic: string
  at: number
}

export async function publish(workspaceId: string, topic: string): Promise<void> {
  const payload = JSON.stringify({ workspaceId, topic, at: Date.now() } satisfies WorkspaceEvent)
  try {
    await db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`)
  } catch (err) {
    logger.warn({ err, topic }, 'publish failed')
  }
}

export async function publishMany(workspaceId: string, topics: string[]): Promise<void> {
  for (const t of topics) await publish(workspaceId, t)
}

// Coalesces bursts (a gateway can deliver dozens of messages per second) into
// one notification per topic every `delayMs` per workspace.
const pending = new Map<string, { topics: Set<string>; timer: NodeJS.Timeout }>()
export const THROTTLE_MS = 2_000

export function publishThrottled(workspaceId: string, topics: string[], delayMs = THROTTLE_MS): void {
  const p = pending.get(workspaceId)
  if (p) {
    for (const t of topics) p.topics.add(t)
    return
  }
  const entry = {
    topics: new Set(topics),
    timer: setTimeout(() => {
      pending.delete(workspaceId)
      void publishMany(workspaceId, [...entry.topics])
    }, delayMs),
  }
  entry.timer.unref?.()
  pending.set(workspaceId, entry)
}

/** Flush pending throttled notifications (used at shutdown and in tests). */
export async function flushThrottled(): Promise<void> {
  const entries = [...pending.entries()]
  pending.clear()
  for (const [ws, e] of entries) {
    clearTimeout(e.timer)
    await publishMany(ws, [...e.topics])
  }
}

type Listener = (e: WorkspaceEvent) => void
const listeners = new Map<string, Set<Listener>>()
let client: Client | null = null
let connecting: Promise<void> | null = null

async function ensureListening(): Promise<void> {
  if (client) return
  if (connecting) return connecting
  connecting = (async () => {
    const c = new Client({ connectionString: config.DATABASE_URL })
    await c.connect()
    await c.query(`LISTEN ${CHANNEL}`)
    c.on('notification', (msg) => {
      if (!msg.payload) return
      try {
        const e = JSON.parse(msg.payload) as WorkspaceEvent
        listeners.get(e.workspaceId)?.forEach((fn) => fn(e))
      } catch {
        /* malformed payload ignored */
      }
    })
    c.on('error', (err) => {
      logger.error({ err }, 'event listener connection error; reconnecting')
      client = null
      setTimeout(() => void ensureListening().catch(() => undefined), 2_000)
    })
    client = c
    logger.info('event listener connected')
  })().finally(() => {
    connecting = null
  })
  return connecting
}

export async function subscribe(workspaceId: string, fn: Listener): Promise<() => void> {
  await ensureListening()
  let set = listeners.get(workspaceId)
  if (!set) listeners.set(workspaceId, (set = new Set()))
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) listeners.delete(workspaceId)
  }
}

export async function closeEvents(): Promise<void> {
  await client?.end().catch(() => undefined)
  client = null
}

