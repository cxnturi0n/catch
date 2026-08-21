import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createServiceClient } from '../_shared/supabaseAdmin.ts'

// Scheduled ingestion worker (#4). Runs with the service role so it can refresh
// EVERY connected workspace in one pass — invoked on a schedule by pg_cron
// (every minute since migration 025). Gated by a shared secret so only the
// scheduler can call it; deploy with --no-verify-jwt and set CRON_SECRET on the
// function.
//
//   x-cron-secret: <CRON_SECRET>   (required)
//
// A minute tick is the upper bound of the loop, NOT the polling rate: the tick is
// cheap, the third-party APIs are not. Three mechanisms keep this safe (see the
// "Pacing" section below for the details):
//   1. per-platform minimum interval — a platform is skipped unless it is due;
//   2. per-workspace jitter — workspaces are spread across the minute instead of
//      all firing at second 0;
//   3. change-gated snapshots — platform_metric_snapshots only grows when a value
//      actually moved, so a per-minute loop does not explode the table.
// Everything else (what we measure, the daily platform_metrics upsert, the
// once-a-day membership paging) is unchanged.

const DISCORD_EPOCH = 1420070400000

function snowflakeToDate(id: string): Date {
  return new Date(Number(BigInt(id) >> 22n) + DISCORD_EPOCH)
}

interface IntegrationRow {
  workspace_id: string
  platform: string
  status: string
  credentials: Record<string, string> | null
}

