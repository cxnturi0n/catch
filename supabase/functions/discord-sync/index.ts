import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient } from '../_shared/supabaseAdmin.ts'

interface SyncPayload {
  workspace_id: string
}

interface DiscordGuild {
  approximate_member_count?: number
}

interface AuditLogEntry {
  id: string
  action_type: number
}

interface AuditLogResponse {
  audit_log_entries: AuditLogEntry[]
}

// Discord snowflake IDs encode their creation timestamp in the top 42 bits,
// offset from the Discord epoch (2015-01-01T00:00:00.000Z).
const DISCORD_EPOCH = 1420070400000

function snowflakeToDate(id: string): Date {
  const timestamp = Number(BigInt(id) >> 22n) + DISCORD_EPOCH
  return new Date(timestamp)
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

    const guildRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}?with_counts=true`, { headers })
    if (!guildRes.ok) return jsonResponse({ success: false, error: `Discord API error (${guildRes.status})` }, 502)
    const guild = (await guildRes.json()) as DiscordGuild
    const members = guild.approximate_member_count ?? 0

    const auditRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}/audit-logs?action_type=22&limit=100`, { headers })
    let bans7d = 0
    if (auditRes.ok) {
      const auditLog = (await auditRes.json()) as AuditLogResponse
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      bans7d = auditLog.audit_log_entries.filter((entry) => snowflakeToDate(entry.id).getTime() >= sevenDaysAgo).length
    }

    const today = new Date().toISOString().slice(0, 10)
    const nowIso = new Date().toISOString()

    const { error: metricsError } = await supabase.from('platform_metrics').upsert(
      { workspace_id, platform: 'discord', date: today, metrics: { members, bans_7d: bans7d } },
      { onConflict: 'workspace_id,platform,date' },
    )
    if (metricsError) return jsonResponse({ success: false, error: metricsError.message }, 500)

    await supabase.from('integrations').update({ last_sync: nowIso }).eq('workspace_id', workspace_id).eq('platform', 'discord')

    return jsonResponse({ success: true, members, bans_7d: bans7d })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
