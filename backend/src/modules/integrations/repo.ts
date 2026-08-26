import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { integrations, integrationSyncState, INTEGRATION_PLATFORMS, platformChannels, platformMessages } from '../../db/schema/index.js'
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
  const byPlatform = new Map(rows.map((r) => [r.platform, r]))
  return INTEGRATION_PLATFORMS.map((platform) => {
    const r = byPlatform.get(platform)
    return r
      ? { platform, status: r.status, metadata: r.metadata, lastSync: r.lastSync, lastError: r.lastError ?? null }
      : { platform, status: 'disconnected', metadata: {}, lastSync: null, lastError: null }
  })
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
): Promise<void> {
  const credentialsEnc = encryptJson(credentials)
  await db
    .insert(integrations)
    .values({ workspaceId, platform, status: 'connected', credentialsEnc, metadata })
    .onConflictDoUpdate({
      target: [integrations.workspaceId, integrations.platform],
      set: { status: 'connected', credentialsEnc, metadata, updatedAt: new Date() },
    })
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
