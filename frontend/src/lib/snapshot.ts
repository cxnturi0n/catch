// Client-side Snapshot listening, public GraphQL hub, no auth, no API key.
// Docs: https://docs.snapshot.org/tools/graphql-api
//
// Snapshot is the OPEN off-chain governance layer for most DAOs; its GraphQL
// hub is callable directly from the browser with CORS, €0, no backend.
// There is no free-text search on proposals, so we pull the most recent
// proposals and filter by keyword in the title/body on the client.

const GRAPHQL_ENDPOINT = 'https://hub.snapshot.org/graphql'

export interface SnapshotProposal {
  /** Stable key, the proposal id. */
  id: string
  /** Space (DAO) name, used as the "author" of the governance post. */
  space: string
  spaceId: string
  title: string
  /** Trimmed body snippet. */
  text: string
  createdAt: string
  state: string
  /** Public web permalink on snapshot.org. */
  url: string
}

interface RawProposal {
  id?: string
  title?: string
  body?: string
  created?: number
  state?: string
  space?: {
    id?: string
    name?: string
  }
}

interface GraphQLResponse {
  data?: { proposals?: RawProposal[] }
  errors?: { message?: string }[]
}

const PROPOSALS_QUERY = `
  query RecentProposals {
    proposals(
      first: 100
      skip: 0
      orderBy: "created"
      orderDirection: desc
    ) {
      id
      title
      body
      created
      state
      space {
        id
        name
      }
    }
  }
`

function snippet(body: string, max = 280): string {
  const clean = body.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

/**
 * Search recent Snapshot governance proposals mentioning `keyword` in the
 * title or body. Resolves to an empty array for an empty query; throws on
 * network / API errors so callers can render a per-source error state.
 */
export async function searchSnapshot(keyword: string): Promise<SnapshotProposal[]> {
  const q = keyword.trim()
  if (!q) return []

  let res: Response
  try {
    res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: PROPOSALS_QUERY }),
    })
  } catch {
    throw new Error('network')
  }

  if (res.status === 429) throw new Error('rate-limit')
  if (!res.ok) throw new Error('request-failed')

  let data: GraphQLResponse
  try {
    data = (await res.json()) as GraphQLResponse
  } catch {
    throw new Error('bad-response')
  }

  if (data.errors && data.errors.length > 0) throw new Error('request-failed')

  const proposals = data.data?.proposals ?? []
  const needle = q.toLowerCase()

  return proposals
    .filter((p): p is RawProposal & { id: string } => typeof p.id === 'string' && p.id.length > 0)
    .filter((p) => {
      const hay = `${p.title ?? ''} ${p.body ?? ''}`.toLowerCase()
      return hay.includes(needle)
    })
    .slice(0, 25)
    .map((p) => {
      const spaceId = p.space?.id ?? ''
      return {
        id: p.id,
        space: p.space?.name?.trim() || spaceId || 'DAO',
        spaceId,
        title: p.title?.trim() || '(senza titolo)',
        text: snippet(p.body ?? ''),
        createdAt: p.created ? new Date(p.created * 1000).toISOString() : '',
        state: p.state ?? '',
        url: `https://snapshot.org/#/${spaceId}/proposal/${p.id}`,
      }
    })
}
