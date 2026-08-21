import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient } from '../_shared/supabaseAdmin.ts'

// Discord activity ingestion for the community activity heatmap (hour × weekday).
//
// NO PRIVILEGED INTENT REQUIRED. Without MESSAGE_CONTENT the REST message
// objects come back with empty `content`/`embeds`/`attachments`, but `id`,
// `author.id`, `author.bot` and `timestamp` are always present — and that is all
// we need to COUNT activity. The bot only needs "View Channel" + "Read Message
// History" on the channels it polls.
//
// Unlike Telegram (webhook-only, no history), Discord REST lets us page
// backwards, so each run resumes from a per-channel cursor. The very first run
// on a channel takes only the most recent 100 messages as the starting point —
// we deliberately do NOT attempt a giant backfill inside a single invocation.
//
// Deploy: npx supabase functions deploy discord-messages-sync

interface SyncPayload {
  workspace_id: string
}

interface DiscordChannel {
  id: string
  type: number
}

interface DiscordMessage {
  id: string
  timestamp?: string
  author?: { id: string; bot?: boolean }
}

interface CursorRow {
  channel_id: string
  last_message_id: string | null
}

// Discord snowflake IDs encode their creation timestamp in the top 42 bits,
// offset from the Discord epoch (2015-01-01T00:00:00.000Z).
const DISCORD_EPOCH = 1420070400000

// Rate-limit guards: a run touches at most CHANNEL_CAP channels and pages at
// most PAGE_CAP times per channel, so it can never hang.
const CHANNEL_CAP = 20
const PAGE_CAP = 5
const GUILD_TEXT = 0

function snowflakeToDate(id: string): Date {
  return new Date(Number(BigInt(id) >> 22n) + DISCORD_EPOCH)
}

// Truncate to the start of the UTC hour — the heatmap bucket key.
function hourBucket(date: Date): string {
  const d = new Date(date)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { workspace_id } = (await req.json()) as SyncPayload
    if (!workspace_id) return jsonResponse({ success: false, error: 'workspace_id is required.' }, 400)

    const supabase = createUserClient(req)
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('credentials, status')
      .eq('workspace_id', workspace_id)
      .eq('platform', 'discord')
      .maybeSingle()

    if (integrationError) return jsonResponse({ success: false, error: integrationError.message }, 500)
    if (!integration || integration.status !== 'connected') {
      return jsonResponse({ success: false, error: 'Discord is not connected for this workspace.' }, 400)
    }

    const { bot_token: botToken, server_id: serverId } = integration.credentials as { bot_token: string; server_id: string }
    const headers = { Authorization: `Bot ${botToken}` }

    const channelsRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}/channels`, { headers })
    if (!channelsRes.ok) return jsonResponse({ success: false, error: `Discord API error (${channelsRes.status})` }, 502)
    const channels = ((await channelsRes.json()) as DiscordChannel[])
      .filter((c) => c.type === GUILD_TEXT)
      .slice(0, CHANNEL_CAP)

    // Load every cursor for this workspace up front (one round-trip).
    const { data: cursorRows } = await supabase
      .from('discord_channel_cursors')
      .select('channel_id, last_message_id')
      .eq('workspace_id', workspace_id)
    const cursors = new Map((cursorRows ?? []).map((r: CursorRow) => [r.channel_id, r.last_message_id]))

    const buckets = new Map<string, number>() // hour ISO → message count
    let scanned = 0
    let polled = 0

    for (const channel of channels) {
      const cursor = cursors.get(channel.id) ?? null
      let newest: string | null = cursor
      let after: string | null = cursor
      let readable = true

      for (let page = 0; page < PAGE_CAP; page++) {
        // With a cursor we walk FORWARD (?after=) collecting everything new.
        // Without one we just grab the latest 100 to anchor the cursor.
        const url = `https://discord.com/api/v10/channels/${channel.id}/messages?limit=100${after ? `&after=${after}` : ''}`
        const res = await fetch(url, { headers })
        if (!res.ok) {
          // 403 = bot can't see this channel; skip it silently rather than failing the run.
          readable = false
          break
        }
        const messages = (await res.json()) as DiscordMessage[]
        if (messages.length === 0) break

        for (const m of messages) {
          if (m.author?.bot) continue // ignore bot chatter
          const at = m.timestamp ? new Date(m.timestamp) : snowflakeToDate(m.id)
          if (Number.isNaN(at.getTime())) continue
          const key = hourBucket(at)
          buckets.set(key, (buckets.get(key) ?? 0) + 1)
          scanned++
        }

        // Discord returns messages newest-first; the highest snowflake is the newest.
        for (const m of messages) {
          if (newest === null || BigInt(m.id) > BigInt(newest)) newest = m.id
        }

        if (messages.length < 100) break
        if (!after) break // first run: one page only, no backfill
        after = newest
      }

      if (!readable) continue
      polled++

      if (newest && newest !== cursor) {
        await supabase.from('discord_channel_cursors').upsert(
          { workspace_id, channel_id: channel.id, last_message_id: newest, updated_at: new Date().toISOString() },
          { onConflict: 'workspace_id,channel_id' },
        )
      }
    }

    // One atomic increment per hour bucket (never per message).
    for (const [bucket, count] of buckets) {
      await supabase.rpc('bump_message_activity', {
        p_workspace: workspace_id,
        p_platform: 'discord',
        p_bucket: bucket,
        p_delta: count,
      })
    }

    return jsonResponse({ success: true, channels: polled, messages: scanned })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
