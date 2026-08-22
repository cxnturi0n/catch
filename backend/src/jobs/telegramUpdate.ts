import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { integrations, memberMessages, processedTelegramUpdates, telegramMembershipEvents } from '../db/schema/index.js'
import { decryptJson } from '../lib/crypto.js'
import { bumpActivity, hourBucket } from './discordActivity.js'

// Telegram `message` and `chat_member` updates → counters. Message text is
// never stored. Idempotent on update_id (Telegram redelivers until it sees 200).

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
}
export interface TgUpdate {
  update_id?: number
  message?: { chat?: { id: number }; from?: TgUser; date?: number }
  chat_member?: { chat?: { id: number }; date?: number; old_chat_member?: TgChatMember; new_chat_member?: TgChatMember }
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

const displayNameOf = (u: TgUser) => (u.username ? `@${u.username}` : (u.first_name ?? `id:${u.id}`))

// chat_id → workspace. Credentials are encrypted, so decrypt the connected
// Telegram rows (few) and match in memory.
async function workspaceForChat(chatId: string): Promise<string | null> {
  const rows = await db.select({ workspaceId: integrations.workspaceId, enc: integrations.credentialsEnc }).from(integrations).where(and(eq(integrations.platform, 'telegram'), eq(integrations.status, 'connected')))
  for (const r of rows) {
    if (!r.enc) continue
    try {
      if (String(decryptJson<{ chat_id?: string }>(r.enc).chat_id ?? '') === chatId) return r.workspaceId
    } catch {
      /* skip undecryptable row */
    }
  }
  return null
}

export type TelegramOutcome = 'ignored' | 'duplicate' | 'message' | 'join' | 'leave'

export async function processTelegramUpdate(update: TgUpdate): Promise<TelegramOutcome> {
  const chatId = update.message?.chat?.id ?? update.chat_member?.chat?.id
  if (chatId === undefined) return 'ignored'
  const workspaceId = await workspaceForChat(String(chatId))
  if (!workspaceId) return 'ignored'

  if (typeof update.update_id === 'number') {
    const inserted = await db.insert(processedTelegramUpdates).values({ workspaceId, updateId: update.update_id }).onConflictDoNothing().returning({ id: processedTelegramUpdates.updateId })
    if (inserted.length === 0) return 'duplicate'
  }

  const msg = update.message
  if (msg?.from && !msg.from.is_bot) {
    const sentAt = typeof msg.date === 'number' ? new Date(msg.date * 1000) : new Date()
    const day = sentAt.toISOString().slice(0, 10)
    await db
      .insert(memberMessages)
      .values({ workspaceId, platform: 'telegram', memberRef: String(msg.from.id), displayName: displayNameOf(msg.from), day, messageCount: 1 })
      .onConflictDoUpdate({
        target: [memberMessages.workspaceId, memberMessages.platform, memberMessages.memberRef, memberMessages.day],
        set: { messageCount: sql`${memberMessages.messageCount} + 1`, displayName: displayNameOf(msg.from), updatedAt: new Date() },
      })
    await bumpActivity(workspaceId, 'telegram', hourBucket(sentAt), 1)
    return 'message'
  }

  const cm = update.chat_member
  if (cm) {
    const subject = cm.new_chat_member?.user ?? cm.old_chat_member?.user
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
          occurredAt: typeof cm.date === 'number' ? new Date(cm.date * 1000) : new Date(),
        })
        .onConflictDoNothing()
      return eventType
    }
  }
  return 'ignored'
}
