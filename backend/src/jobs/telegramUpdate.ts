import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { integrations, integrationSyncState, processedTelegramUpdates, telegramMembershipEvents } from '../db/schema/index.js'
import { decryptJson } from '../lib/crypto.js'
import { publishMany } from '../lib/events.js'
import { ingestMessage } from './ingest.js'
import { recordModeratorActions, type ModeratorActionType } from './moderatorActions.js'
import { integrationLog } from '../lib/integrationLog.js'

// Telegram `message`, `chat_member` and `my_chat_member` updates. Messages go
// through the shared ingest (text encrypted, 30 day retention); membership
// changes become join/leave events; admin actions become moderator actions.
// Idempotent on update_id (Telegram redelivers until it sees 200).

interface TgUser {
  id: number
  is_bot?: boolean
  username?: string
  first_name?: string
}
interface TgChatMember {
  user?: TgUser
  status?: string
  is_member?: boolean
  can_send_messages?: boolean
}
export interface TgMessage {
  message_id?: number
  chat?: { id: number; title?: string; type?: string }
  from?: TgUser
  date?: number
  text?: string
  caption?: string
  message_thread_id?: number
  is_topic_message?: boolean
  reply_to_message?: { message_id?: number }
  new_chat_members?: TgUser[]
  left_chat_member?: TgUser
  pinned_message?: unknown
  new_chat_title?: string
  new_chat_photo?: unknown
  delete_chat_photo?: boolean
  group_chat_created?: boolean
  supergroup_chat_created?: boolean
  migrate_to_chat_id?: number
  migrate_from_chat_id?: number
  forum_topic_created?: unknown
  forum_topic_closed?: unknown
  forum_topic_reopened?: unknown
  video_chat_started?: unknown
  video_chat_ended?: unknown
}
export interface TgChatMemberUpdated {
  chat?: { id: number }
  from?: TgUser
  date?: number
  old_chat_member?: TgChatMember
  new_chat_member?: TgChatMember
}
export interface TgUpdate {
  update_id?: number
  message?: TgMessage
  edited_message?: TgMessage
  chat_member?: TgChatMemberUpdated
  my_chat_member?: TgChatMemberUpdated
}

const IN = new Set(['member', 'administrator', 'creator'])
const OUT = new Set(['left', 'kicked'])

function presence(m?: TgChatMember): boolean | null {
  const s = m?.status
  if (!s) return null
  if (IN.has(s)) return true
  if (OUT.has(s)) return false
  if (s === 'restricted') return m?.is_member === true
  return null
}

// Only an in/out boundary crossing is an event; promotions, mutes and
// re-bans of people who already left are ignored.
export function classifyTransition(oldM?: TgChatMember, newM?: TgChatMember): 'join' | 'leave' | null {
  const was = presence(oldM)
  const now = presence(newM)
  if (was === null || now === null || was === now) return null
  return now ? 'join' : 'leave'
}

// Admin action implied by a chat_member transition performed by someone else.
export function classifyAction(oldM?: TgChatMember, newM?: TgChatMember): ModeratorActionType | null {
  const o = oldM?.status
  const n = newM?.status
  if (!n) return null
  if (n === 'kicked' && o !== 'kicked') return 'ban'
  if (o === 'kicked' && (n === 'member' || n === 'left')) return 'unban'
  if (n === 'restricted' && newM?.can_send_messages === false && !(o === 'restricted' && oldM?.can_send_messages === false)) return 'mute'
  if (o === 'restricted' && oldM?.can_send_messages === false && (n === 'member' || (n === 'restricted' && newM?.can_send_messages !== false))) return 'unmute'
  return null
}

const SERVICE_KEYS: Array<keyof TgMessage> = ['new_chat_members', 'left_chat_member', 'pinned_message', 'new_chat_title', 'new_chat_photo', 'delete_chat_photo', 'group_chat_created', 'supergroup_chat_created', 'migrate_to_chat_id', 'migrate_from_chat_id', 'forum_topic_created', 'forum_topic_closed', 'forum_topic_reopened', 'video_chat_started', 'video_chat_ended']
export function isServiceMessage(m: TgMessage): boolean {
  return SERVICE_KEYS.some((k) => m[k] !== undefined)
}

export const displayNameOf = (u: TgUser) => (u.username ? `@${u.username}` : (u.first_name ?? `id:${u.id}`))

// chat_id → workspace (legacy global webhook). Credentials are encrypted, so
// decrypt the connected Telegram rows (few) and match in memory.
async function workspaceForChat(chatId: string): Promise<string | null> {
  const rows = await db.select({ workspaceId: integrations.workspaceId, enc: integrations.credentialsEnc, metadata: integrations.metadata }).from(integrations).where(and(eq(integrations.platform, 'telegram'), eq(integrations.status, 'connected')))
  for (const r of rows) {
    if (String(r.metadata.chat_numeric_id ?? '') === chatId) return r.workspaceId
    if (!r.enc) continue
    try {
      if (String(decryptJson<{ chat_id?: string }>(r.enc).chat_id ?? '') === chatId) return r.workspaceId
    } catch {
      /* skip undecryptable row */
    }
  }
  return null
}

export type TelegramOutcome = 'ignored' | 'duplicate' | 'message' | 'join' | 'leave' | 'action' | 'bot_removed' | 'bot_added'

export interface TelegramUpdateContext {
  workspaceId: string
  /** Numeric chat id the integration was connected to; other chats are ignored. */
  chatId: string | null
}

