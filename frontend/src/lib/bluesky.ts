// Client-side Bluesky listening, public AppView, no auth, no API key, CORS-enabled.
// Docs: https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts
//
// Bluesky is an OPEN protocol (AT Protocol); its public search endpoint is
// callable directly from the browser with a plain fetch, €0, no backend.

const SEARCH_ENDPOINT = 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts'

export interface BlueskyPost {
  /** Stable key, the post's AT-URI. */
  uri: string
  handle: string
  displayName: string
  avatar: string | null
  text: string
  createdAt: string
  likeCount: number
  repostCount: number
  replyCount: number
  /** Public web permalink on bsky.app. */
  url: string
}

// Shape of the slice of the API response we consume. Kept permissive, the
// public API can omit counts, avatars, or display names.
interface RawPost {
  uri?: string
  author?: {
    handle?: string
    displayName?: string
    avatar?: string
  }
  record?: {
    text?: string
    createdAt?: string
  }
  likeCount?: number
  repostCount?: number
  replyCount?: number
}

interface SearchResponse {
  posts?: RawPost[]
}

/** at://did:plc:xxx/app.bsky.feed.post/<rkey> → https://bsky.app/profile/<handle>/post/<rkey> */
function buildPostUrl(uri: string, handle: string): string {
  const rkey = uri.split('/').pop() ?? ''
  return `https://bsky.app/profile/${handle}/post/${rkey}`
}

/**
 * Search recent public Bluesky posts mentioning `keyword`.
 * Resolves to an empty array for an empty query; throws on network / API errors
 * so callers can render an error state.
 */
export async function searchBluesky(keyword: string): Promise<BlueskyPost[]> {
  const q = keyword.trim()
  if (!q) return []

  const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}&limit=25&sort=latest`

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

  const posts = data.posts ?? []
  return posts
    .filter((p): p is RawPost & { uri: string } => typeof p.uri === 'string' && p.uri.length > 0)
    .map((p) => {
      const handle = p.author?.handle ?? 'unknown'
      return {
        uri: p.uri,
        handle,
        displayName: p.author?.displayName?.trim() || handle,
        avatar: p.author?.avatar ?? null,
        text: p.record?.text ?? '',
        createdAt: p.record?.createdAt ?? '',
        likeCount: p.likeCount ?? 0,
        repostCount: p.repostCount ?? 0,
        replyCount: p.replyCount ?? 0,
        url: buildPostUrl(p.uri, handle),
      }
    })
}
