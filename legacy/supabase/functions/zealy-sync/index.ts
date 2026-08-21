import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient } from '../_shared/supabaseAdmin.ts'

interface SyncPayload {
  workspace_id: string
}

interface ZealyCommunity {
  totalMembers?: number
}

// GET /public/communities/{subdomain}/leaderboard — response envelope (from swagger):
//   { data: [{ userId, xp, name, avatar, address, ... }], totalPages, page, totalRecords, status }
interface ZealyLeaderboardEntry {
  userId: string
  name?: string
  xp?: number
}

interface ZealyLeaderboard {
  data?: ZealyLeaderboardEntry[]
  totalRecords?: number
}

const ZEALY_BASE = 'https://api-v2.zealy.io'
const LEADERBOARD_LIMIT = 50

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
      .eq('platform', 'zealy')
      .maybeSingle()

    if (integrationError) return jsonResponse({ success: false, error: integrationError.message }, 500)
    if (!integration || integration.status !== 'connected') {
      return jsonResponse({ success: false, error: 'Zealy is not connected for this workspace.' }, 400)
    }

    const { subdomain, api_key: apiKey } = integration.credentials as { subdomain: string; api_key: string }
    const headers = { 'x-api-key': apiKey }

    const communityRes = await fetch(`${ZEALY_BASE}/public/communities/${encodeURIComponent(subdomain)}`, { headers })
    if (!communityRes.ok) return jsonResponse({ success: false, error: `Zealy API error (${communityRes.status})` }, 502)
    const community = (await communityRes.json()) as ZealyCommunity
    const members = community.totalMembers ?? 0

    const leaderboardRes = await fetch(
      `${ZEALY_BASE}/public/communities/${encodeURIComponent(subdomain)}/leaderboard?page=1&limit=${LEADERBOARD_LIMIT}`,
      { headers },
    )
    if (!leaderboardRes.ok) return jsonResponse({ success: false, error: `Zealy API error (${leaderboardRes.status})` }, 502)
    const leaderboard = (await leaderboardRes.json()) as ZealyLeaderboard
    const entries = leaderboard.data ?? []

    // total_xp: summed across the fetched top-N leaderboard page (Zealy exposes no
    // community-wide XP total; the top page is the meaningful, bounded proxy).
    const totalXp = entries.reduce((sum, entry) => sum + (typeof entry.xp === 'number' ? entry.xp : 0), 0)
    const top = entries.slice(0, 10).map((entry) => ({ userId: entry.userId, name: entry.name ?? entry.userId, xp: entry.xp ?? 0 }))

    const today = new Date().toISOString().slice(0, 10)
    const nowIso = new Date().toISOString()

    const { error: metricsError } = await supabase.from('platform_metrics').upsert(
      { workspace_id, platform: 'zealy', date: today, metrics: { members, total_xp: totalXp, top } },
      { onConflict: 'workspace_id,platform,date' },
    )
    if (metricsError) return jsonResponse({ success: false, error: metricsError.message }, 500)

    await supabase.from('integrations').update({ last_sync: nowIso }).eq('workspace_id', workspace_id).eq('platform', 'zealy')

    return jsonResponse({ success: true, members, total_xp: totalXp })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