function chatIdOf(update: TgUpdate): number | undefined {
  return update.message?.chat?.id ?? update.chat_member?.chat?.id ?? update.my_chat_member?.chat?.id ?? update.edited_message?.chat?.id
}

export async function processTelegramUpdate(update: TgUpdate, ctx?: TelegramUpdateContext): Promise<TelegramOutcome> {
  const chatId = chatIdOf(update)
  if (chatId === undefined) return 'ignored'
  let workspaceId: string | null
  if (ctx) {
    if (ctx.chatId && String(chatId) !== ctx.chatId) return 'ignored'
    workspaceId = ctx.workspaceId
  } else workspaceId = await workspaceForChat(String(chatId))
  if (!workspaceId) return 'ignored'

  if (typeof update.update_id === 'number') {
    const inserted = await db.insert(processedTelegramUpdates).values({ workspaceId, updateId: update.update_id }).onConflictDoNothing().returning({ id: processedTelegramUpdates.updateId })
    if (inserted.length === 0) return 'duplicate'
  }

  const msg = update.message
  if (msg?.from && !msg.from.is_bot && !isServiceMessage(msg)) {
    const sentAt = typeof msg.date === 'number' ? new Date(msg.date * 1000) : new Date()
    const topic = msg.is_topic_message && typeof msg.message_thread_id === 'number' ? String(msg.message_thread_id) : null
    const outcome = await ingestMessage({
      workspaceId,
      platform: 'telegram',
      // message_id is always present in real updates; the update id is a safe fallback.
      messageId: `${chatId}:${typeof msg.message_id === 'number' ? msg.message_id : `u${update.update_id ?? Date.now()}`}`,
      channelId: topic ?? String(chatId),
      channelName: topic ? null : (msg.chat?.title ?? null),
      memberRef: String(msg.from.id),
      displayName: displayNameOf(msg.from),
      content: msg.text ?? msg.caption ?? null,
      replyToMessageId: typeof msg.reply_to_message?.message_id === 'number' ? `${chatId}:${msg.reply_to_message.message_id}` : null,
      sentAt,
      source: 'webhook',
    })
    return outcome === 'inserted' ? 'message' : 'duplicate'
  }

  const cm = update.chat_member
  if (cm) {
    const subject = cm.new_chat_member?.user ?? cm.old_chat_member?.user
    const occurredAt = typeof cm.date === 'number' ? new Date(cm.date * 1000) : new Date()
    let result: TelegramOutcome = 'ignored'
    const eventType = classifyTransition(cm.old_chat_member, cm.new_chat_member)
    if (subject && !subject.is_bot && eventType) {
      await db
        .insert(telegramMembershipEvents)
        .values({
          workspaceId,
          chatId: String(chatId),
          userRef: String(subject.id),
          displayName: displayNameOf(subject),
          eventType,
          oldStatus: cm.old_chat_member?.status ?? null,
          newStatus: cm.new_chat_member?.status ?? null,
          occurredAt,
        })
        .onConflictDoNothing()
      await publishMany(workspaceId, ['telegram_membership_events'])
      result = eventType
    }
    // Admin acting on someone else: ban, unban, mute, unmute.
    const action = classifyAction(cm.old_chat_member, cm.new_chat_member)
    if (action && subject && cm.from && !cm.from.is_bot && cm.from.id !== subject.id) {
      await recordModeratorActions([
        {
          workspaceId,
          platform: 'telegram',
          actionId: `tg:${chatId}:${update.update_id ?? `${subject.id}:${occurredAt.getTime()}`}`,
          actionType: action,
          executorRef: String(cm.from.id),
          executorName: displayNameOf(cm.from),
          targetRef: String(subject.id),
          targetName: displayNameOf(subject),
          channelId: String(chatId),
          occurredAt,
        },
      ])
      if (result === 'ignored') result = 'action'
    }
    return result
  }

  // The bot's own membership: removed from the group → error state until it is
  // added back (which flips the row to connected again).
  const mine = update.my_chat_member
  if (mine) {
    const was = presence(mine.old_chat_member)
    const now = presence(mine.new_chat_member)
    if (was !== false && now === false) {
      await db.update(integrations).set({ status: 'error', updatedAt: new Date() }).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.platform, 'telegram')))
      await db
        .insert(integrationSyncState)
        .values({ workspaceId, platform: 'telegram', lastAttemptAt: new Date(), lastError: 'BOT_REMOVED: Bot removed from the group' })
        .onConflictDoUpdate({ target: [integrationSyncState.workspaceId, integrationSyncState.platform], set: { lastError: 'BOT_REMOVED: Bot removed from the group' } })
      await publishMany(workspaceId, ['integrations'])
      integrationLog('telegram.bot_removed', { workspaceId, chatId })
      return 'bot_removed'
    }
    if (was === false && now === true) {
      await db.update(integrations).set({ status: 'connected', updatedAt: new Date() }).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.platform, 'telegram'), eq(integrations.status, 'error')))
      await db.update(integrationSyncState).set({ lastError: null }).where(and(eq(integrationSyncState.workspaceId, workspaceId), eq(integrationSyncState.platform, 'telegram')))
      await publishMany(workspaceId, ['integrations'])
      integrationLog('telegram.bot_added', { workspaceId, chatId })
      return 'bot_added'
    }
  }
  return 'ignored'
}
