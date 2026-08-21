import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient } from '../_shared/supabaseAdmin.ts'

interface ConnectPayload {
  workspace_id: string
  bot_token: string
  chat_id: string
}

interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
}

interface TelegramChat {
  title?: string
  type: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { workspace_id, bot_token, chat_id } = (await req.json()) as ConnectPayload
    if (!workspace_id || !bot_token || !chat_id) {
      return jsonResponse({ success: false, error: 'workspace_id, bot_token and chat_id are required.' }, 400)
    }

    const chatRes = await fetch(`https://api.telegram.org/bot${bot_token}/getChat?chat_id=${encodeURIComponent(chat_id)}`)
    const chatData = (await chatRes.json()) as TelegramApiResponse<TelegramChat>

    if (!chatData.ok) {
      const description = chatData.description ?? ''
      if (/unauthorized/i.test(description)) return jsonResponse({ success: false, error: 'Invalid bot token' })
      if (/chat not found/i.test(description)) return jsonResponse({ success: false, error: 'Chat not found' })
      return jsonResponse({ success: false, error: description || 'Failed to reach Telegram API' })
    }

    const countRes = await fetch(`https://api.telegram.org/bot${bot_token}/getChatMemberCount?chat_id=${encodeURIComponent(chat_id)}`)
    const countData = (await countRes.json()) as TelegramApiResponse<number>
    const memberCount = countData.ok && typeof countData.result === 'number' ? countData.result : 0

    const groupName = chatData.result?.title ?? 'Telegram Group'

    const supabase = createUserClient(req)
    const { error } = await supabase.from('integrations').upsert(
      {
        workspace_id,
        platform: 'telegram',
        status: 'connected',
        credentials: { bot_token, chat_id },
        metadata: { group_name: groupName, member_count: memberCount },
        last_sync: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,platform' },
    )
    if (error) return jsonResponse({ success: false, error: error.message }, 500)

    return jsonResponse({ success: true, group_name: groupName, member_count: memberCount })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
