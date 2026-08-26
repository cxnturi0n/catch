import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { discordGatewayState, integrations, integrationSyncState, INTEGRATION_PLATFORMS, platformChannels, platformMessages } from '../../db/schema/index.js'
import { decryptJson, encryptJson } from '../../lib/crypto.js'

export type IntegrationPlatform = (typeof INTEGRATION_PLATFORMS)[number]

// Public projection: everything except the encrypted credentials. This is the
// only shape that leaves the server.
export interface IntegrationView {
  platform: IntegrationPlatform
  status: 'disconnected' | 'connected' | 'error'
  metadata: Record<string, unknown>
  lastSync: Date | null
  lastError: string | null
  /** Collector health for the Integrations card (gateway, webhook, backfill). */
  health: Record<string, unknown>
}

function healthOf(platform: IntegrationPlatform, metadata: Record<string, unknown>, gateway: typeof discordGatewayState.$inferSelect | null): Record<string, unknown> {
  if (platform === 'discord') {
    return {
      gateway: gateway ? { status: gateway.status, connectedAt: gateway.connectedAt, lastEventAt: gateway.lastEventAt, lastAckAt: gateway.lastAckAt, missingIntents: gateway.missingIntents, lastCloseCode: gateway.lastCloseCode, lastError: gateway.lastError } : null,
      backfill: metadata.backfill ?? null,
      auditLog: metadata.audit_log ?? null,
    }
  }
  if (platform === 'telegram') {
    return {
      webhook: metadata.webhook ?? null,
      webhookLastError: metadata.webhook_last_error ?? null,
      privacyMode: metadata.privacy_mode ?? null,
      botIsAdmin: metadata.bot_is_admin ?? null,
      username: metadata.username ?? null,
      backfill: metadata.backfill ?? null,
    }
  }
  return {}
}

export async function listForWorkspace(workspaceId: string): Promise<IntegrationView[]> {
  const rows = await db
    .select({
      platform: integrations.platform,
      status: integrations.status,
      metadata: integrations.metadata,
      lastSync: integrations.lastSync,
      lastError: integrationSyncState.lastError,
    })
    .from(integrations)
    .leftJoin(
      integrationSyncState,
      and(eq(integrationSyncState.workspaceId, integrations.workspaceId), eq(integrationSyncState.platform, integrations.platform)),
    )
    .where(eq(integrations.workspaceId, workspaceId))
  const [gateway] = await db.select().from(discordGatewayState).where(eq(discordGatewayState.workspaceId, workspaceId)).limit(1)
  const byPlatform = new Map(rows.map((r) => [r.platform, r]))
  return INTEGRATION_PLATFORMS.map((platform) => {
    const r = byPlatform.get(platform)
    return r
      ? { platform, status: r.status, metadata: r.metadata, lastSync: r.lastSync, lastError: r.lastError ?? null, health: healthOf(platform, r.metadata, r.status === 'connected' ? (gateway ?? null) : null) }
      : { platform, status: 'disconnected', metadata: {}, lastSync: null, lastError: null, health: {} }
  })
}

export async function getRow(workspaceId: string, platform: IntegrationPlatform): Promise<{ id: string; status: string; metadata: Record<string, unknown> } | null> {
  const [row] = await db.select({ id: integrations.id, status: integrations.status, metadata: integrations.metadata }).from(integrations).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.platform, platform))).limit(1)
  return row ?? null
}

// Server-only: used by connect/sync code paths, never by HTTP responses.
export async function getCredentials<T>(workspaceId: string, platform: IntegrationPlatform): Promise<T | null> {
  const [row] = await db
    .select({ enc: integrations.credentialsEnc, status: integrations.status })
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.platform, platform)))
    .limit(1)
  if (!row?.enc || row.status !== 'connected') return null
  return decryptJson<T>(row.enc)
}

export async function upsertConnected(
  workspaceId: string,
  platform: IntegrationPlatform,
  credentials: Record<string, unknown>,
  metadata: Record<string, unknown>,
  extra: { webhookSecretHash?: string | null } = {},
): Promise<{ id: string }> {
  const credentialsEnc = encryptJson(credentials)
  const [row] = await db
    .insert(integrations)
    .values({ workspaceId, platform, status: 'connected', credentialsEnc, metadata, webhookSecretHash: extra.webhookSecretHash ?? null })
    .onConflictDoUpdate({
      target: [integrations.workspaceId, integrations.platform],
      set: { status: 'connected', credentialsEnc, metadata, webhookSecretHash: extra.webhookSecretHash ?? null, updatedAt: new Date() },
    })
    .returning({ id: integrations.id })
  return row!
}

/** Webhook lookup: the row whose secret hash matches, by integration id. */
export async function getWebhookTarget(integrationId: string): Promise<{ id: string; workspaceId: string; status: string; webhookSecretHash: string | null; metadata: Record<string, unknown> } | null> {
  const [row] = await db
    .select({ id: integrations.id, workspaceId: integrations.workspaceId, status: integrations.status, webhookSecretHash: integrations.webhookSecretHash, metadata: integrations.metadata })
    .from(integrations)
    .where(and(eq(integrations.id, integrationId), eq(integrations.platform, 'telegram')))
    .limit(1)
  return row ?? null
}

// Shallow merge into metadata (jsonb ||): a key present in `patch` replaces
// the stored value wholesale.
export async function patchMetadata(workspaceId: string, platform: IntegrationPlatform, patch: Record<string, unknown>): Promise<void> {
  await db
    .update(integrations)
    .set({ metadata: sql`${integrations.metadata} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.platform, platform)))
}

export async function getMetadata(workspaceId: string, platform: IntegrationPlatform): Promise<Record<string, unknown> | null> {
  const [row] = await db.select({ metadata: integrations.metadata }).from(integrations).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.platform, platform))).limit(1)
  return row?.metadata ?? null
}

// Disconnect wipes the secret; the row stays so history (metrics) keeps its
// context and reconnecting is a plain upsert.
export async function disconnect(workspaceId: string, platform: IntegrationPlatform): Promise<boolean> {
  const updated = await db
    .update(integrations)
    .set({ status: 'disconnected', credentialsEnc: null, metadata: {}, webhookSecretHash: null, updatedAt: new Date() })
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.platform, platform)))
    .returning({ id: integrations.id })
  await db.delete(integrationSyncState).where(and(eq(integrationSyncState.workspaceId, workspaceId), eq(integrationSyncState.platform, platform)))
  // Stored message text belongs to the connection: gone with it. Aggregates stay.
  if (platform === 'discord' || platform === 'telegram') {
    await db.delete(platformMessages).where(and(eq(platformMessages.workspaceId, workspaceId), eq(platformMessages.platform, platform)))
    await db.delete(platformChannels).where(and(eq(platformChannels.workspaceId, workspaceId), eq(platformChannels.platform, platform)))
  }
  return updated.length > 0
}
