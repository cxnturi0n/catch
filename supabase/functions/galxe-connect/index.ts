import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient } from '../_shared/supabaseAdmin.ts'

interface ConnectPayload {
  workspace_id: string
  alias: string
  access_token?: string
}

// Galxe public GraphQL API. Public space-scoped queries need no auth; an
// access-token is only required for private admin queries (left optional and
// unused here). Field names per the official Galxe GraphQL docs:
//   space(alias){ id name alias followersCount campaigns(input){ list{ id name status participants{ participantsCount } } } }
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
  id: string
  name: string
  alias: string
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
    const { workspace_id, alias, access_token } = (await req.json()) as ConnectPayload
    if (!workspace_id || !alias) {
      return jsonResponse({ success: false, error: 'workspace_id and alias are required.' }, 400)
    }

    const galxeRes = await fetch(GALXE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(access_token ? { 'access-token': access_token } : {}),
      },
      body: JSON.stringify({ query: SPACE_QUERY, variables: { alias, input: CAMPAIGN_INPUT } }),
    })

    if (!galxeRes.ok) return jsonResponse({ success: false, error: `Galxe API error (${galxeRes.status})` })

    const payload = (await galxeRes.json()) as GalxeResponse
    if (payload.errors?.length) return jsonResponse({ success: false, error: payload.errors[0].message })

    const space = payload.data?.space
    if (!space) return jsonResponse({ success: false, error: 'Galxe space not found' })

    const followers = space.followersCount ?? 0
    const campaignCount = space.campaigns?.list?.length ?? 0

    const supabase = createUserClient(req)
    const { error } = await supabase.from('integrations').upsert(
      {
        workspace_id,
        platform: 'galxe',
        status: 'connected',
        credentials: { alias, ...(access_token ? { access_token } : {}) },
        metadata: { name: space.name, followers, campaign_count: campaignCount },
        last_sync: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,platform' },
    )
    if (error) return jsonResponse({ success: false, error: error.message }, 500)

    return jsonResponse({ success: true, name: space.name, followers, campaign_count: campaignCount })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
