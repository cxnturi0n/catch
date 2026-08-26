import { and, eq, inArray, not, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { discordChannelCursors, discordMembershipEvents, discordMemberTenure, integrations, platformChannels } from '../../db/schema/index.js'
import { ingestMessage, upsertChannel } from '../../jobs/ingest.js'
import { toIngest, type DiscordRestMessage } from '../../jobs/discordActivity.js'
import { recordModeratorActions } from '../../jobs/moderatorActions.js'
import { publishThrottled } from '../../lib/events.js'
import { mapAuditEntry, type AuditLogEntry } from './auditLog.js'

// Gateway dispatch events → database. Everything here is idempotent: the
// message store dedupes, membership events dedupe on (member, type, time),
// audit entries dedupe on their id.

const CHANNEL_TYPES: Record<number, string> = { 0: 'text', 1: 'dm', 2: 'voice', 4: 'category', 5: 'announcement', 10: 'thread', 11: 'thread', 12: 'thread', 13: 'voice', 15: 'forum', 16: 'media' }
export const channelType = (t: number | undefined) => (t === undefined ? 'other' : (CHANNEL_TYPES[t] ?? 'other'))

interface GuildChannel {
  id: string
  type?: number
  name?: string
  parent_id?: string | null
  position?: number
}
interface GuildMember {
  user?: { id: string; username?: string; bot?: boolean }
  joined_at?: string
  nick?: string | null
}

export interface DispatchContext {
  workspaceId: string
  guildId: string
}

export interface DispatchHandler {
  handle(t: string, d: unknown): Promise<void>
  /** Persist the highest message id seen per channel (REST fallback anchor). */
  flushCursors(): Promise<void>
}

export function createDispatchHandler(ctx: DispatchContext): DispatchHandler {
  const { workspaceId } = ctx
  const cursors = new Map<string, string>()
  const channelNames = new Map<string, string>()

  const noteCursor = (channelId: string, messageId: string) => {
    const cur = cursors.get(channelId)
    if (!cur || BigInt(messageId) > BigInt(cur)) cursors.set(channelId, messageId)
  }

  async function upsertGuildChannels(channels: GuildChannel[], threads: GuildChannel[]) {
    const all = [...channels, ...threads]
    for (const c of all) {
      if (c.name) channelNames.set(c.id, c.name)
      await upsertChannel(workspaceId, 'discord', c.id, { name: c.name ?? null, type: channelType(c.type), parentId: c.parent_id ?? null, position: c.position ?? null, isTracked: true })
    }
    const ids = all.map((c) => c.id)
    if (ids.length) {
      await db
        .update(platformChannels)
        .set({ isTracked: false, updatedAt: new Date() })
        .where(and(eq(platformChannels.workspaceId, workspaceId), eq(platformChannels.platform, 'discord'), not(inArray(platformChannels.channelId, ids))))
    }
  }

  async function membership(user: GuildMember['user'], type: 'join' | 'leave', at: Date, joinedAt: Date | null) {
    if (!user?.id || user.bot) return
    await db.insert(discordMembershipEvents).values({ workspaceId, memberRef: user.id, displayName: user.username ?? null, eventType: type, occurredAt: at }).onConflictDoNothing()
    if (type === 'join') {
      await db
        .insert(discordMemberTenure)
        .values({ workspaceId, memberRef: user.id, joinedAt, firstSeen: at, lastSeen: at })
        .onConflictDoUpdate({ target: [discordMemberTenure.workspaceId, discordMemberTenure.memberRef], set: { lastSeen: at, joinedAt: sql`coalesce(${discordMemberTenure.joinedAt}, ${joinedAt})` } })
    }
    publishThrottled(workspaceId, ['discord_membership_events', 'discord_member_tenure'])
  }

  return {
    async handle(t, d) {
      const data = (d ?? {}) as Record<string, unknown>
      switch (t) {
        case 'GUILD_CREATE': {
          const g = data as { id?: string; channels?: GuildChannel[]; threads?: GuildChannel[]; member_count?: number; name?: string }
          await upsertGuildChannels(g.channels ?? [], g.threads ?? [])
          if (typeof g.member_count === 'number') {
            const patch = JSON.stringify({ member_count: g.member_count, ...(g.name && { server_name: g.name }) })
            await db.update(integrations).set({ metadata: sql`${integrations.metadata} || ${patch}::jsonb` }).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.platform, 'discord')))
          }
          return
        }
        case 'CHANNEL_CREATE':
        case 'CHANNEL_UPDATE':
        case 'THREAD_CREATE':
        case 'THREAD_UPDATE': {
          const c = data as unknown as GuildChannel
          if (!c.id) return
          if (c.name) channelNames.set(c.id, c.name)
          await upsertChannel(workspaceId, 'discord', c.id, { name: c.name ?? null, type: channelType(c.type), parentId: c.parent_id ?? null, position: c.position ?? null, isTracked: true })
          return
        }
        case 'CHANNEL_DELETE':
        case 'THREAD_DELETE': {
          const c = data as unknown as GuildChannel
          if (!c.id) return
          await upsertChannel(workspaceId, 'discord', c.id, { isTracked: false })
          return
        }
        case 'MESSAGE_CREATE': {
          const m = data as unknown as DiscordRestMessage & { channel_id: string; member?: { nick?: string | null } }
          if (!m.channel_id || !m.id) return
          noteCursor(m.channel_id, m.id)
          const input = toIngest(workspaceId, m, m.channel_id, 'gateway')
          if (!input) return
          input.channelName = channelNames.get(m.channel_id) ?? null
          await ingestMessage(input, 'throttled')
          return
        }
        case 'GUILD_MEMBER_ADD': {
          const m = data as GuildMember
          const joined = m.joined_at ? new Date(m.joined_at) : new Date()
          await membership(m.user, 'join', Number.isNaN(joined.getTime()) ? new Date() : joined, Number.isNaN(joined.getTime()) ? null : joined)
          return
        }
        case 'GUILD_MEMBER_REMOVE': {
          const m = data as GuildMember
          await membership(m.user, 'leave', new Date(), null)
          return
        }
        case 'GUILD_AUDIT_LOG_ENTRY_CREATE': {
          const a = mapAuditEntry(workspaceId, data as unknown as AuditLogEntry)
          if (a) await recordModeratorActions([a])
          return
        }
        default:
          return
      }
    },
    async flushCursors() {
      if (cursors.size === 0) return
      const entries = [...cursors.entries()]
      cursors.clear()
      for (const [channelId, lastMessageId] of entries) {
        await db
          .insert(discordChannelCursors)
          .values({ workspaceId, channelId, lastMessageId })
          .onConflictDoUpdate({
            target: [discordChannelCursors.workspaceId, discordChannelCursors.channelId],
            set: { lastMessageId: sql`case when ${discordChannelCursors.lastMessageId} is null or ${lastMessageId}::numeric > ${discordChannelCursors.lastMessageId}::numeric then ${lastMessageId} else ${discordChannelCursors.lastMessageId} end`, updatedAt: new Date() },
          })
      }
    },
  }
}
