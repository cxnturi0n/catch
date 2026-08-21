import { Fragment, useEffect, useMemo, useState } from 'react'
import { Activity, Clock, Loader2 } from 'lucide-react'
import {
  WEEKDAY_LABELS,
  buildHeatmap,
  fetchActivityBuckets,
  formatCellLabel,
  type ActivityBucket,
  type ActivityPlatform,
} from '../../../lib/activityHeatmap'
import { useWorkspace } from '../../../context/WorkspaceContext'
import { useAuth } from '../../../context/AuthContext'
import { Card, EmptyState } from '../../ui/Card'
import { Badge } from '../../ui/Badge'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const PLATFORM_LABELS: Record<ActivityPlatform, string> = { telegram: 'Telegram', discord: 'Discord' }

type PlatformFilter = 'all' | ActivityPlatform

/** Sapphire fill scaled to the busiest cell. Zero cells stay a bare surface. */
function cellStyle(value: number, max: number): { backgroundColor: string } {
  if (value <= 0 || max <= 0) return { backgroundColor: 'rgba(255,255,255,0.03)' }
  // Square-root ramp so quiet-but-real hours stay visible next to a big peak.
  const intensity = 0.12 + 0.88 * Math.sqrt(value / max)
  return { backgroundColor: `color-mix(in srgb, var(--accent-emerald) ${Math.round(intensity * 100)}%, transparent)` }
}

/**
 * Community activity heatmap (hour × weekday, UTC) shown alongside the shift
 * schedule so the CM can staff moderators where the traffic actually is.
 * Only real ingested data is rendered — never a synthetic cell.
 */
export function ActivityHeatmap() {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const [buckets, setBuckets] = useState<ActivityBucket[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<PlatformFilter>('all')

  useEffect(() => {
    // Guest mode: never touch Supabase, just render the explanatory state.
    if (!user) {
      setBuckets([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchActivityBuckets(activeWorkspaceId, 28)
      .then((rows) => {
        if (!cancelled) setBuckets(rows)
      })
      .catch(() => {
        if (!cancelled) setBuckets([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, user])

  // Platforms present across ALL data — drives which toggles are offered.
  const availablePlatforms = useMemo(() => {
    const set = new Set<ActivityPlatform>()
    for (const b of buckets ?? []) if (b.count > 0) set.add(b.platform)
    return [...set]
  }, [buckets])

  // Keep the filter valid if a platform disappears (workspace switch).
  useEffect(() => {
    if (filter !== 'all' && !availablePlatforms.includes(filter)) setFilter('all')
  }, [availablePlatforms, filter])

  const summary = useMemo(() => {
    const rows = (buckets ?? []).filter((b) => filter === 'all' || b.platform === filter)
    return buildHeatmap(rows)
  }, [buckets, filter])

  const hasAnyData = (buckets ?? []).some((b) => b.count > 0)
  const topShift = summary.shiftTotals[0]

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-card)] px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
            <Activity size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">Community activity · when people talk</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Last 28 days · all times UTC
              {summary.partial && ` · partial history — ${summary.daysTracked} day${summary.daysTracked === 1 ? '' : 's'} tracked`}
            </p>
          </div>
        </div>

        {/* Toggle appears only for platforms that actually contributed data. */}
        {availablePlatforms.length > 1 && (
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border-card)] p-1">
            {(['all', ...availablePlatforms] as PlatformFilter[]).map((p) => (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === p ? 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]' : 'text-slate-400 hover:text-white'
                }`}
              >
                {p === 'all' ? 'All' : PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--text-secondary)]">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : !hasAnyData ? (
        <div className="p-5">
          <EmptyState
            icon={<Clock size={20} />}
            title="No activity tracked yet"
            description={
              user
                ? 'Activity accrues from the moment ingestion is switched on: the Telegram webhook counts every new group message (Telegram exposes no history), and the Discord message sync fills forward from activation. Once either runs, this grid fills in on its own.'
                : 'Sign in and connect Telegram or Discord to start tracking when your community is active.'
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-5">
          {/* Heatmap grid — 7 weekday rows × 24 hour columns. */}
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[40px_repeat(24,1fr)] gap-[3px]">
                <div />
                {HOURS.map((h) => (
                  <div key={h} className="text-center text-[9px] text-slate-500">
                    {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                  </div>
                ))}
                {WEEKDAY_LABELS.map((day, weekday) => (
                  <Fragment key={day}>
                    <div className="flex items-center text-[10px] font-medium text-[var(--text-secondary)]">{day}</div>
                    {HOURS.map((hour) => {
                      const value = summary.matrix[weekday][hour]
                      return (
                        <div
                          key={`${weekday}-${hour}`}
                          title={`${formatCellLabel(weekday, hour)} UTC · ${value} message${value === 1 ? '' : 's'}`}
                          style={cellStyle(value, summary.max)}
                          className="h-6 rounded-[3px] border border-white/[0.04]"
                        />
                      )
                    })}
                  </Fragment>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-end gap-2 text-[10px] text-slate-500">
                <span>Quiet</span>
                {[0.05, 0.25, 0.5, 0.75, 1].map((step) => (
                  <span
                    key={step}
                    style={cellStyle(step * summary.max, summary.max)}
                    className="h-3 w-5 rounded-[2px] border border-white/[0.04]"
                  />
                ))}
                <span>Busiest ({summary.max})</span>
              </div>
            </div>
          </div>

          {/* Recommended coverage — actionable read of the same numbers. */}
          <div className="rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Recommended coverage</h4>
              <Badge tone="blue">{summary.total} messages tracked</Badge>
              {summary.partial && <Badge tone="yellow">Partial history — {summary.daysTracked}d</Badge>}
            </div>

            {topShift && topShift.messages > 0 && (
              <p className="mt-2 text-sm text-white">
                Staff the <span className="font-semibold text-[var(--accent-emerald-bright)]">{topShift.shift}</span> shift most
                heavily — it carries {topShift.share.toFixed(0)}% of all traffic.
              </p>
            )}

            <div className="mt-3 flex flex-col gap-1.5">
              {summary.shiftTotals.map((s) => (
                <div key={s.shift} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-xs text-[var(--text-secondary)]">{s.shift}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="gradient-bar-emerald h-full rounded-full" style={{ width: `${Math.max(s.share, 1)}%` }} />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs text-white">
                    {s.messages} · {s.share.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>

            {summary.peakHours.length > 0 && (
              <p className="mt-3 text-xs text-[var(--text-secondary)]">
                Busiest hours (UTC):{' '}
                {summary.peakHours.map((p, i) => (
                  <span key={`${p.weekday}-${p.hour}`}>
                    {i > 0 && ', '}
                    <span className="text-white">{formatCellLabel(p.weekday, p.hour)}</span> ({p.messages})
                  </span>
                ))}
                {' — make sure at least one moderator is online then.'}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
