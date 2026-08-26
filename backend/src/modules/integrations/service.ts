import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { integrations, integrationSyncState, platformMetricSnapshots, platformMetrics } from '../../db/schema/index.js'
import { platformClients, PlatformError, type IntegrationPlatform } from '../../integrations/index.js'
import { logger } from '../../logger.js'
import * as repo from './repo.js'
import { publishMany } from '../../lib/events.js'
import { createHash } from 'node:crypto'
import { config, telegramMtprotoEnabled } from '../../config.js'
import { registerWebhook, removeWebhook, webhookUrlFor } from '../../integrations/telegram/client.js'
import { integrationLog } from '../../lib/integrationLog.js'

// Snapshot cadence: a new row only when the payload changed, plus a
// heartbeat so short windows never go empty (BP §5).
const HEARTBEAT_MS = 30 * 60_000

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  return `{${Object.keys(v as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
    .join(',')}}`
}

export async function connect(workspaceId: string, platform: IntegrationPlatform, input: unknown) {
  const client = platformClients[platform] as (typeof platformClients)[IntegrationPlatform] & { connect(i: unknown): Promise<{ credentials: Record<string, string>; metadata: Record<string, unknown> }> }
  const result = await client.connect(input)
  const requestedAt = new Date().toISOString()
  // History import runs in the worker; the minute tick picks up 'queued'.
  if (platform === 'discord') result.metadata = { ...result.metadata, backfill: { status: 'queued', requestedAt } }
  if (platform === 'telegram') {
    const username = result.metadata.username
    result.metadata = {
      ...result.metadata,
      backfill: !telegramMtprotoEnabled ? { status: 'skipped', reason: 'not_configured' } : !username ? { status: 'skipped', reason: 'private_group' } : { status: 'queued', requestedAt },
      webhook: 'pending',
    }
  }
  const secret = result.credentials.webhook_secret
  const { id } = await repo.upsertConnected(workspaceId, platform, result.credentials, result.metadata, { webhookSecretHash: secret ? sha256(secret) : null })
  if (platform === 'telegram' && secret) {
    // Telegram pushes updates to /webhooks/telegram/<integration id>; the
    // secret travels in a header and only its hash is stored in clear.
    const url = webhookUrlFor(id)
    let webhook: 'set' | 'failed' | 'skipped_local' = 'skipped_local'
    if (url) {
      webhook = await registerWebhook(result.credentials.bot_token!, url, secret)
        .then(() => 'set' as const)
        .catch(() => 'failed' as const)
    }
    await repo.patchMetadata(workspaceId, 'telegram', { webhook, webhook_checked_at: new Date().toISOString() })
    result.metadata.webhook = webhook
    integrationLog('telegram.webhook_set', { workspaceId, integrationId: id, webhook, local: !url })
  }
  await publishMany(workspaceId, ['integrations'])
  await db.delete(integrationSyncState).where(and(eq(integrationSyncState.workspaceId, workspaceId), eq(integrationSyncState.platform, platform)))
  return result.metadata
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// Disconnect: tell Telegram to stop pushing, then wipe the secret and the
// stored message text (repo.disconnect).
export async function disconnect(workspaceId: string, platform: IntegrationPlatform): Promise<boolean> {
  if (platform === 'telegram') {
    const creds = await repo.getCredentials<{ bot_token: string }>(workspaceId, platform)
    if (creds?.bot_token) await removeWebhook(creds.bot_token).catch(() => undefined)
  }
  return repo.disconnect(workspaceId, platform)
}

export interface SyncOutcome {
  ok: boolean
  metrics?: Record<string, unknown>
  error?: string
  code?: PlatformError['code'] | 'NOT_CONNECTED'
}

// Runs one platform sync for one workspace, records the attempt, writes the
// daily rollup and (if changed) a snapshot. Shared by the API and the worker.
export async function syncPlatform(workspaceId: string, platform: IntegrationPlatform): Promise<SyncOutcome> {
  const credentials = await repo.getCredentials<Record<string, string>>(workspaceId, platform)
  if (!credentials) return { ok: false, code: 'NOT_CONNECTED', error: `${platform} is not connected` }

  const now = new Date()
  await db
    .insert(integrationSyncState)
    .values({ workspaceId, platform, lastAttemptAt: now })
    .onConflictDoUpdate({ target: [integrationSyncState.workspaceId, integrationSyncState.platform], set: { lastAttemptAt: now } })

  try {
    const client = platformClients[platform] as { sync(c: Record<string, string>, ctx: { workspaceId: string }): Promise<{ metrics: Record<string, unknown> }> }
    const { metrics } = await client.sync(credentials, { workspaceId })
    await recordMetrics(workspaceId, platform, metrics, now)
    await publishMany(workspaceId, ['platform_metrics', 'platform_metric_snapshots', 'integrations'])
    return { ok: true, metrics }
  } catch (err) {
    const message = err instanceof PlatformError ? err.message : 'Sync failed'
    const code = err instanceof PlatformError ? err.code : 'UPSTREAM'
    if (!(err instanceof PlatformError)) logger.error({ err, workspaceId, platform }, 'sync crashed')
    await db.update(integrationSyncState).set({ lastError: `${code}: ${message}` }).where(and(eq(integrationSyncState.workspaceId, workspaceId), eq(integrationSyncState.platform, platform)))
    if (code === 'INVALID_CREDENTIALS') await db.update(integrations).set({ status: 'error' }).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.platform, platform)))
    return { ok: false, error: message, code }
  }
}

async function recordMetrics(workspaceId: string, platform: IntegrationPlatform, metrics: Record<string, unknown>, now: Date) {
  const day = now.toISOString().slice(0, 10)
  await db.transaction(async (tx) => {
    await tx
      .insert(platformMetrics)
      .values({ workspaceId, platform, date: day, metrics })
      .onConflictDoUpdate({ target: [platformMetrics.workspaceId, platformMetrics.platform, platformMetrics.date], set: { metrics } })
    await tx.update(integrations).set({ lastSync: now, status: 'connected' }).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.platform, platform)))

    const [state] = await tx.select().from(integrationSyncState).where(and(eq(integrationSyncState.workspaceId, workspaceId), eq(integrationSyncState.platform, platform))).limit(1)
    const changed = !state?.lastMetrics || stable(state.lastMetrics) !== stable(metrics)
    const heartbeatDue = !state?.lastSnapshotAt || now.getTime() - state.lastSnapshotAt.getTime() >= HEARTBEAT_MS
    if (changed || heartbeatDue) {
      await tx.insert(platformMetricSnapshots).values({ workspaceId, platform, capturedAt: now, metrics })
    }
    await tx
      .update(integrationSyncState)
      .set({ lastSuccessAt: now, lastMetrics: metrics, lastError: null, ...((changed || heartbeatDue) && { lastSnapshotAt: now }) })
      .where(and(eq(integrationSyncState.workspaceId, workspaceId), eq(integrationSyncState.platform, platform)))
  })
}

export async function latestSnapshot(workspaceId: string, platform: string) {
  const [row] = await db
    .select()
    .from(platformMetricSnapshots)
    .where(and(eq(platformMetricSnapshots.workspaceId, workspaceId), eq(platformMetricSnapshots.platform, platform)))
    .orderBy(desc(platformMetricSnapshots.capturedAt))
    .limit(1)
  return row
}

export const _internal = { stable, sql, apiUrl: () => config.API_URL }
