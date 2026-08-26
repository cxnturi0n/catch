import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { discordChannelCursors } from '../db/schema/index.js'
import { snowflakeToDate } from '../integrations/discord/client.js'
import { upstreamFetch } from '../integrations/types.js'
import * as integrations from '../modules/integrations/repo.js'
import { ingestBatch, type IngestInput } from './ingest.js'

export { bumpActivity, hourBucket } from './ingest.js'

// REST fallback collector: counts human messages across the guild's text
// channels using a per-channel cursor, so history is never re-read. Runs only
// while the gateway connection for the workspace is not healthy. First run
// only anchors the cursor (the backfill job covers history).
const API = 'https://discord.com/api/v10'
const CHANNEL_CAP = 20
const PAGE_CAP = 5
const GUILD_TEXT = 0

export interface ActivityResult {
  channels: number
  messages: number
}

export interface DiscordRestMessage {
  id: string
  channel_id?: string
  content?: string
  timestamp?: string
  type?: number
  webhook_id?: string
  message_reference?: { message_id?: string }
  author?: { id?: string; username?: string; global_name?: string | null; bot?: boolean }
}

// Message types that carry a human message: 0 default, 19 reply. Everything
// else (joins, boosts, pins, thread starters) is a system notice.
const HUMAN_TYPES = new Set([0, 19])

export function toIngest(workspaceId: string, m: DiscordRestMessage, channelId: string, source: IngestInput['source']): IngestInput | null {
  if (!m.author?.id || m.webhook_id) return null
  if (m.type !== undefined && !HUMAN_TYPES.has(m.type)) return null
  const at = m.timestamp ? new Date(m.timestamp) : snowflakeToDate(m.id)
  return {
    workspaceId,
    platform: 'discord',
    messageId: m.id,
    channelId,
    memberRef: m.author.id,
    displayName: m.author.username ?? null,
    isBot: m.author.bot === true,
    content: m.content ?? null,
    replyToMessageId: m.message_reference?.message_id ?? null,
    sentAt: at,
    source,
  }
}

export async function syncDiscordActivity(workspaceId: string): Promise<ActivityResult | null> {
  const creds = await integrations.getCredentials<{ bot_token: string; server_id: string }>(workspaceId, 'discord')
  if (!creds) return null
  const headers = { Authorization: `Bot ${creds.bot_token}` }
  const channelsRes = await upstreamFetch(`${API}/guilds/${creds.server_id}/channels`, { headers })
  if (!channelsRes.ok) return null
  const channels = ((await channelsRes.json()) as Array<{ id: string; type: number }>).filter((c) => c.type === GUILD_TEXT).slice(0, CHANNEL_CAP)

  const cursorRows = await db.select().from(discordChannelCursors).where(eq(discordChannelCursors.workspaceId, workspaceId))
  const cursors = new Map(cursorRows.map((r) => [r.channelId, r.lastMessageId]))
  let total = 0

  for (const channel of channels) {
    const cursor = cursors.get(channel.id) ?? null
    let newest = cursor
    let after = cursor
    for (let page = 0; page < PAGE_CAP; page++) {
      const res = await upstreamFetch(`${API}/channels/${channel.id}/messages?limit=100${after ? `&after=${after}` : ''}`, { headers })
      if (!res.ok) break // 403: channel not visible to the bot
      const messages = (await res.json()) as DiscordRestMessage[]
      if (messages.length === 0) break
      const batch: IngestInput[] = []
      for (const m of messages) {
        if (newest === null || BigInt(m.id) > BigInt(newest)) newest = m.id
        if (!cursor) continue // first run: anchor only
        const i = toIngest(workspaceId, m, channel.id, 'rest')
        if (i) batch.push(i)
      }
      if (batch.length) total += (await ingestBatch(batch, 'now')).inserted
      if (messages.length < 100 || !after) break
      after = newest
    }
    if (newest && newest !== cursor) {
      await db
        .insert(discordChannelCursors)
        .values({ workspaceId, channelId: channel.id, lastMessageId: newest })
        .onConflictDoUpdate({ target: [discordChannelCursors.workspaceId, discordChannelCursors.channelId], set: { lastMessageId: newest, updatedAt: new Date() } })
    }
  }
  return { channels: channels.length, messages: total }
}

export const _where = and
