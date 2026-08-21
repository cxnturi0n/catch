import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Search, ThumbsUp, Trophy, Zap } from 'lucide-react'
import { getLeaderboard } from '../../data/leaderboardData'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useToast } from '../../context/ToastContext'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { formatCompactNumber } from '../../lib/format'
import type { LeaderboardPlatform } from '../../types'

type Filter = 'All' | LeaderboardPlatform

const FILTERS: Filter[] = ['All', 'Discord', 'Telegram']

const PLATFORM_TONE = {
  Discord: 'purple',
  Telegram: 'cyan',
} as const

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-lg" title="1st">
        🥇
      </span>
    )
  if (rank === 2)
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-lg" title="2nd">
        🥈
      </span>
    )
  if (rank === 3)
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-lg" title="3rd">
        🥉
      </span>
    )
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center text-sm font-bold text-[var(--text-secondary)]">
      {rank}
    </span>
  )
}

export function Leaderboard() {
  const { activeWorkspaceId } = useWorkspace()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('All')
  const [search, setSearch] = useState('')

  const all = useMemo(() => getLeaderboard(activeWorkspaceId), [activeWorkspaceId])

  const visible = useMemo(() => {
    let list = filter === 'All' ? all : all.filter((m) => m.platform === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((m) => m.username.toLowerCase().includes(q))
    }
    return list
  }, [all, filter, search])

  function handlePromote(username: string) {
    showToast(`Open Moderators → Add Moderator and search for "${username}"`)
    navigate('/dashboard/moderators')
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-white">Community Leaderboard</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Top members by engagement score — identify candidates for your moderation team.
        </p>
      </div>

      {/* Score formula explainer */}
      <Card className="flex flex-wrap items-center gap-6 border-[var(--accent-purple)]/20 bg-[var(--accent-purple)]/[0.04] px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Score formula
        </span>
        <div className="flex flex-wrap gap-4 text-xs text-slate-300">
          <span className="flex items-center gap-1.5">
            <MessageSquare size={13} className="text-[var(--accent-cyan)]" />
            Messages × 1
          </span>
          <span className="flex items-center gap-1.5">
            <ThumbsUp size={13} className="text-[var(--accent-emerald)]" />
            Reactions × 3
          </span>
          <span className="flex items-center gap-1.5">
            <Zap size={13} className="text-yellow-400" />
            Days active × 2
          </span>
        </div>
        <span className="ml-auto text-xs text-[var(--text-secondary)]">
          Based on mock data — live data via Discord / Telegram bot
        </span>
      </Card>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-gradient-to-r from-[var(--accent-purple)] to-[var(--accent-cyan)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            type="text"
            placeholder="Search member…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] py-2 pl-9 pr-4 text-sm text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-purple)]"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        {/* Header row */}
        <div className="grid grid-cols-[40px_1fr_110px_100px_110px_90px_110px] items-center gap-3 border-b border-[var(--border-card)] px-5 py-3">
          <span />
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Member</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Platform</span>
          <span className="text-right text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Messages</span>
          <span className="text-right text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Reactions</span>
          <span className="text-right text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Days active</span>
          <span className="text-right text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Score</span>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Trophy size={32} className="text-[var(--text-secondary)]" />
            <p className="text-sm text-[var(--text-secondary)]">No members found</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--border-card)]">
            {visible.map((member) => {
              const globalRank = all.indexOf(member) + 1
              return (
                <div
                  key={member.id}
                  className={`grid grid-cols-[40px_1fr_110px_100px_110px_90px_110px] items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.02] ${
                    globalRank <= 3 ? 'bg-[var(--accent-purple)]/[0.025]' : ''
                  }`}
                >
                  <RankBadge rank={globalRank} />

                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-purple)] to-[var(--accent-cyan)] text-xs font-bold text-white">
                      {member.avatarInitials}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white">{member.username}</div>
                      <div className="text-xs text-[var(--text-secondary)]">
                        Joined {member.joinedDate}
                      </div>
                    </div>
                  </div>

                  <div>
                    <Badge tone={PLATFORM_TONE[member.platform]}>{member.platform}</Badge>
                  </div>

                  <div className="text-right text-sm text-white">
                    {formatCompactNumber(member.messagesCount)}
                  </div>
                  <div className="text-right text-sm text-white">
                    {formatCompactNumber(member.reactionsReceived)}
                  </div>
                  <div className="text-right text-sm text-white">{member.daysActive}d</div>

                  <div className="flex items-center justify-end gap-2">
                    <span className="text-sm font-semibold text-[var(--accent-emerald)]">
                      {formatCompactNumber(member.engagementScore)}
                    </span>
                    <button
                      onClick={() => handlePromote(member.username)}
                      title="Promote to moderator"
                      className="rounded-lg border border-[var(--border-card)] px-2 py-0.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-emerald)] hover:text-[var(--accent-emerald)]"
                    >
                      +Mod
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
