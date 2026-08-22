import { PlatformError, upstreamFetch, type PlatformClient } from './types.js'

export interface GalxeCredentials extends Record<string, string> {
  alias: string
  access_token: string
}
export interface GalxeConnectInput {
  alias: string
  accessToken?: string
}

const ENDPOINT = 'https://graphigo.prod.galaxy.eco/query'
const ALIAS = /^[a-z0-9_-]{1,64}$/i
const QUERY = `query CatchGalxeSpace($alias: String!, $input: ListCampaignInput!) {
  space(alias: $alias) { id name alias followersCount
    campaigns(input: $input) { list { id name status participants { participantsCount } } } } }`
const INPUT = { forAdmin: false, first: 40, after: '-1', excludeChildren: true, listType: 'Newest' }

interface Space {
  name: string
  followersCount?: number
  campaigns?: { list?: Array<{ status?: string; participants?: { participantsCount?: number } }> }
}

async function space(alias: string, accessToken: string): Promise<Space> {
  if (!ALIAS.test(alias)) throw new PlatformError('Invalid space alias', 'NOT_FOUND')
  const res = await upstreamFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accessToken && { 'access-token': accessToken }) },
    body: JSON.stringify({ query: QUERY, variables: { alias, input: INPUT } }),
  })
  if (res.status === 429) throw new PlatformError('Galxe rate limit reached', 'RATE_LIMITED', 429)
  if (!res.ok) throw new PlatformError(`Galxe API error (${res.status})`, 'UPSTREAM', res.status)
  const body = (await res.json()) as { data?: { space?: Space | null }; errors?: Array<{ message: string }> }
  if (body.errors?.length) throw new PlatformError(body.errors[0]!.message, 'UPSTREAM')
  if (!body.data?.space) throw new PlatformError('Galxe space not found', 'NOT_FOUND', 404)
  return body.data.space
}

export const galxe: PlatformClient<GalxeCredentials, GalxeConnectInput> = {
  async connect({ alias, accessToken = '' }) {
    const s = await space(alias, accessToken)
    return {
      credentials: { alias, access_token: accessToken },
      metadata: { name: s.name, followers: s.followersCount ?? 0, campaign_count: s.campaigns?.list?.length ?? 0 },
    }
  },
  async sync({ alias, access_token }) {
    const s = await space(alias, access_token)
    const list = s.campaigns?.list ?? []
    return {
      metrics: {
        followers: s.followersCount ?? 0,
        campaigns: list.filter((c) => c.status === 'Active').length,
        participants: list.reduce((sum, c) => sum + (c.participants?.participantsCount ?? 0), 0),
      },
    }
  },
}
