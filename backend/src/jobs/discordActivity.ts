import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { discordChannelCursors, messageActivity } from '../db/schema/index.js'
import { snowflakeToDate } from '../integrations/discord.js'
import { upstreamFetch } from '../integrations/types.js'
import * as integrations from '../modules/integrations/repo.js'

// Counts human messages per hour across the guild's text channels using a
// per-channel cursor, so history is never re-read. First run only anchors the
// cursor (no backfill), exactly like the legacy function.
const API = 'https://discord.com/api/v10'
const CHANNEL_CAP = 20
const PAGE_CAP = 5
const GUILD_TEXT = 0

export function hourBucket(date: Date): Date {
  const d = new Date(date)
  d.setUTCMinutes(0, 0, 0)
  return d
}

export async function bumpActivity(workspaceId: string, platform: 'discord' | 'telegram', bucket: Date, delta: number) {
  await db
    .insert(messageActivity)
    .values({ workspaceId, platform, bucketStart: bucket, messageCount: delta })
    .onConflictDoUpdate({
      target: [messageActivity.workspaceId, messageActivity.platform, messageActivity.bucketStart],
      set: { messageCount: sql`${messageActivity.messageCount} + ${delta}`, updatedAt: new Date() },
    })
}

export interface ActivityResult {
  channels: number
  messages: number
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
  const buckets = new Map<number, number>()
  let total = 0

  for (const channel of channels) {
    const cursor = cursors.get(channel.id) ?? null
    let newest = cursor
    let after = cursor
    for (let page = 0; page < PAGE_CAP; page++) {
      const res = await upstreamFetch(`${API}/channels/${channel.id}/messages?limit=100${after ? `&after=${after}` : ''}`, { headers })
      if (!res.ok) break // 403: channel not visible to the bot
      const messages = (await res.json()) as Array<{ id: string; timestamp?: string; author?: { bot?: boolean } }>
      if (messages.length === 0) break
      for (const m of messages) {
        if (newest === null || BigInt(m.id) > BigInt(newest)) newest = m.id
        if (m.author?.bot || !cursor) continue // first run: anchor only
        const at = m.timestamp ? new Date(m.timestamp) : snowflakeToDate(m.id)
        if (Number.isNaN(at.getTime())) continue
        const key = hourBucket(at).getTime()
        buckets.set(key, (buckets.get(key) ?? 0) + 1)
        total++
      }
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
  for (const [ms, count] of buckets) await bumpActivity(workspaceId, 'discord', new Date(ms), count)
  return { channels: channels.length, messages: total }
}

export const _where = and
