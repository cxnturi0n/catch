import type { ModeratorActionInput, ModeratorActionType } from '../../jobs/moderatorActions.js'
import { snowflakeToDate } from './client.js'

// Discord audit log entries → moderator actions. Shared by the gateway
// (GUILD_AUDIT_LOG_ENTRY_CREATE), the minute reconciliation and the backfill.

export interface AuditLogEntry {
  id: string
  user_id?: string | null
  target_id?: string | null
  action_type: number
  reason?: string | null
  changes?: Array<{ key: string; new_value?: unknown; old_value?: unknown }>
  options?: { channel_id?: string; count?: string; delete_member_days?: string }
}

export const AUDIT_ACTION = { MEMBER_KICK: 20, MEMBER_BAN_ADD: 22, MEMBER_BAN_REMOVE: 23, MEMBER_UPDATE: 24, MESSAGE_DELETE: 72, MESSAGE_BULK_DELETE: 73 } as const

export function classifyAuditEntry(e: AuditLogEntry): ModeratorActionType | null {
  switch (e.action_type) {
    case AUDIT_ACTION.MEMBER_KICK:
      return 'kick'
    case AUDIT_ACTION.MEMBER_BAN_ADD:
      return 'ban'
    case AUDIT_ACTION.MEMBER_BAN_REMOVE:
      return 'unban'
    case AUDIT_ACTION.MESSAGE_DELETE:
    case AUDIT_ACTION.MESSAGE_BULK_DELETE:
      return 'delete_message'
    case AUDIT_ACTION.MEMBER_UPDATE: {
      const c = e.changes?.find((x) => x.key === 'communication_disabled_until')
      if (!c) return null
      const until = typeof c.new_value === 'string' ? Date.parse(c.new_value) : NaN
      return Number.isFinite(until) && until > Date.now() - 60_000 ? 'timeout' : 'untimeout'
    }
    default:
      return null
  }
}

export function mapAuditEntry(workspaceId: string, e: AuditLogEntry, names: Map<string, string> = new Map()): ModeratorActionInput | null {
  const actionType = classifyAuditEntry(e)
  if (!actionType || !e.user_id || !e.id) return null
  const bulk = e.action_type === AUDIT_ACTION.MESSAGE_BULK_DELETE
  return {
    workspaceId,
    platform: 'discord',
    actionId: e.id,
    actionType,
    executorRef: e.user_id,
    executorName: names.get(e.user_id) ?? null,
    targetRef: bulk ? null : (e.target_id ?? null),
    targetName: !bulk && e.target_id ? (names.get(e.target_id) ?? null) : null,
    channelId: e.options?.channel_id ?? (bulk ? (e.target_id ?? null) : null),
    reason: e.reason ?? (e.options?.count ? `${e.options.count} messages` : null),
    occurredAt: snowflakeToDate(e.id),
  }
}

export function auditUserNames(users: Array<{ id: string; username?: string }> | undefined): Map<string, string> {
  const m = new Map<string, string>()
  for (const u of users ?? []) if (u.id && u.username) m.set(u.id, u.username)
  return m
}
