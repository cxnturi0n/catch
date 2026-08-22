import { useEffect, useMemo, useState } from 'react'
import { Globe2, Loader2, Users } from 'lucide-react'
import {
  SHIFT_LABELS,
  buildHeatmap,
  fetchActivityBuckets,
  type ActivityBucket,
} from '../../../lib/activityHeatmap'
import { useAuth } from '../../../context/AuthContext'
import { Card, EmptyState } from '../../ui/Card'
import { Badge } from '../../ui/Badge'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
/** X-axis reference ticks (also render a synthetic 24 mark at the right edge). */
const HOUR_TICKS = [0, 6, 12, 18]

/**
 * Honest region inference from the busiest UTC hours. This is a PROXY read of a
 * community's centre of gravity from *when* it talks — never declared demographics.
 * Bands are deliberately coarse and overlapping-aware so we never over-claim.
 */
function inferRegion(peakHour: number): string {
  if (peakHour >= 13 && peakHour <= 21) return 'sovrapposizione Europa / Americhe'
  if (peakHour >= 6 && peakHour < 13) return 'Europa / Africa / Medio Oriente'
  if (peakHour >= 0 && peakHour < 6) return 'Asia / Pacifico'
  return 'Americhe / Pacifico' // 22–23 UTC
}

/**
 * Audience panel for the Analytics Overview. Infers WHEN the community is active
 * (a proxy for timezone/geography) purely from the real activity heatmap Catch
 * already ingests — no new data source, no backend. Every number below is derived
 * from real message buckets; absent hours are genuine zeros.
 */
export function AudiencePanel({ workspaceId }: { workspaceId: string }) {
  const { user } = useAuth()
  const [buckets, setBuckets] = useState<ActivityBucket[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Guest mode: never touch the API, just render the explanatory empty state.
    if (!user) {
      setBuckets([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchActivityBuckets(workspaceId, 28)
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
  }, [workspaceId, user])

  const summary = useMemo(() => buildHeatmap(buckets ?? []), [buckets])

  // Fold the 7×24 matrix down to a single hour-of-day distribution (UTC).
  const byHour = useMemo(() => {
    const hours = Array.from({ length: 24 }, () => 0)
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let hour = 0; hour < 24; hour++) hours[hour] += summary.matrix[weekday][hour]
    }
    return hours
  }, [summary])

  const maxHour = useMemo(() => Math.max(0, ...byHour), [byHour])
  const peakHour = useMemo(() => byHour.indexOf(maxHour), [byHour, maxHour])

  // Shift split in canonical Morning/Afternoon/Night order (buildHeatmap sorts by size).
  const shifts = useMemo(
    () => SHIFT_LABELS.map((label) => summary.shiftTotals.find((s) => s.shift === label)!),
    [summary],
  )

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-card)] px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
            <Users size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">Audience — when the community is active</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Hourly distribution (UTC) · last 28 days
              {summary.partial && ` · storico parziale — ${summary.daysTracked} giorn${summary.daysTracked === 1 ? 'o' : 'i'}`}
            </p>
          </div>
        </div>
        {summary.hasData && <Badge tone="blue">{summary.total} messages</Badge>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--text-secondary)]">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : !summary.hasData ? (
        <div className="p-5">
          <EmptyState
            icon={<Globe2 size={20} />}
            title="No activity data yet"
            description="It fills in once the sync starts collecting messages. From then on we can see the hours (UTC) when the community talks the most."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-5">
          {/* 24-bar hour-of-day distribution — tallest bar highlighted. */}
          <div>
            <div className="flex h-32 items-end gap-[3px]">
              {HOURS.map((hour) => {
                const value = byHour[hour]
                const heightPct = maxHour > 0 ? (value / maxHour) * 100 : 0
                const isPeak = hour === peakHour && value > 0
                return (
                  <div
                    key={hour}
                    title={`${String(hour).padStart(2, '0')}:00 UTC · ${value} message${value === 1 ? '' : 's'}`}
                    className="group flex flex-1 items-end"
                    style={{ height: '100%' }}
                  >
                    <div
                      className="w-full rounded-t-[3px] transition-colors"
                      style={{
                        height: `${Math.max(heightPct, value > 0 ? 4 : 0)}%`,
                        backgroundImage: isPeak
                          ? 'linear-gradient(to top, #2050E6, #5B8CFF, #7EA6FF)'
                          : 'linear-gradient(to top, #1e3a8a, #2050E6, #3F7BFF)',
                        opacity: value > 0 ? 1 : 0.25,
                        boxShadow: isPeak ? '0 0 12px rgba(94,140,255,0.55)' : undefined,
                      }}
                    />
                  </div>
                )
              })}
            </div>
            {/* X-axis ticks: 00 / 06 / 12 / 18 / 24 */}
            <div className="mt-1.5 flex text-[10px] text-slate-500">
              {HOUR_TICKS.map((tick) => (
                <div key={tick} className="flex-1 text-left">
                  {String(tick).padStart(2, '0')}
                </div>
              ))}
              <div className="text-right">24</div>
            </div>
          </div>

          {/* Estimated region — an INFERENCE, clearly labelled as such. */}
          <div className="rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Globe2 size={14} className="text-[var(--accent-emerald-bright)]" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Regione stimata</h4>
            </div>
            <p className="mt-2 text-sm text-white">
              Picco alle{' '}
              <span className="font-mono tabular-nums font-semibold text-[var(--accent-emerald-bright)]">
                {String(peakHour).padStart(2, '0')}:00 UTC
              </span>{' '}
              → <span className="font-semibold">{inferRegion(peakHour)}</span>.
            </p>
            <p className="mt-1.5 text-xs text-[var(--text-muted)]">
              Estimated from activity patterns (UTC) — not self-reported demographics.
            </p>
          </div>

          {/* Shift split — reuses the honest shiftTotals from the heatmap. */}
          <div className="flex flex-col gap-1.5">
            {shifts.map((s) => (
              <div key={s.shift} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-xs text-[var(--text-secondary)]">{s.shift}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="gradient-bar-emerald h-full rounded-full" style={{ width: `${Math.max(s.share, s.messages > 0 ? 1 : 0)}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right font-mono tabular-nums text-xs text-white">
                  {s.messages} · {s.share.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
