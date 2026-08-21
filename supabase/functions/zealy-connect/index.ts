import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient } from '../_shared/supabaseAdmin.ts'

interface ConnectPayload {
  workspace_id: string
  subdomain: string
  api_key: string
}

// GET /public/communities/{subdomain} — the community lookup requires the
// x-api-key header, so this single call validates BOTH the subdomain and the
// API key at once. Response shape (from api-v2.zealy.io swagger):
//   { name, subdomain, id, image, description, sector, blockchain, type, totalMembers }
interface ZealyCommunity {
  id: string
  name: string
  subdomain: string
  totalMembers?: number
}

interface ZealyError {
  code?: string
  message?: string
}

const ZEALY_BASE = 'https://api-v2.zealy.io'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { workspace_id, subdomain, api_key } = (await req.json()) as ConnectPayload
    if (!workspace_id || !subdomain || !api_key) {
      return jsonResponse({ success: false, error: 'workspace_id, subdomain and api_key are required.' }, 400)
    }

    const communityRes = await fetch(`${ZEALY_BASE}/public/communities/${encodeURIComponent(subdomain)}`, {
      headers: { 'x-api-key': api_key },
    })

    if (!communityRes.ok) {
      const err = (await communityRes.json().catch(() => ({}))) as ZealyError
      if (communityRes.status === 401 || communityRes.status === 403) {
        return jsonResponse({ success: false, error: 'Invalid API key' })
      }
      if (communityRes.status === 404) {
        return jsonResponse({ success: false, error: 'Community not found' })
      }
      return jsonResponse({ success: false, error: err.message || `Zealy API error (${communityRes.status})` })
    }

    const community = (await communityRes.json()) as ZealyCommunity
    const memberCount = community.totalMembers ?? 0

    const supabase = createUserClient(req)
    const { error } = await supabase.from('integrations').upsert(
      {
        workspace_id,
        platform: 'zealy',
        status: 'connected',
        credentials: { subdomain, api_key },
        metadata: { name: community.name, member_count: memberCount },
        last_sync: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,platform' },
    )
    if (error) return jsonResponse({ success: false, error: error.message }, 500)

    return jsonResponse({ success: true, name: community.name, member_count: memberCount })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
