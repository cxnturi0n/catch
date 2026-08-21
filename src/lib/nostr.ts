// Client-side Nostr listening — public search API, no auth, no API key.
// Docs: https://api.nostr.band/ (public relay + search index by nostr.band).
//
// Nostr is an OPEN protocol; nostr.band exposes a keyword search over kind-1
// (text) notes that is callable directly from the browser — €0, no backend.

const SEARCH_ENDPOINT = 'https://api.nostr.band/v0/search'

export interface NostrPost {
  /** Stable key — the note's hex event id. */
  id: string
  /** bech32 npub of the author, or a short hex fallback. */
  npub: string
  /** Best-effort display name (from an accompanying kind-0 profile), else npub. */
  displayName: string
  text: string
  createdAt: string
  /** Public web permalink on njump.me. */
  url: string
}

// Permissive view of the slice of the response we consume. The search API can
// omit profile metadata, so almost everything is optional.
interface RawEvent {
  id?: string
  pubkey?: string
  kind?: number
  content?: string
  created_at?: number
}

interface SearchResponse {
  events?: RawEvent[]
  // nostr.band returns a map of pubkey → resolved profile info under `pubkeys`.
  pubkeys?: Record<string, { pubkey_info?: { name?: string; display_name?: string } }>
}

/**
 * Search recent public Nostr notes mentioning `keyword`.
 * Resolves to an empty array for an empty query; throws on network / API errors
 * so callers can render a per-source error state.
 */
export async function searchNostr(keyword: string): Promise<NostrPost[]> {
  const q = keyword.trim()
  if (!q) return []

  const url = `${SEARCH_ENDPOINT}/${encodeURIComponent(q)}`

  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch {
    throw new Error('network')
  }

  if (res.status === 429) throw new Error('rate-limit')
  if (!res.ok) throw new Error('request-failed')

  let data: SearchResponse
  try {
    data = (await res.json()) as SearchResponse
  } catch {
    throw new Error('bad-response')
  }

  const events = data.events ?? []
  const profiles = data.pubkeys ?? {}

  return events
    .filter(
      (ev): ev is RawEvent & { id: string } =>
        typeof ev.id === 'string' && ev.id.length > 0 && (ev.kind === undefined || ev.kind === 1),
    )
    .slice(0, 25)
    .map((ev) => {
      const pubkey = ev.pubkey ?? ''
      const info = profiles[pubkey]?.pubkey_info
      const shortKey = pubkey ? `${pubkey.slice(0, 12)}…` : 'unknown'
      const name = info?.display_name?.trim() || info?.name?.trim() || shortKey
      return {
        id: ev.id,
        npub: shortKey,
        displayName: name,
        text: ev.content ?? '',
        createdAt: ev.created_at ? new Date(ev.created_at * 1000).toISOString() : '',
        url: `https://njump.me/${ev.id}`,
      }
    })
}
