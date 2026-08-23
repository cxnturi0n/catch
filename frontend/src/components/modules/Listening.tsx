import { useState, type FormEvent } from 'react'
import { ExternalLink, Heart, Landmark, Loader2, MessageCircle, Radar, Repeat2, Search, Zap } from 'lucide-react'
import { searchBluesky, type BlueskyPost } from '../../lib/bluesky'
import { searchNostr, type NostrPost } from '../../lib/nostr'
import { searchSnapshot, type SnapshotProposal } from '../../lib/snapshot'
import { formatCompactNumber } from '../../lib/format'

// Fine-grained relative time for freshly-posted mentions (seconds → days).
// The shared formatRelativeTime is day-granular, too coarse for a live feed.
function relativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const sec = Math.max(0, Math.floor(diff / 1000))
  if (sec < 60) return 'adesso'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m fa`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h fa`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}g fa`
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

// ── Source model ───────────────────────────────────────────────────────────
// Every source is normalized into a single Mention shape so the feed can merge
// and sort them; `source` drives the per-card badge and the metric row.

type SourceId = 'bluesky' | 'nostr' | 'snapshot'

interface Mention {
  key: string
  source: SourceId
  displayName: string
  handle: string
  avatar: string | null
  text: string
  createdAt: string
  url: string
  linkLabel: string
  bluesky?: { likeCount: number; repostCount: number; replyCount: number }
  snapshot?: { title: string; state: string }
}

const SOURCE_META: Record<SourceId, { label: string; badgeClass: string; icon: typeof Radar }> = {
  bluesky: {
    label: 'Bluesky',
    badgeClass: 'border-[#3F7BFF]/40 bg-[#3F7BFF]/12 text-[#8FB4FF]',
    icon: Radar,
  },
  nostr: {
    label: 'Nostr',
    badgeClass: 'border-[#B26BFF]/40 bg-[#B26BFF]/12 text-[#D3A6FF]',
    icon: Zap,
  },
  snapshot: {
    label: 'Snapshot',
    badgeClass: 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/12 text-[var(--accent-emerald-bright)]',
    icon: Landmark,
  },
}

function toBlueskyMention(p: BlueskyPost): Mention {
  return {
    key: `bluesky:${p.uri}`,
    source: 'bluesky',
    displayName: p.displayName,
    handle: `@${p.handle}`,
    avatar: p.avatar,
    text: p.text,
    createdAt: p.createdAt,
    url: p.url,
    linkLabel: 'Apri su bsky.app',
    bluesky: { likeCount: p.likeCount, repostCount: p.repostCount, replyCount: p.replyCount },
  }
}

function toNostrMention(p: NostrPost): Mention {
  return {
    key: `nostr:${p.id}`,
    source: 'nostr',
    displayName: p.displayName,
    handle: p.npub,
    avatar: null,
    text: p.text,
    createdAt: p.createdAt,
    url: p.url,
    linkLabel: 'Apri su njump.me',
  }
}

function toSnapshotMention(p: SnapshotProposal): Mention {
  return {
    key: `snapshot:${p.id}`,
    source: 'snapshot',
    displayName: p.space,
    handle: 'governance',
    avatar: null,
    text: p.text,
    createdAt: p.createdAt,
    url: p.url,
    linkLabel: 'Apri su snapshot.org',
    snapshot: { title: p.title, state: p.state },
  }
}

// ── Source selector ──────────────────────────────────────────────────────────

type SourceFilter = 'all' | SourceId

const FILTERS: { id: SourceFilter; label: string }[] = [
  { id: 'all', label: 'Tutte' },
  { id: 'bluesky', label: 'Bluesky' },
  { id: 'nostr', label: 'Nostr' },
  { id: 'snapshot', label: 'Snapshot' },
]

function sourcesFor(filter: SourceFilter): SourceId[] {
  return filter === 'all' ? ['bluesky', 'nostr', 'snapshot'] : [filter]
}

const SOURCE_LABELS: Record<SourceId, string> = {
  bluesky: 'Bluesky',
  nostr: 'Nostr',
  snapshot: 'Snapshot',
}

function SourceBadge({ source }: { source: SourceId }) {
  const meta = SOURCE_META[source]
  const Icon = meta.icon
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${meta.badgeClass}`}
    >
      <Icon size={10} />
      {meta.label}
    </span>
  )
}

