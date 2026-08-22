import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Search, Trophy } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useToast } from '../../context/ToastContext'
import { Card, EmptyState } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { formatCompactNumber } from '../../lib/format'
import { api } from '../../lib/api/client'
import { initials } from '../../data/moderatorsData'

// Community leaderboard on REAL per-member message counts (Telegram via the
// webhook, Discord via the channel poller). Reactions and "days active" are
// not measurable from the connected sources, so they are not shown.

type Platform = 'telegram' | 'discord'
interface Row {
  memberRef: string
  displayName: string
  platform: Platform
  messages: number
}
const PLATFORM_LABEL: Record<Platform, string> = { telegram: 'Telegram', discord: 'Discord' }
const PLATFORM_TONE = { telegram: 'cyan', discord: 'purple' } as const
const WINDOW_DAYS = 30

function RankBadge({ rank }: { rank: number }) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
  return medal ? (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center text-lg">{medal}</span>
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center text-sm font-bold text-[var(--text-secondary)]">{rank}</span>
  )
}

export function Leaderboard() {
  const { activeWorkspaceId, getWorkspaceIntegrations } = useWorkspace()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<'All' | Platform>('All')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const integrations = getWorkspaceIntegrations(activeWorkspaceId)
  const connected = (['telegram', 'discord'] as Platform[]).filter((p) => integrations[p].status === 'Connected')

  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    setLoading(true)
    Promise.all(
      connected.map((platform) =>
        api<{ members: Array<{ memberRef: string; displayName: string | null; messages: number }> }>(`/workspaces/${activeWorkspaceId}/metrics/member-messages?days=${WINDOW_DAYS}&platform=${platform}`)
          .then((r) => r.members.map((m) => ({ memberRef: m.memberRef, displayName: m.displayName ?? m.memberRef, platform, messages: m.messages })))
          .catch(() => [] as Row[]),
      ),
    ).then((lists) => {
      if (cancelled) return
      setRows(lists.flat().sort((a, b) => b.messages - a.messages))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, connected.join(',')])

  const visible = useMemo(() => {
    let list = filter === 'All' ? rows : rows.filter((m) => m.platform === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((m) => m.displayName.toLowerCase().includes(q))
    }
    return list.slice(0, 100)
  }, [rows, filter, search])

  function handlePromote(username: string) {
    showToast(`Open Moderators → Add Moderator and search for "${username}"`)
    navigate('/dashboard/moderators')
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-white">Community Leaderboard</h1>
        <p className="text-sm text-[var(--text-secondary)]">Most active members over the last {WINDOW_DAYS} days, by messages counted on your connected platforms.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-[var(--border-card)] p-1">
          {(['All', 'telegram', 'discord'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${filter === f ? 'bg-[var(--surface-2)] text-white' : 'text-[var(--text-secondary)] hover:text-white'}`}>
              {f === 'All' ? 'All' : PLATFORM_LABEL[f]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-[var(--border-card)] px-3 py-1.5 text-sm">
          <Search size={14} className="text-[var(--text-secondary)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search members" className="bg-transparent text-white outline-none placeholder:text-[var(--text-muted)]" />
        </label>
      </div>

      {connected.length === 0 ? (
        <EmptyState icon={<Trophy size={28} />} title="No message source connected" description="Connect Telegram or Discord in Integrations to rank members by real activity." />
      ) : loading ? (
        <div className="text-sm text-[var(--text-secondary)]">Loading…</div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<MessageSquare size={28} />} title="No activity recorded yet" description="Counting starts from the moment the platform is connected; check back after some activity." />
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3 text-right">Messages</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((m, i) => (
                <tr key={`${m.platform}:${m.memberRef}`} className="border-t border-[var(--border-card)]">
                  <td className="px-4 py-2">
                    <RankBadge rank={i + 1} />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-white">{initials(m.displayName)}</div>
                      <div className="truncate text-sm font-medium text-white">{m.displayName}</div>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={PLATFORM_TONE[m.platform]}>{PLATFORM_LABEL[m.platform]}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right text-white">{formatCompactNumber(m.messages)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handlePromote(m.displayName)} className="text-xs text-[var(--accent-emerald-bright)] hover:underline">
                      Promote
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
