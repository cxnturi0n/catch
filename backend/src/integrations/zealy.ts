import { PlatformError, upstreamFetch, type PlatformClient } from './types.js'

export interface ZealyCredentials extends Record<string, string> {
  subdomain: string
  api_key: string
}
export interface ZealyConnectInput {
  subdomain: string
  apiKey: string
}

const BASE = 'https://api-v2.zealy.io/public/communities'
const SUBDOMAIN = /^[a-z0-9-]{2,64}$/i

async function get<T>(path: string, apiKey: string): Promise<T> {
  const res = await upstreamFetch(`${BASE}${path}`, { headers: { 'x-api-key': apiKey } })
  if (res.status === 401 || res.status === 403) throw new PlatformError('Invalid API key', 'INVALID_CREDENTIALS', res.status)
  if (res.status === 404) throw new PlatformError('Community not found', 'NOT_FOUND', 404)
  if (res.status === 429) throw new PlatformError('Zealy rate limit reached', 'RATE_LIMITED', 429)
  if (!res.ok) throw new PlatformError(`Zealy API error (${res.status})`, 'UPSTREAM', res.status)
  return (await res.json()) as T
}

export const zealy: PlatformClient<ZealyCredentials, ZealyConnectInput> = {
  async connect({ subdomain, apiKey }) {
    if (!SUBDOMAIN.test(subdomain)) throw new PlatformError('Invalid subdomain', 'NOT_FOUND')
    const c = await get<{ name: string; totalMembers?: number }>(`/${encodeURIComponent(subdomain)}`, apiKey)
    return { credentials: { subdomain, api_key: apiKey }, metadata: { name: c.name, member_count: c.totalMembers ?? 0 } }
  },
  async sync({ subdomain, api_key }) {
    const c = await get<{ totalMembers?: number }>(`/${encodeURIComponent(subdomain)}`, api_key)
    const lb = await get<{ data?: Array<{ userId: string; name?: string; xp?: number }> }>(`/${encodeURIComponent(subdomain)}/leaderboard?page=1&limit=50`, api_key)
    const entries = lb.data ?? []
    const total_xp = entries.reduce((s, e) => s + (typeof e.xp === 'number' ? e.xp : 0), 0)
    const top = entries.slice(0, 10).map((e) => ({ userId: e.userId, name: e.name ?? e.userId, xp: e.xp ?? 0 }))
    return { metrics: { members: c.totalMembers ?? 0, total_xp, top } }
  },
}
