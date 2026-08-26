import { db } from '../db/client.js'
import { moderatorActions, MODERATOR_ACTION_TYPES } from '../db/schema/index.js'
import { sanitizeName } from './memberMessages.js'
import { publishThrottled } from '../lib/events.js'

export type ModeratorActionType = (typeof MODERATOR_ACTION_TYPES)[number]

export interface ModeratorActionInput {
  workspaceId: string
  platform: 'discord' | 'telegram'
  actionId: string
  actionType: ModeratorActionType
  executorRef: string
  executorName?: string | null
  targetRef?: string | null
  targetName?: string | null
  channelId?: string | null
  reason?: string | null
  occurredAt: Date
}

// Idempotent on (workspace, platform, action id): the gateway, the minute
// reconciliation and the backfill may all see the same audit entry.
export async function recordModeratorActions(items: ModeratorActionInput[]): Promise<number> {
  if (items.length === 0) return 0
  const rows = items.map((a) => ({
    workspaceId: a.workspaceId,
    platform: a.platform,
    actionId: a.actionId,
    actionType: a.actionType,
    executorRef: a.executorRef,
    executorName: sanitizeName(a.executorName),
    targetRef: a.targetRef ?? null,
    targetName: sanitizeName(a.targetName),
    channelId: a.channelId ?? null,
    reason: sanitizeName(a.reason)?.slice(0, 120) ?? null,
    occurredAt: a.occurredAt,
  }))
  const inserted = await db.insert(moderatorActions).values(rows).onConflictDoNothing().returning({ id: moderatorActions.id })
  if (inserted.length) for (const ws of new Set(items.map((i) => i.workspaceId))) publishThrottled(ws, ['moderator_actions'])
  return inserted.length
}
