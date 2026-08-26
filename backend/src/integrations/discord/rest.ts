import { createHash } from 'node:crypto'
import { PlatformError } from '../types.js'

// Discord REST with rate limit bookkeeping: a per-token request budget, the
// per-route buckets Discord announces in response headers, and 429 retries.
// Every Discord REST call in the worker and the API goes through here.

export const API = 'https://discord.com/api/v10'
const TIMEOUT_MS = 15_000
const PER_SECOND = 45 // Discord global limit is 50 req/s per bot
const MAX_RETRIES = 3
const MAX_SLEEP_MS = 60_000

interface RouteState {
  remaining: number
  resetAt: number
}
const routes = new Map<string, RouteState>()
const recent = new Map<string, number[]>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tokenKey = (token: string) => createHash('sha256').update(token).digest('base64url').slice(0, 12)

// Bucket key: method + path with every id except the major parameter
// (channel or guild id right after /channels or /guilds) replaced.
export function routeKey(method: string, path: string): string {
  const clean = path.split('?')[0]!
  const parts = clean.split('/')
  const out = parts.map((p, i) => {
    if (!/^\d{15,22}$/.test(p)) return p
    const prev = parts[i - 1]
    return prev === 'channels' || prev === 'guilds' || prev === 'webhooks' ? p : ':id'
  })
  return `${method.toUpperCase()} ${out.join('/')}`
}

async function waitForBudget(tk: string, now: number) {
  const list = (recent.get(tk) ?? []).filter((t) => now - t < 1000)
  if (list.length >= PER_SECOND) {
    const wait = 1000 - (now - list[0]!)
    if (wait > 0) await sleep(wait)
  }
  list.push(Date.now())
  recent.set(tk, list)
}

export interface DiscordFetchOptions {
  fetchImpl?: typeof fetch
  retries?: number
}

export async function discordFetch(token: string, path: string, init: RequestInit = {}, opts: DiscordFetchOptions = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const tk = tokenKey(token)
  const rk = `${tk}:${routeKey(method, path)}`
  const retries = opts.retries ?? MAX_RETRIES
  const doFetch = opts.fetchImpl ?? fetch
  for (let attempt = 0; ; attempt++) {
    const route = routes.get(rk)
    if (route && route.remaining <= 0 && route.resetAt > Date.now()) {
      const wait = route.resetAt - Date.now()
      if (wait > MAX_SLEEP_MS) throw new PlatformError('Discord rate limit reached', 'RATE_LIMITED', 429)
      await sleep(wait)
    }
    await waitForBudget(tk, Date.now())
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await doFetch(`${API}${path}`, { ...init, headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }, signal: ac.signal })
    } catch {
      throw new PlatformError('Discord unreachable', 'UPSTREAM')
    } finally {
      clearTimeout(timer)
    }
    const remaining = Number(res.headers.get('x-ratelimit-remaining'))
    const resetAfter = Number(res.headers.get('x-ratelimit-reset-after'))
    if (Number.isFinite(remaining) && Number.isFinite(resetAfter)) routes.set(rk, { remaining, resetAt: Date.now() + resetAfter * 1000 })
    if (res.status !== 429) return res
    const body = (await res.json().catch(() => ({}))) as { retry_after?: number; global?: boolean }
    const retryAfter = Math.min(MAX_SLEEP_MS, Math.max(250, (body.retry_after ?? Number(res.headers.get('retry-after')) ?? 1) * 1000))
    if (attempt >= retries) throw new PlatformError('Discord rate limit reached', 'RATE_LIMITED', 429)
    await sleep(retryAfter)
  }
}

export async function discordJson<T>(token: string, path: string, init?: RequestInit, opts?: DiscordFetchOptions): Promise<{ status: number; ok: boolean; body: T | null }> {
  const res = await discordFetch(token, path, init, opts)
  const body = res.ok ? ((await res.json().catch(() => null)) as T | null) : null
  return { status: res.status, ok: res.ok, body }
}

/** Test/maintenance seam. */
export function resetRateLimitState() {
  routes.clear()
  recent.clear()
}
