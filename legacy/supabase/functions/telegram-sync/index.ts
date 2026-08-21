import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient } from '../_shared/supabaseAdmin.ts'

interface SyncPayload {
  workspace_id: string
}

interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
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
      .eq('platform', 'telegram')
      .maybeSingle()

    if (integrationError) return jsonResponse({ success: false, error: integrationError.message }, 500)
    if (!integration || integration.status !== 'connected') {
      return jsonResponse({ success: false, error: 'Telegram is not connected for this workspace.' }, 400)
    }

    const { bot_token: botToken, chat_id: chatId } = integration.credentials as { bot_token: string; chat_id: string }

    const countRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMemberCount?chat_id=${encodeURIComponent(chatId)}`)
    const countData = (await countRes.json()) as TelegramApiResponse<number>
    if (!countData.ok) return jsonResponse({ success: false, error: countData.description ?? 'Failed to reach Telegram API' }, 502)
    const members = countData.result ?? 0

    const today = new Date().toISOString().slice(0, 10)
    const nowIso = new Date().toISOString()

    const { error: metricsError } = await supabase
      .from('platform_metrics')
      .upsert({ workspace_id, platform: 'telegram', date: today, metrics: { members } }, { onConflict: 'workspace_id,platform,date' })
    if (metricsError) return jsonResponse({ success: false, error: metricsError.message }, 500)

    await supabase.from('integrations').update({ last_sync: nowIso }).eq('workspace_id', workspace_id).eq('platform', 'telegram')

    return jsonResponse({ success: true, members })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
