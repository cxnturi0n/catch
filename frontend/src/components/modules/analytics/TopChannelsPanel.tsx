import { useEffect, useState } from 'react'
import { Hash, Loader2 } from 'lucide-react'
import { fetchChannelActivity, type ChannelActivityRow } from '../../../lib/api/metrics'
import { useAuth } from '../../../context/AuthContext'
import { useRealtimeTables } from '../../../hooks/useRealtimeTables'
import { Card, EmptyState } from '../../ui/Card'
import { Badge } from '../../ui/Badge'
import { formatRelativeTime } from '../../../lib/format'

const TABLES = ['channel_activity', 'platform_channels', 'platform_messages'] as const
const PLATFORM_LABEL: Record<string, string> = { discord: 'Discord', telegram: 'Telegram' }

/**
 * Busiest channels (or Telegram topics) over the last 30 days. Volume comes
 * from the daily per channel rollup, "people" from the stored messages of
 * the same window. Real data only: nothing shows until a collector wrote rows.
 */
export function TopChannelsPanel({ workspaceId }: { workspaceId: string }) {
  const { user } = useAuth()
  const [rows, setRows] = useState<ChannelActivityRow[] | null>(null)
  const [tick, setTick] = useState(0)
  useRealtimeTables(workspaceId, TABLES, () => setTick((t) => t + 1))

  useEffect(() => {
    if (!user) {
      setRows([])
      return
    }
    let cancelled = false
    fetchChannelActivity(workspaceId, 30)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setRows([]))
    return () => {
      cancelled = true
    }
  }, [workspaceId, user, tick])

  const max = Math.max(1, ...(rows ?? []).map((r) => r.messages))

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash size={16} className="text-[var(--accent-emerald)]" />
          <h3 className="text-sm font-semibold text-white">Top channels</h3>
        </div>
        <span className="text-xs text-[var(--text-secondary)]">last 30 days</span>
      </div>
      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Loader2 size={14} className="animate-spin" /> Loading channels
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No channel activity yet" description="Channels appear as soon as messages are collected from Discord or Telegram." />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.slice(0, 10).map((r) => (
            <li key={`${r.platform}:${r.channelId}`} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={r.platform === 'discord' ? 'indigo' : 'cyan'}>{PLATFORM_LABEL[r.platform] ?? r.platform}</Badge>
                  <span className="truncate text-white">{r.name ? `#${r.name}` : r.type === 'topic' ? `Topic ${r.channelId}` : r.channelId}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-[var(--text-secondary)]">
                  <span>
                    <span className="font-medium text-white">{new Intl.NumberFormat('en-US').format(r.messages)}</span> messages
                  </span>
                  <span>
                    <span className="font-medium text-white">{r.activeMembers}</span> people
                  </span>
                  {r.lastMessageAt && <span className="hidden sm:inline">{formatRelativeTime(r.lastMessageAt)}</span>}
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
                <div className="h-full rounded-full bg-[var(--accent-emerald)]/70" style={{ width: `${Math.max(3, Math.round((r.messages / max) * 100))}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
