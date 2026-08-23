import { lt } from 'drizzle-orm'
import { db } from '../db/client.js'
import { platformMetricSnapshots, processedTelegramUpdates, securityEvents, aiConversations } from '../db/schema/index.js'

// Keeps tables bounded (BP §5 estimated ~3.5k snapshot rows/day/workspace).
export const SNAPSHOT_RETENTION_DAYS = 30
export const SECURITY_EVENTS_RETENTION_DAYS = 365
export const TELEGRAM_DEDUP_RETENTION_DAYS = 7

export const CHAT_RETENTION_DAYS = 30

export async function runRetention(now = new Date()) {
  const cutoff = (days: number) => new Date(now.getTime() - days * 86_400_000)
  const snapshots = await db.delete(platformMetricSnapshots).where(lt(platformMetricSnapshots.capturedAt, cutoff(SNAPSHOT_RETENTION_DAYS))).returning({ id: platformMetricSnapshots.id })
  const events = await db.delete(securityEvents).where(lt(securityEvents.createdAt, cutoff(SECURITY_EVENTS_RETENTION_DAYS))).returning({ id: securityEvents.id })
  const dedup = await db.delete(processedTelegramUpdates).where(lt(processedTelegramUpdates.processedAt, cutoff(TELEGRAM_DEDUP_RETENTION_DAYS))).returning({ id: processedTelegramUpdates.updateId })
  const chats = await db.delete(aiConversations).where(lt(aiConversations.updatedAt, cutoff(CHAT_RETENTION_DAYS))).returning({ id: aiConversations.id })
  return { snapshots: snapshots.length, securityEvents: events.length, telegramDedup: dedup.length, chats: chats.length }
}
