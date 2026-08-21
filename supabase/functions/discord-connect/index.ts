import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient } from '../_shared/supabaseAdmin.ts'

interface ConnectPayload {
  workspace_id: string
  bot_token: string
  server_id: string
}

interface DiscordGuild {
  name: string
  icon: string | null
  approximate_member_count?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { workspace_id, bot_token, server_id } = (await req.json()) as ConnectPayload
    if (!workspace_id || !bot_token || !server_id) {
      return jsonResponse({ success: false, error: 'workspace_id, bot_token and server_id are required.' }, 400)
    }

    const discordRes = await fetch(`https://discord.com/api/v10/guilds/${server_id}?with_counts=true`, {
      headers: { Authorization: `Bot ${bot_token}` },
    })

    if (discordRes.status === 401 || discordRes.status === 403) {
      return jsonResponse({ success: false, error: 'Invalid bot token' })
    }
    if (discordRes.status === 404) {
      return jsonResponse({ success: false, error: 'Bot not in server' })
    }
    if (!discordRes.ok) {
      return jsonResponse({ success: false, error: `Discord API error (${discordRes.status})` })
    }

    const guild = (await discordRes.json()) as DiscordGuild
    const memberCount = guild.approximate_member_count ?? 0

    const supabase = createUserClient(req)
    const { error } = await supabase.from('integrations').upsert(
      {
        workspace_id,
        platform: 'discord',
        status: 'connected',
        credentials: { bot_token, server_id },
        metadata: { server_name: guild.name, member_count: memberCount, icon: guild.icon },
        last_sync: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,platform' },
    )
    if (error) return jsonResponse({ success: false, error: error.message }, 500)

    return jsonResponse({ success: true, server_name: guild.name, member_count: memberCount })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