async function syncTelegram(supabase: ReturnType<typeof createServiceClient>, row: IntegrationRow, today: string, nowIso: string) {
  const { bot_token: botToken, chat_id: chatId } = row.credentials ?? {}
  if (!botToken || !chatId) return { ok: false, error: 'missing credentials' }
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getChatMemberCount?chat_id=${encodeURIComponent(chatId)}`)
  const data = (await res.json()) as { ok: boolean; result?: number; description?: string }
  if (!data.ok) return { ok: false, error: data.description ?? 'telegram api error' }
  const members = data.result ?? 0
  await supabase
    .from('platform_metrics')
    .upsert({ workspace_id: row.workspace_id, platform: 'telegram', date: today, metrics: { members } }, { onConflict: 'workspace_id,platform,date' })
  await supabase.from('integrations').update({ last_sync: nowIso }).eq('workspace_id', row.workspace_id).eq('platform', 'telegram')
  return { ok: true, members }
}

async function syncDiscord(supabase: ReturnType<typeof createServiceClient>, row: IntegrationRow, today: string, nowIso: string) {
  const { bot_token: botToken, server_id: serverId } = row.credentials ?? {}
  if (!botToken || !serverId) return { ok: false, error: 'missing credentials' }
  const headers = { Authorization: `Bot ${botToken}` }
  const guildRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}?with_counts=true`, { headers })
  if (!guildRes.ok) return { ok: false, error: `discord api ${guildRes.status}` }
  const guild = (await guildRes.json()) as { approximate_member_count?: number }
  const members = guild.approximate_member_count ?? 0

  const auditRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}/audit-logs?action_type=22&limit=100`, { headers })
  let bans7d = 0
  if (auditRes.ok) {
    const auditLog = (await auditRes.json()) as { audit_log_entries: { id: string }[] }
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    bans7d = auditLog.audit_log_entries.filter((e) => snowflakeToDate(e.id).getTime() >= sevenDaysAgo).length
  }
  await supabase
    .from('platform_metrics')
    .upsert({ workspace_id: row.workspace_id, platform: 'discord', date: today, metrics: { members, bans_7d: bans7d } }, { onConflict: 'workspace_id,platform,date' })
  await supabase.from('integrations').update({ last_sync: nowIso }).eq('workspace_id', row.workspace_id).eq('platform', 'discord')
  return { ok: true, members, bans_7d: bans7d }
}

const ZEALY_BASE = 'https://api-v2.zealy.io'
const GALXE_ENDPOINT = 'https://graphigo.prod.galaxy.eco/query'
const GALXE_SPACE_QUERY = `query CatchGalxeSpace($alias: String!, $input: ListCampaignInput!) {
  space(alias: $alias) {
    followersCount
    campaigns(input: $input) { list { status participants { participantsCount } } }
  }
}`
const GALXE_CAMPAIGN_INPUT = { forAdmin: false, first: 40, after: '-1', excludeChildren: true, listType: 'Newest' }

async function syncZealy(supabase: ReturnType<typeof createServiceClient>, row: IntegrationRow, today: string, nowIso: string) {
  const { subdomain, api_key: apiKey } = row.credentials ?? {}
  if (!subdomain || !apiKey) return { ok: false, error: 'missing credentials' }
  const headers = { 'x-api-key': apiKey }

  const communityRes = await fetch(`${ZEALY_BASE}/public/communities/${encodeURIComponent(subdomain)}`, { headers })
  if (!communityRes.ok) return { ok: false, error: `zealy api ${communityRes.status}` }
  const community = (await communityRes.json()) as { totalMembers?: number }
  const members = community.totalMembers ?? 0

  const leaderboardRes = await fetch(`${ZEALY_BASE}/public/communities/${encodeURIComponent(subdomain)}/leaderboard?page=1&limit=50`, { headers })
  let totalXp = 0
  let top: { userId: string; name: string; xp: number }[] = []
  if (leaderboardRes.ok) {
    const leaderboard = (await leaderboardRes.json()) as { data?: { userId: string; name?: string; xp?: number }[] }
    const entries = leaderboard.data ?? []
    totalXp = entries.reduce((sum, e) => sum + (typeof e.xp === 'number' ? e.xp : 0), 0)
    top = entries.slice(0, 10).map((e) => ({ userId: e.userId, name: e.name ?? e.userId, xp: e.xp ?? 0 }))
  }

  await supabase
    .from('platform_metrics')
    .upsert({ workspace_id: row.workspace_id, platform: 'zealy', date: today, metrics: { members, total_xp: totalXp, top } }, { onConflict: 'workspace_id,platform,date' })
  await supabase.from('integrations').update({ last_sync: nowIso }).eq('workspace_id', row.workspace_id).eq('platform', 'zealy')
  return { ok: true, members, total_xp: totalXp }
}

async function syncGalxe(supabase: ReturnType<typeof createServiceClient>, row: IntegrationRow, today: string, nowIso: string) {
  const { alias, access_token: accessToken } = row.credentials ?? {}
  if (!alias) return { ok: false, error: 'missing credentials' }
  const galxeRes = await fetch(GALXE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { 'access-token': accessToken } : {}) },
    body: JSON.stringify({ query: GALXE_SPACE_QUERY, variables: { alias, input: GALXE_CAMPAIGN_INPUT } }),
  })
  if (!galxeRes.ok) return { ok: false, error: `galxe api ${galxeRes.status}` }
  const payload = (await galxeRes.json()) as {
    data?: { space?: { followersCount?: number; campaigns?: { list?: { status?: string; participants?: { participantsCount?: number } }[] } } | null }
    errors?: { message: string }[]
  }
  if (payload.errors?.length) return { ok: false, error: payload.errors[0].message }
  const space = payload.data?.space
  if (!space) return { ok: false, error: 'space not found' }
  const list = space.campaigns?.list ?? []
  const followers = space.followersCount ?? 0
  const campaigns = list.filter((c) => c.status === 'Active').length
  const participants = list.reduce((sum, c) => sum + (c.participants?.participantsCount ?? 0), 0)

  await supabase
    .from('platform_metrics')
    .upsert({ workspace_id: row.workspace_id, platform: 'galxe', date: today, metrics: { followers, campaigns, participants } }, { onConflict: 'workspace_id,platform,date' })
  await supabase.from('integrations').update({ last_sync: nowIso }).eq('workspace_id', row.workspace_id).eq('platform', 'galxe')
  return { ok: true, followers, campaigns, participants }
}

// ── Discord activity heatmap ingestion (hour × weekday) ──
// Mirrors the discord-messages-sync edge function, but runs under the service
// role so the scheduler can poll every workspace. Counts messages only — no
// MESSAGE_CONTENT intent needed, since `content` is irrelevant to a tally.
const CHANNEL_CAP = 20
const PAGE_CAP = 5
const GUILD_TEXT = 0

function hourBucket(date: Date): string {
  const d = new Date(date)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}

async function syncDiscordActivity(supabase: ReturnType<typeof createServiceClient>, row: IntegrationRow) {
  const { bot_token: botToken, server_id: serverId } = row.credentials ?? {}
  if (!botToken || !serverId) return
  const headers = { Authorization: `Bot ${botToken}` }

  const channelsRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}/channels`, { headers })
  if (!channelsRes.ok) return
  const channels = ((await channelsRes.json()) as { id: string; type: number }[])
    .filter((c) => c.type === GUILD_TEXT)
    .slice(0, CHANNEL_CAP)

  const { data: cursorRows } = await supabase
    .from('discord_channel_cursors')
    .select('channel_id, last_message_id')
    .eq('workspace_id', row.workspace_id)
  const cursors = new Map((cursorRows ?? []).map((r: { channel_id: string; last_message_id: string | null }) => [r.channel_id, r.last_message_id]))

  const buckets = new Map<string, number>()

  for (const channel of channels) {
    const cursor = cursors.get(channel.id) ?? null
    let newest: string | null = cursor
    let after: string | null = cursor

    for (let page = 0; page < PAGE_CAP; page++) {
      const url = `https://discord.com/api/v10/channels/${channel.id}/messages?limit=100${after ? `&after=${after}` : ''}`
      const res = await fetch(url, { headers })
      if (!res.ok) break // 403 = channel not visible to the bot; skip it
      const messages = (await res.json()) as { id: string; timestamp?: string; author?: { bot?: boolean } }[]
      if (messages.length === 0) break

      for (const m of messages) {
        if (m.author?.bot) continue
        const at = m.timestamp ? new Date(m.timestamp) : snowflakeToDate(m.id)
        if (Number.isNaN(at.getTime())) continue
        const key = hourBucket(at)
        buckets.set(key, (buckets.get(key) ?? 0) + 1)
      }
      for (const m of messages) {
        if (newest === null || BigInt(m.id) > BigInt(newest)) newest = m.id
      }

      if (messages.length < 100) break
      if (!after) break // first run anchors the cursor, no backfill
      after = newest
    }

    if (newest && newest !== cursor) {
      await supabase.from('discord_channel_cursors').upsert(
        { workspace_id: row.workspace_id, channel_id: channel.id, last_message_id: newest, updated_at: new Date().toISOString() },
        { onConflict: 'workspace_id,channel_id' },
      )
    }
  }

  for (const [bucket, count] of buckets) {
    await supabase.rpc('bump_message_activity', {
      p_workspace: row.workspace_id,
      p_platform: 'discord',
      p_bucket: bucket,
      p_delta: count,
    })
  }
}

