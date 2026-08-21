import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient } from '../_shared/supabaseAdmin.ts'

interface SyncPayload {
  workspace_id: string
}

interface DiscordGuildMember {
  joined_at?: string
  user?: {
    id: string
    username?: string
    bot?: boolean
  }
}

// Discord returns at most 1000 members per page; cap the run so a huge guild can
// never hang the function (20 pages ≈ 20k members).
const PAGE_SIZE = 1000
const MAX_PAGES = 20
// Supabase caps a single select at 1000 rows — page the existing tenure rows too.
const DB_PAGE = 1000
const UPSERT_CHUNK = 500
// A run stamps every member it saw with the SAME timestamp, so "present at the
// previous run" is a comparison against that run's timestamp with a small slack.
const PRESENCE_TOLERANCE_MS = 5 * 60 * 1000
const MAX_RETRY_AFTER_MS = 5000

const MISSING_INTENT_MESSAGE =
  'Discord refused the member list. Enable the Server Members Intent: Discord Developer Portal → your application → Bot → Privileged Gateway Intents → turn on "Server Members Intent", save, then run the sync again.'

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
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

    // Probe the guild first. This endpoint needs NO privileged intent, so it
    // cleanly separates "bad token / bot removed" from "members endpoint blocked
    // because the Server Members Intent is off" — otherwise both look like 401/403.
    const guildRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}`, { headers })
    if (guildRes.status === 401) return jsonResponse({ success: false, error: 'Invalid bot token' })
    if (guildRes.status === 404) return jsonResponse({ success: false, error: 'Bot not in server' })
    if (!guildRes.ok) return jsonResponse({ success: false, error: `Discord API error (${guildRes.status})` }, 502)

    // ── Page through the member list ──
    const seen = new Map<string, string | null>() // discord user id → joined_at
    let after = '0'
    let truncated = false

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `https://discord.com/api/v10/guilds/${serverId}/members?limit=${PAGE_SIZE}&after=${after}`
      let res = await fetch(url, { headers })

      // One polite retry on a rate limit; anything longer is not worth blocking on.
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { retry_after?: number }
        const waitMs = Math.min(Math.round((body.retry_after ?? 1) * 1000), MAX_RETRY_AFTER_MS)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        res = await fetch(url, { headers })
      }

      // The guild probe above already succeeded, so a 401/403 HERE can only mean
      // the privileged intent is missing.
      if (res.status === 401 || res.status === 403) {
        return jsonResponse({ success: false, error: 'MISSING_MEMBERS_INTENT', message: MISSING_INTENT_MESSAGE })
      }
      if (!res.ok) return jsonResponse({ success: false, error: `Discord API error (${res.status})` }, 502)

      const batch = (await res.json()) as DiscordGuildMember[]
      if (!Array.isArray(batch) || batch.length === 0) break

      let highest = after
      for (const member of batch) {
        const user = member.user
        if (!user?.id) continue
        if (BigInt(user.id) > BigInt(highest)) highest = user.id
        if (user.bot === true) continue // bots are not community members
        seen.set(user.id, member.joined_at ?? null)
      }

      if (batch.length < PAGE_SIZE) break
      if (highest === after) break // defensive: no progress → stop instead of looping
      after = highest
      if (page === MAX_PAGES - 1) truncated = true
    }

    const runAt = new Date().toISOString()

    // ── Existing rows (what we already knew about this workspace) ──
    const known = new Map<string, string>() // member_ref → last_seen
    for (let from = 0; ; from += DB_PAGE) {
      const { data, error } = await supabase
        .from('discord_member_tenure')
        .select('member_ref, last_seen')
        .eq('workspace_id', workspace_id)
        .range(from, from + DB_PAGE - 1)
      if (error) return jsonResponse({ success: false, error: error.message }, 500)
      if (!data || data.length === 0) break
      for (const row of data as { member_ref: string; last_seen: string }[]) known.set(row.member_ref, row.last_seen)
      if (data.length < DB_PAGE) break
    }

    // The previous run's timestamp = the newest last_seen we hold. Members whose
    // last_seen already lags behind it left in an EARLIER run and must not be
    // counted as leaving again.
    let previousRunMs = 0
    for (const lastSeen of known.values()) {
      const ms = new Date(lastSeen).getTime()
      if (ms > previousRunMs) previousRunMs = ms
    }

    let newMembers = 0
    for (const ref of seen.keys()) if (!known.has(ref)) newMembers++

    let leftMembers = 0
    if (previousRunMs > 0) {
      for (const [ref, lastSeen] of known) {
        const wasPresent = new Date(lastSeen).getTime() >= previousRunMs - PRESENCE_TOLERANCE_MS
        if (wasPresent && !seen.has(ref)) leftMembers++
      }
    }

    // ── Persist ──
    // first_seen is intentionally absent from the payload: on conflict it keeps
    // its original value, on insert it falls back to the column default.
    const rows = [...seen.entries()].map(([memberRef, joinedAt]) => ({
      workspace_id,
      member_ref: memberRef,
      joined_at: joinedAt,
      last_seen: runAt,
    }))

    for (const part of chunk(rows, UPSERT_CHUNK)) {
      const { error } = await supabase
        .from('discord_member_tenure')
        .upsert(part, { onConflict: 'workspace_id,member_ref' })
      if (error) return jsonResponse({ success: false, error: error.message }, 500)
    }

    const { error: snapshotError } = await supabase.from('discord_membership_snapshots').insert({
      workspace_id,
      captured_at: runAt,
      total_members: seen.size,
      new_members: newMembers,
      left_members: leftMembers,
    })
    if (snapshotError) return jsonResponse({ success: false, error: snapshotError.message }, 500)

    return jsonResponse({
      success: true,
      total: seen.size,
      new: newMembers,
      left: leftMembers,
      // True when the guild is bigger than the page cap: the run is a partial
      // scan, so the caller must not present it as the full membership.
      truncated,
    })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
