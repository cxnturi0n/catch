import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient } from '../_shared/supabaseAdmin.ts'

interface SyncPayload {
  workspace_id: string
}

const GALXE_ENDPOINT = 'https://graphigo.prod.galaxy.eco/query'

const SPACE_QUERY = `query CatchGalxeSpace($alias: String!, $input: ListCampaignInput!) {
  space(alias: $alias) {
    id
    name
    alias
    followersCount
    campaigns(input: $input) {
      list {
        id
        name
        status
        participants {
          participantsCount
        }
      }
    }
  }
}`

const CAMPAIGN_INPUT = { forAdmin: false, first: 40, after: '-1', excludeChildren: true, listType: 'Newest' }

interface GalxeCampaign {
  status?: string
  participants?: { participantsCount?: number }
}

interface GalxeSpace {
  followersCount?: number
  campaigns?: { list?: GalxeCampaign[] }
}

interface GalxeResponse {
  data?: { space?: GalxeSpace | null }
  errors?: { message: string }[]
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
      .eq('platform', 'galxe')
      .maybeSingle()

    if (integrationError) return jsonResponse({ success: false, error: integrationError.message }, 500)
    if (!integration || integration.status !== 'connected') {
      return jsonResponse({ success: false, error: 'Galxe is not connected for this workspace.' }, 400)
    }

    const { alias, access_token: accessToken } = integration.credentials as { alias: string; access_token?: string }

    const galxeRes = await fetch(GALXE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { 'access-token': accessToken } : {}),
      },
      body: JSON.stringify({ query: SPACE_QUERY, variables: { alias, input: CAMPAIGN_INPUT } }),
    })
    if (!galxeRes.ok) return jsonResponse({ success: false, error: `Galxe API error (${galxeRes.status})` }, 502)

    const payload = (await galxeRes.json()) as GalxeResponse
    if (payload.errors?.length) return jsonResponse({ success: false, error: payload.errors[0].message }, 502)
    const space = payload.data?.space
    if (!space) return jsonResponse({ success: false, error: 'Galxe space not found' }, 502)

    const list = space.campaigns?.list ?? []
    const followers = space.followersCount ?? 0
    // "campaigns" tracks currently-active campaigns; "participants" sums entrants across them.
    const campaigns = list.filter((c) => c.status === 'Active').length
    const participants = list.reduce((sum, c) => sum + (c.participants?.participantsCount ?? 0), 0)

    const today = new Date().toISOString().slice(0, 10)
    const nowIso = new Date().toISOString()

    const { error: metricsError } = await supabase.from('platform_metrics').upsert(
      { workspace_id, platform: 'galxe', date: today, metrics: { followers, campaigns, participants } },
      { onConflict: 'workspace_id,platform,date' },
    )
    if (metricsError) return jsonResponse({ success: false, error: metricsError.message }, 500)

    await supabase.from('integrations').update({ last_sync: nowIso }).eq('workspace_id', workspace_id).eq('platform', 'galxe')

    return jsonResponse({ success: true, followers, campaigns, participants })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