// ── Discord membership / tenure ingestion ──
// Mirrors discord-members-sync under the service role. Paging a whole guild is
// heavy, so this runs at most once a day per workspace (every other cron tick
// skips it). Requires the GUILD_MEMBERS privileged intent; without it Discord
// answers 401/403 and we simply skip — the in-app panel is what tells the user.
const MEMBERS_PAGE_SIZE = 1000
const MEMBERS_MAX_PAGES = 20
const MEMBERS_DB_PAGE = 1000
const MEMBERS_UPSERT_CHUNK = 500
const MEMBERS_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000
const PRESENCE_TOLERANCE_MS = 5 * 60 * 1000

async function syncDiscordMembers(supabase: ReturnType<typeof createServiceClient>, row: IntegrationRow) {
  const { bot_token: botToken, server_id: serverId } = row.credentials ?? {}
  if (!botToken || !serverId) return

  // Throttle: skip unless the newest snapshot is older than the interval.
  const { data: lastSnap } = await supabase
    .from('discord_membership_snapshots')
    .select('captured_at')
    .eq('workspace_id', row.workspace_id)
    .order('captured_at', { ascending: false })
    .limit(1)
  const lastAt = (lastSnap ?? [])[0]?.captured_at as string | undefined
  if (lastAt && Date.now() - new Date(lastAt).getTime() < MEMBERS_MIN_INTERVAL_MS) return

  const headers = { Authorization: `Bot ${botToken}` }
  const seen = new Map<string, string | null>()
  let after = '0'

  for (let page = 0; page < MEMBERS_MAX_PAGES; page++) {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${serverId}/members?limit=${MEMBERS_PAGE_SIZE}&after=${after}`,
      { headers },
    )
    // 401/403 here = Server Members Intent is off. Nothing to report from a cron.
    if (!res.ok) return
    const batch = (await res.json()) as { joined_at?: string; user?: { id: string; bot?: boolean } }[]
    if (!Array.isArray(batch) || batch.length === 0) break

    let highest = after
    for (const member of batch) {
      const user = member.user
      if (!user?.id) continue
      if (BigInt(user.id) > BigInt(highest)) highest = user.id
      if (user.bot === true) continue
      seen.set(user.id, member.joined_at ?? null)
    }
    if (batch.length < MEMBERS_PAGE_SIZE) break
    if (highest === after) break
    after = highest
  }

  if (seen.size === 0) return
  const runAt = new Date().toISOString()

  const known = new Map<string, string>()
  for (let from = 0; ; from += MEMBERS_DB_PAGE) {
    const { data, error } = await supabase
      .from('discord_member_tenure')
      .select('member_ref, last_seen')
      .eq('workspace_id', row.workspace_id)
      .range(from, from + MEMBERS_DB_PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const r of data as { member_ref: string; last_seen: string }[]) known.set(r.member_ref, r.last_seen)
    if (data.length < MEMBERS_DB_PAGE) break
  }

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

  // first_seen omitted on purpose: it survives the upsert / defaults on insert.
  const rows = [...seen.entries()].map(([memberRef, joinedAt]) => ({
    workspace_id: row.workspace_id,
    member_ref: memberRef,
    joined_at: joinedAt,
    last_seen: runAt,
  }))
  for (let i = 0; i < rows.length; i += MEMBERS_UPSERT_CHUNK) {
    await supabase
      .from('discord_member_tenure')
      .upsert(rows.slice(i, i + MEMBERS_UPSERT_CHUNK), { onConflict: 'workspace_id,member_ref' })
  }

  await supabase.from('discord_membership_snapshots').insert({
    workspace_id: row.workspace_id,
    captured_at: runAt,
    total_members: seen.size,
    new_members: newMembers,
    left_members: leftMembers,
  })
}

// ── Pacing ────────────────────────────────────────────────────────────────────
// Since migration 025 pg_cron calls us every minute. That tick is only a chance to
// work: each platform carries its own floor, so nothing is polled faster than its
// budget allows.
//
// Floors are deliberately asymmetric. Discord and Telegram are first-party APIs
// with published, generous limits (and we spend 1–2 requests per workspace), so a
// 60s floor is comfortable — that is the "real-time" the dashboard wants. Galxe and
// Zealy are small third-party APIs with UNDOCUMENTED limits; 300s (5 min) caps them
// at 12 polls per hour per workspace instead of the 60 a minute floor would allow —
// a 5x step up from the old hourly job rather than a 60x one. Follower/XP counters
// there move slowly enough that a 5-minute lag is invisible in the UI, so the extra
// freshness would buy nothing while risking a ban.
const PLATFORM_MIN_INTERVAL_MS: Record<string, number> = {
  discord: 60_000,
  telegram: 60_000,
  galxe: 300_000,
  zealy: 300_000,
}
const DEFAULT_MIN_INTERVAL_MS = 60_000

// The Discord heatmap poll walks up to 20 channels, so it gets its own budget row
// under a pseudo-platform key instead of riding on the metrics floor.
const ACTIVITY_STATE_KEY = 'discord:activity'
const ACTIVITY_MIN_INTERVAL_MS = 60_000

// pg_cron fires on the second, but net.http_post dispatch, cold starts and jitter
// all add drift, so a strict `elapsed >= floor` test would systematically miss the
// next tick and silently halve the cadence (60s floor → runs every 2 minutes).
// A few seconds of grace absorbs that without meaningfully raising the call rate.
const INTERVAL_GRACE_MS = 5_000

// Jitter window: workspaces are spread deterministically over the first 45s of the
// minute so we never fire every request at second 0. Deterministic (hash of the
// workspace id) rather than random so a workspace keeps the same slot on every run
// — that keeps the gap between two consecutive polls stable at ~60s instead of
// bouncing between 15s and 105s, which is exactly what a rate limiter punishes.
// Sleeping is free here (no CPU burnt), and 45s leaves headroom inside the
// invocation for the actual HTTP work.
const JITTER_WINDOW_MS = 45_000

// Snapshot policy: platform_metric_snapshots is an append-only history feeding the
// 1h/5h/24h windows. At a per-minute cadence, writing a row per tick would add ~1.4k
// rows/day/platform of mostly identical values, so we only append when the payload
// actually CHANGED — a step function carries the same information for deltas and
// charts. The heartbeat below still forces a row every 30 minutes so a perfectly
// flat metric is not indistinguishable from a dead integration, and so the "last
// hour" window is never empty. Row-count math lives in the header of migration 025.
const SNAPSHOT_HEARTBEAT_MS = 30 * 60 * 1000

interface SyncState {
  last_attempt_at: string | null
  last_success_at: string | null
  last_snapshot_at: string | null
  last_metrics: Record<string, unknown> | null
}

const stateKey = (workspaceId: string, platform: string) => `${workspaceId}::${platform}`

function msSince(iso: string | null | undefined, now: number): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : now - t
}

function isDue(state: SyncState | undefined, intervalMs: number, now: number): boolean {
  return msSince(state?.last_attempt_at, now) >= intervalMs - INTERVAL_GRACE_MS
}

// FNV-1a — tiny, dependency-free, and stable across runs/deploys (unlike anything
// seeded per invocation), which is the whole point of a deterministic offset.
function jitterMs(workspaceId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < workspaceId.length; i++) {
    hash ^= workspaceId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % JITTER_WINDOW_MS
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Key order in a jsonb round-trip is normalised by Postgres, so compare on a
// key-sorted serialisation rather than raw JSON.stringify.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

// One read for the whole pass — the table holds a single row per workspace+platform.
async function loadSyncState(supabase: ReturnType<typeof createServiceClient>) {
  const map = new Map<string, SyncState>()
  const { data } = await supabase
    .from('integration_sync_state')
    .select('workspace_id, platform, last_attempt_at, last_success_at, last_snapshot_at, last_metrics')
  for (const r of (data ?? []) as ({ workspace_id: string; platform: string } & SyncState)[]) {
    map.set(stateKey(r.workspace_id, r.platform), r)
  }
  return map
}

// Best-effort: the sync itself already happened (or is about to), and losing a state
// write must never fail the pass. Worst case we poll one extra time next minute.
async function writeSyncState(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  platform: string,
  patch: Partial<SyncState>,
) {
  try {
    await supabase
      .from('integration_sync_state')
      .upsert({ workspace_id: workspaceId, platform, ...patch }, { onConflict: 'workspace_id,platform' })
  } catch {
    // ignored on purpose — see above
  }
}

function syncRow(supabase: ReturnType<typeof createServiceClient>, row: IntegrationRow, today: string, nowIso: string) {
  switch (row.platform) {
    case 'telegram':
      return syncTelegram(supabase, row, today, nowIso)
    case 'zealy':
      return syncZealy(supabase, row, today, nowIso)
    case 'galxe':
      return syncGalxe(supabase, row, today, nowIso)
    default:
      return syncDiscord(supabase, row, today, nowIso)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Shared-secret gate — only the scheduler (which knows CRON_SECRET) may run this.
  const expected = Deno.env.get('CRON_SECRET')
  if (!expected || req.headers.get('x-cron-secret') !== expected) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
  }

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('integrations')
      .select('workspace_id, platform, status, credentials')
      .in('platform', ['discord', 'telegram', 'zealy', 'galxe'])
      .eq('status', 'connected')

    if (error) return jsonResponse({ success: false, error: error.message }, 500)

    const rows = (data ?? []) as IntegrationRow[]
    const today = new Date().toISOString().slice(0, 10)
    // Captured once, before any jitter sleep, and reused as BOTH the stored
    // timestamp and the due-check reference. Using the post-sleep wall clock here
    // would make each poll drift forward by its own jitter and fall out of the
    // window on the next tick.
    const startedAt = Date.now()
    const nowIso = new Date(startedAt).toISOString()

    const state = await loadSyncState(supabase)

    const results = await Promise.allSettled(
      rows.map(async (row): Promise<{ ok: boolean; skipped?: boolean; error?: string }> => {
        const key = stateKey(row.workspace_id, row.platform)
        const current = state.get(key)
        const interval = PLATFORM_MIN_INTERVAL_MS[row.platform] ?? DEFAULT_MIN_INTERVAL_MS

        // Discord has sub-jobs with their own budgets; they are evaluated even when
        // the metrics poll itself is not due, so the heatmap keeps its own cadence.
        const metricsDue = isDue(current, interval, startedAt)
        const activityDue =
          row.platform === 'discord' &&
          isDue(state.get(stateKey(row.workspace_id, ACTIVITY_STATE_KEY)), ACTIVITY_MIN_INTERVAL_MS, startedAt)
        if (!metricsDue && !activityDue) return { ok: false, skipped: true }

        // Spread this workspace across the minute before touching any API.
        await sleep(jitterMs(row.workspace_id))

        if (metricsDue) {
          // Marked before the call, not after: a timeout or a 429 still consumed API
          // budget, so it must push the next attempt out by the full interval.
          await writeSyncState(supabase, row.workspace_id, row.platform, { last_attempt_at: nowIso })
        }

        // Not due for metrics but due for a sub-job below: reported as skipped.
        let res: { ok: boolean; skipped?: boolean; error?: string } = { ok: false, skipped: true }
        if (metricsDue) {
          res = await syncRow(supabase, row, today, nowIso)
          if (res.ok) {
            // Timestamped history feeding the 1h/5h/24h windows (the daily upsert
            // above only holds the latest value). Appended on change, plus a
            // heartbeat row — see SNAPSHOT_HEARTBEAT_MS for the reasoning.
            const { ok: _ok, ...metrics } = res as Record<string, unknown>
            const changed = stableStringify(current?.last_metrics ?? null) !== stableStringify(metrics)
            const heartbeatDue = msSince(current?.last_snapshot_at, startedAt) >= SNAPSHOT_HEARTBEAT_MS
            if (changed || heartbeatDue) {
              await supabase
                .from('platform_metric_snapshots')
                .insert({ workspace_id: row.workspace_id, platform: row.platform, captured_at: nowIso, metrics })
              await writeSyncState(supabase, row.workspace_id, row.platform, {
                last_attempt_at: nowIso,
                last_success_at: nowIso,
                last_snapshot_at: nowIso,
                last_metrics: metrics,
              })
            } else {
              await writeSyncState(supabase, row.workspace_id, row.platform, {
                last_attempt_at: nowIso,
                last_success_at: nowIso,
              })
            }
          }
        }

        // Discord also feeds the activity heatmap. Kept separate from the metric
        // snapshot above (message tallies are not a platform metric) and never
        // allowed to fail the row's sync result.
        if (row.platform === 'discord' && activityDue) {
          await writeSyncState(supabase, row.workspace_id, ACTIVITY_STATE_KEY, { last_attempt_at: nowIso })
          try {
            await syncDiscordActivity(supabase, row)
            await writeSyncState(supabase, row.workspace_id, ACTIVITY_STATE_KEY, {
              last_attempt_at: nowIso,
              last_success_at: nowIso,
            })
          } catch {
            // Activity polling is best-effort — the metrics sync already succeeded.
          }
          try {
            await syncDiscordMembers(supabase, row) // self-throttled to once a day
          } catch {
            // Membership paging is best-effort too (and needs a privileged intent).
          }
        }
        return res
      }),
    )

    const value = (r: PromiseSettledResult<{ ok: boolean; skipped?: boolean }>) =>
      r.status === 'fulfilled' ? r.value : null
    const synced = results.filter((r) => value(r)?.ok === true).length
    const skipped = results.filter((r) => value(r)?.skipped === true).length
    const failed = rows.length - synced - skipped

    return jsonResponse({ success: true, total: rows.length, synced, skipped, failed, at: nowIso })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
