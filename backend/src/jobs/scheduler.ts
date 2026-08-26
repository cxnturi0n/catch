import { PgBoss } from 'pg-boss'
import { and, eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { discordGatewayState, integrations, integrationSyncState } from '../db/schema/index.js'
import { logger } from '../logger.js'
import { captureException } from '../lib/sentry.js'
import { syncPlatform } from '../modules/integrations/service.js'
import type { IntegrationPlatform } from '../integrations/index.js'
import { syncDiscordActivity } from './discordActivity.js'
import { lastMembersRun, MEMBERS_MIN_INTERVAL_MS, syncDiscordMembers } from './discordMembers.js'
import { runRetention } from './retention.js'
import { dispatchDueReports } from '../modules/reports/dispatch.js'
import { recordShiftEventsForAll } from './moderatorPerformance.js'
import { runDiscordBackfill } from './discordBackfill.js'
import { runTelegramBackfill } from './telegramBackfill.js'

// Scheduling rules (BP §5): per-platform floor, deterministic jitter per
// workspace, throttle on the last ATTEMPT (a rejected call still spent quota).
export const PLATFORM_MIN_INTERVAL_MS: Record<IntegrationPlatform, number> = {
  discord: 60_000,
  telegram: 60_000,
  galxe: 300_000,
  zealy: 300_000,
}
const ACTIVITY_KEY = 'discord:activity'
const ACTIVITY_INTERVAL_MS = 60_000
const JITTER_WINDOW_MS = 45_000
// A gateway that acked a heartbeat this recently is live: the REST message
// poller is skipped for that workspace.
export const GATEWAY_HEALTHY_MS = 5 * 60_000
const GRACE_MS = 5_000

export const QUEUES = {
  tick: 'sync-tick',
  sync: 'sync-platform',
  activity: 'discord-activity',
  members: 'discord-members',
  retention: 'retention',
  reports: 'report-dispatch',
  shifts: 'shift-events',
  discordBackfill: 'discord-backfill',
  telegramBackfill: 'telegram-backfill',
} as const

// FNV-1a → stable offset inside the minute so workspaces do not all fire at :00.
export function jitterMs(workspaceId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < workspaceId.length; i++) {
    h ^= workspaceId.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % JITTER_WINDOW_MS
}

export function isDue(lastAttempt: Date | null | undefined, intervalMs: number, now: number): boolean {
  if (!lastAttempt) return true
  return now - lastAttempt.getTime() >= intervalMs - GRACE_MS
}

export function createBoss() {
  return new PgBoss({ connectionString: config.DATABASE_URL, schema: 'pgboss', max: 5 })
}

// Runs every minute: decide what is due and enqueue one job per
// (workspace, platform) with a singleton key so a slow job never stacks up.
export async function enqueueDueSyncs(boss: PgBoss, now = Date.now()) {
  const rows = await db
    .select({ workspaceId: integrations.workspaceId, platform: integrations.platform, metadata: integrations.metadata })
    .from(integrations)
    .where(eq(integrations.status, 'connected'))
  const states = await db.select().from(integrationSyncState)
  const lastAttempt = new Map(states.map((s) => [`${s.workspaceId}:${s.platform}`, s.lastAttemptAt]))
  const gateways = await db.select({ workspaceId: discordGatewayState.workspaceId, status: discordGatewayState.status, lastAckAt: discordGatewayState.lastAckAt }).from(discordGatewayState)
  const liveGateway = new Set(gateways.filter((g) => g.status === 'connected' && g.lastAckAt && now - g.lastAckAt.getTime() < GATEWAY_HEALTHY_MS).map((g) => g.workspaceId))
  let queued = 0
  for (const row of rows) {
    const platform = row.platform as IntegrationPlatform
    const startAfter = jitterMs(row.workspaceId) / 1000
    if (isDue(lastAttempt.get(`${row.workspaceId}:${platform}`), PLATFORM_MIN_INTERVAL_MS[platform], now)) {
      await boss.send(QUEUES.sync, { workspaceId: row.workspaceId, platform }, { singletonKey: `${row.workspaceId}:${platform}`, startAfter, expireInSeconds: 120, retryLimit: 0 })
      queued++
    }
    // History imports requested by connect or by the manual endpoint. The
    // singleton key makes the repeated send a no-op while one is queued.
    const backfill = (row.metadata as { backfill?: { status?: string } }).backfill
    if (backfill?.status === 'queued' && (platform === 'discord' || platform === 'telegram')) {
      const q = platform === 'discord' ? QUEUES.discordBackfill : QUEUES.telegramBackfill
      await boss.send(q, { workspaceId: row.workspaceId }, { singletonKey: `${row.workspaceId}:${platform}-backfill`, expireInSeconds: 3600, retryLimit: 2, retryDelay: 60 })
      queued++
    }
    if (platform === 'discord') {
      if (!liveGateway.has(row.workspaceId) && isDue(lastAttempt.get(`${row.workspaceId}:${ACTIVITY_KEY}`), ACTIVITY_INTERVAL_MS, now)) {
        await boss.send(QUEUES.activity, { workspaceId: row.workspaceId }, { singletonKey: `${row.workspaceId}:activity`, startAfter, expireInSeconds: 300, retryLimit: 0 })
        queued++
      }
      const last = await lastMembersRun(row.workspaceId)
      if (!last || now - last.getTime() >= MEMBERS_MIN_INTERVAL_MS) {
        await boss.send(QUEUES.members, { workspaceId: row.workspaceId }, { singletonKey: `${row.workspaceId}:members`, startAfter, expireInSeconds: 900, retryLimit: 0 })
        queued++
      }
    }
  }
  return { integrations: rows.length, queued }
}

async function markAttempt(workspaceId: string, key: string, error?: string) {
  const now = new Date()
  await db
    .insert(integrationSyncState)
    .values({ workspaceId, platform: key, lastAttemptAt: now, lastSuccessAt: error ? null : now, lastError: error ?? null })
    .onConflictDoUpdate({ target: [integrationSyncState.workspaceId, integrationSyncState.platform], set: { lastAttemptAt: now, ...(error ? { lastError: error } : { lastSuccessAt: now, lastError: null }) } })
}

export async function startWorker(boss: PgBoss) {
  await boss.start()
  for (const q of Object.values(QUEUES)) await boss.createQueue(q).catch(() => undefined)

  await boss.schedule(QUEUES.tick, '* * * * *', {}, { tz: 'UTC' })
  await boss.schedule(QUEUES.retention, '0 3 * * *', {}, { tz: 'UTC' })
  await boss.schedule(QUEUES.reports, '0 * * * *', {}, { tz: 'UTC' })
  await boss.schedule(QUEUES.shifts, '10 0 * * *', {}, { tz: 'UTC' })

  await boss.work(QUEUES.tick, { batchSize: 1 }, async () => {
    const r = await enqueueDueSyncs(boss)
    if (r.queued) logger.info(r, 'sync tick')
  })

  await boss.work<{ workspaceId: string; platform: IntegrationPlatform }>(QUEUES.sync, { batchSize: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    const { workspaceId, platform } = job!.data
    const out = await syncPlatform(workspaceId, platform)
    if (!out.ok) logger.warn({ workspaceId, platform, code: out.code, error: out.error }, 'sync failed')
  })

  await boss.work<{ workspaceId: string }>(QUEUES.activity, { batchSize: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    const { workspaceId } = job!.data
    try {
      const r = await syncDiscordActivity(workspaceId)
      await markAttempt(workspaceId, ACTIVITY_KEY)
      if (r?.messages) logger.info({ workspaceId, ...r }, 'discord activity')
    } catch (err) {
      await markAttempt(workspaceId, ACTIVITY_KEY, err instanceof Error ? err.message : 'failed')
      throw err
    }
  })

  await boss.work<{ workspaceId: string }>(QUEUES.members, { batchSize: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
    const { workspaceId } = job!.data
    const r = await syncDiscordMembers(workspaceId)
    if (r.ok) logger.info({ workspaceId, total: r.total, new: r.new, left: r.left }, 'discord members')
    else if (r.code !== 'THROTTLED') {
      logger.warn({ workspaceId, code: r.code }, 'discord members failed')
      // Record so the tick does not retry a missing intent every minute.
      await db.insert(integrationSyncState).values({ workspaceId, platform: 'discord:members', lastAttemptAt: new Date(), lastError: r.code }).onConflictDoUpdate({ target: [integrationSyncState.workspaceId, integrationSyncState.platform], set: { lastAttemptAt: new Date(), lastError: r.code } })
    }
  })

  await boss.work<{ workspaceId: string }>(QUEUES.discordBackfill, { batchSize: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
    const r = await runDiscordBackfill(job!.data.workspaceId)
    if (r) logger.info({ workspaceId: job!.data.workspaceId, status: r.status, messages: r.messages, channels: r.channelsDone }, 'discord backfill')
  })

  await boss.work<{ workspaceId: string }>(QUEUES.telegramBackfill, { batchSize: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
    const r = await runTelegramBackfill(job!.data.workspaceId)
    if (r) logger.info({ workspaceId: job!.data.workspaceId, status: r.status, messages: r.messages, reason: r.reason }, 'telegram backfill')
  })

  await boss.work(QUEUES.reports, { batchSize: 1 }, async () => {
    const r = await dispatchDueReports()
    if (r.sent || r.errors.length) logger.info(r, 'report dispatch')
  })

  await boss.work(QUEUES.shifts, { batchSize: 1 }, async () => {
    logger.info(await recordShiftEventsForAll(), 'shift events')
  })

  await boss.work(QUEUES.retention, { batchSize: 1 }, async () => {
    logger.info(await runRetention(), 'retention')
  })

  boss.on('error', (err) => {
    logger.error({ err }, 'pg-boss error')
    captureException(err)
  })
  boss.on('job-failed' as never, (ev: unknown) => captureException(new Error('job failed'), { job: ev }))
  logger.info('worker started: sync tick every minute, reports hourly, shift events 00:10 UTC, retention 03:00 UTC')
}

export const _eq = and