function PostCard({ post }: { post: Mention }) {
  return (
    <article className="glass rounded-2xl p-4">
      <div className="flex items-start gap-3">
        {post.avatar ? (
          <img
            src={post.avatar}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-emerald)] text-xs font-bold text-white">
            {post.displayName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{post.displayName}</span>
            <span className="truncate font-mono text-xs text-[var(--text-muted)]">{post.handle}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <SourceBadge source={post.source} />
              {post.createdAt && (
                <span className="font-mono text-[11px] text-[var(--text-muted)]">{relativeTime(post.createdAt)}</span>
              )}
            </span>
          </div>

          {post.snapshot && (
            <div className="mt-2 flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{post.snapshot.title}</span>
              {post.snapshot.state && (
                <span className="shrink-0 rounded-full border border-[var(--border-card)] bg-[var(--bg-card)] px-2 py-0.5 font-mono text-[10px] uppercase text-[var(--text-muted)]">
                  {post.snapshot.state}
                </span>
              )}
            </div>
          )}

          <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
            {post.text}
          </p>
          <div className="mt-3 flex items-center gap-4 text-[var(--text-muted)]">
            {post.bluesky && (
              <>
                <span className="flex items-center gap-1.5 font-mono text-xs" title="Like">
                  <Heart size={13} />
                  {formatCompactNumber(post.bluesky.likeCount)}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-xs" title="Repost">
                  <Repeat2 size={14} />
                  {formatCompactNumber(post.bluesky.repostCount)}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-xs" title="Risposte">
                  <MessageCircle size={13} />
                  {formatCompactNumber(post.bluesky.replyCount)}
                </span>
              </>
            )}
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1.5 text-xs font-medium text-[var(--accent-emerald-bright)] transition-colors hover:text-[var(--accent-emerald)]"
            >
              {post.linkLabel}
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>
    </article>
  )
}

export function Listening() {
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [posts, setPosts] = useState<Mention[]>([])
  const [loading, setLoading] = useState(false)
  // Per-source soft failures, the feed still renders whatever succeeded.
  const [failed, setFailed] = useState<SourceId[]>([])
  const [rateLimited, setRateLimited] = useState(false)
  const [searched, setSearched] = useState(false)

  async function runSearch(e?: FormEvent) {
    e?.preventDefault()
    const q = query.trim()
    if (!q || loading) return
    setLoading(true)
    setFailed([])
    setRateLimited(false)
    setSearched(true)
    setTerm(q)

    const sources = sourcesFor(filter)
    const runners: Record<SourceId, Promise<Mention[]>> = {
      bluesky: searchBluesky(q).then((r) => r.map(toBlueskyMention)),
      nostr: searchNostr(q).then((r) => r.map(toNostrMention)),
      snapshot: searchSnapshot(q).then((r) => r.map(toSnapshotMention)),
    }

    const settled = await Promise.allSettled(sources.map((s) => runners[s]))

    const merged: Mention[] = []
    const nowFailed: SourceId[] = []
    let sawRateLimit = false

    settled.forEach((result, i) => {
      const source = sources[i]
      if (result.status === 'fulfilled') {
        merged.push(...result.value)
      } else {
        nowFailed.push(source)
        const code = result.reason instanceof Error ? result.reason.message : ''
        if (code === 'rate-limit') sawRateLimit = true
      }
    })

    // Newest first across all sources.
    merged.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })

    setPosts(merged)
    setFailed(nowFailed)
    setRateLimited(sawRateLimit)
    setLoading(false)
  }

  const activeSources = sourcesFor(filter)
  const allFailed = searched && !loading && failed.length === activeSources.length

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--accent-emerald)]">
          <Radar size={20} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Listening</h1>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Monitor public mentions of your brand across open Web3 protocols.
          </p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={runSearch} className="mt-6 flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search mentions…"
            aria-label="Search mentions across open protocols"
            className="h-11 w-full rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] pl-10 pr-3 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[color:var(--sf-hover-border)]"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-[#3F7BFF] to-[#2050E6] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(47,107,255,0.6)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Search
        </button>
      </form>

      {/* Source selector */}
      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-[color:var(--sf-hover-border)] bg-[var(--bg-card)] text-[var(--text-primary)]'
                  : 'border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* Results */}
      <div className="mt-6">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-secondary)]">
            <Loader2 size={18} className="animate-spin text-[var(--accent-emerald)]" />
            Ricerca in corso…
          </div>
        )}

        {/* Partial-failure notice: some sources responded, others didn't. */}
        {!loading && searched && failed.length > 0 && !allFailed && (
          <div className="mb-3 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-4 py-2.5 text-[12.5px] text-[var(--text-secondary)]">
            {rateLimited ? 'Rate limit reached for ' : 'Not reachable right now: '}
            {failed.map((s) => SOURCE_LABELS[s]).join(', ')}. Showing the other sources.
          </div>
        )}

        {!loading && allFailed && (
          <div className="glass rounded-2xl p-6 text-center text-sm text-[var(--text-secondary)]">
            {rateLimited
              ? 'Too many requests to the selected sources. Wait a few seconds and try again.'
              : 'Could not reach the selected sources right now. Try again shortly.'}
          </div>
        )}

        {!loading && !allFailed && searched && posts.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center">
            <Radar size={28} className="mx-auto text-[var(--text-muted)]" />
            <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">No mentions found</p>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              Nessun contenuto pubblico recente per “{term}”. Prova un altro termine o un'altra fonte.
            </p>
          </div>
        )}

        {!loading && posts.length > 0 && (
          <>
            <div className="mb-3 flex items-baseline gap-2 text-[13px] text-[var(--text-secondary)]">
              <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                {posts.length} mention{posts.length === 1 ? '' : 's'} found
              </span>
              <span className="text-[var(--text-muted)]">
                · {filter === 'all' ? 'across all sources' : `on ${SOURCE_LABELS[filter]}`}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {posts.map((p) => (
                <PostCard key={p.key} post={p} />
              ))}
            </div>
          </>
        )}

        {!searched && !loading && (
          <div className="glass rounded-2xl p-8 text-center">
            <Radar size={28} className="mx-auto text-[var(--text-muted)]" />
            <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">Inizia ad ascoltare</p>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              Search the project name or ticker to see who's talking about it on Bluesky, Nostr and Snapshot.
            </p>
          </div>
        )}
      </div>

      {/* Honest source caption */}
      <p className="mt-6 text-center font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
        Fonti: Bluesky · Nostr · Snapshot (protocolli aperti). Listening pubblico, €0, Farcaster/Lens/X in arrivo.
      </p>
    </div>
  )
}
