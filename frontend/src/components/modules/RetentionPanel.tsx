import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, Clock, Hourglass, RefreshCw, UserMinus, Users } from 'lucide-react'
import {
  computeRetentionSeries,
  computeTenureStats,
  fetchMembershipSnapshots,
  fetchTenure,
  MISSING_MEMBERS_INTENT,
  syncDiscordMembers,
  type MembershipSnapshotRow,
  type TenureRecord,
} from '../../lib/retention'
import { Card, EmptyState, Skeleton } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { StatCard } from '../ui/StatCard'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { formatCompactNumber, formatLongDate } from '../../lib/format'

const COHORT_LIMIT = 12

const INTENT_STEPS: ReactNode[] = [
  <>
    Open the{' '}
    <a
      href="https://discord.com/developers/applications"
      target="_blank"
      rel="noreferrer"
      className="font-medium text-[var(--accent-emerald-bright)] underline decoration-[var(--accent-emerald)]/40 underline-offset-2 transition-colors hover:text-white hover:decoration-[var(--accent-emerald)]"
    >
      Discord Developer Portal
    </a>
  </>,
  'Select the application whose bot you connected to Catch',
  'Go to the "Bot" tab → section "Privileged Gateway Intents"',
  'Turn ON "Server Members Intent" and save the changes',
  'Come back here and click "Sync members"',
]

/**
 * A missing table surfaces as raw "Could not find the table … in the
 * schema cache" text — useless to the user. Treat those as "no data yet" so the
 * panel shows the friendly setup steps instead of the internal error string.
 */
function friendlyLoadError(message: string | null): string | null {
  if (!message) return null
  if (/could not find the table|schema cache|does not exist|relation .* does not exist/i.test(message)) return null
  return message
}

/** "just now" / "12m ago" / "5h ago" / "Mar 4, 2026" — sync freshness matters in minutes here. */
function formatSyncTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diffMs)) return '—'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatLongDate(iso)
}

function formatDays(days: number | null): string {
  if (days === null) return '—'
  if (days < 1) return '< 1 day'
  if (days < 60) return `${Math.round(days)} days`
  const months = days / 30.44
  if (months < 24) return `${months.toFixed(1)} mo`
  return `${(days / 365.25).toFixed(1)} yr`
}

function BucketTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; payload: { pct: number } }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null
  return (
    <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 text-[var(--text-secondary)]">{label}</div>
      <div className="font-semibold text-white">
        {formatCompactNumber(payload[0].value)} members · {payload[0].payload.pct}%
      </div>
    </div>
  )
}

function SnapshotTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; payload: { joined: number; left: number } }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null
  const point = payload[0].payload
  return (
    <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 text-[var(--text-secondary)]">{formatLongDate(label)}</div>
      <div className="font-semibold text-white">{formatCompactNumber(payload[0].value)} members</div>
      <div className="text-[var(--text-secondary)]">
        +{point.joined} joined · −{point.left} left
      </div>
    </div>
  )
}

/**
 * Member tenure & retention for Discord — "how long do people stay?".
 *
 * Every number comes from `discord_member_tenure` / `discord_membership_snapshots`,
 * both written by the discord-members-sync edge function. Nothing is estimated:
 * when there is no data the panel shows the setup steps instead of numbers.
 */
export function RetentionPanel({ workspaceId }: { workspaceId: string }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [tenure, setTenure] = useState<TenureRecord[] | null>(null)
  const [snapshots, setSnapshots] = useState<MembershipSnapshotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [missingIntent, setMissingIntent] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Guest-safe: signed-out users never hit the API from here.
  const canQuery = Boolean(user && workspaceId)

  const load = useCallback(async () => {
    if (!canQuery) {
      setTenure(null)
      setSnapshots([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [rows, snaps] = await Promise.all([fetchTenure(workspaceId), fetchMembershipSnapshots(workspaceId, 180)])
      setTenure(rows)
      setSnapshots(snaps)
      setLoadError(null)
    } catch (err) {
      setTenure(null)
      setSnapshots([])
      setLoadError(err instanceof Error ? err.message : 'Could not read tenure data.')
    } finally {
      setLoading(false)
    }
  }, [canQuery, workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSync() {
    if (!canQuery) return
    setSyncing(true)
    try {
      const result = await syncDiscordMembers(workspaceId)
      if (!result.success) {
        if (result.error === MISSING_MEMBERS_INTENT) {
          setMissingIntent(true)
          showToast('Discord blocked the member list — enable the Server Members Intent.', 'error')
        } else {
          showToast(result.error ?? 'Members sync failed.', 'error')
        }
        return
      }
      setMissingIntent(false)
      const left = result.left ?? 0
      showToast(
        `Synced ${formatCompactNumber(result.total ?? 0)} members · ${result.new ?? 0} new${left > 0 ? ` · ${left} left` : ''}`,
      )
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Members sync failed.', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const stats = useMemo(() => computeTenureStats(tenure ?? []), [tenure])
  const retention = useMemo(() => computeRetentionSeries(snapshots), [snapshots])

  const bucketData = useMemo(
    () => stats.buckets.map((b) => ({ label: b.label, count: b.count, pct: b.pct })),
    [stats.buckets],
  )
  const cohorts = useMemo(() => stats.cohorts.slice(0, COHORT_LIMIT), [stats.cohorts])
  const snapshotData = useMemo(
    () => retention.points.map((p) => ({ date: p.date, total: p.total, joined: p.joined, left: p.left })),
    [retention.points],
  )

  const syncButton = (
    <Button onClick={handleSync} loading={syncing} disabled={!canQuery} className="flex items-center gap-2 !px-3 !py-1.5 text-xs">
      <RefreshCw size={13} />
      Sync members
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Hourglass size={18} className="text-[var(--text-secondary)]" />
          <h2 className="text-base font-semibold text-white">Member Tenure &amp; Retention</h2>
          <Badge tone="blue" dot={false}>
            Discord
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          {stats.lastSyncAt && (
            <span className="text-xs text-[var(--text-secondary)]">Last sync {formatSyncTime(stats.lastSyncAt)}</span>
          )}
          {syncButton}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[118px] rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-[280px] rounded-2xl" />
        </div>
      ) : !stats.hasData ? (
        <Card className="p-1">
          <EmptyState
            icon={missingIntent ? <AlertTriangle size={22} /> : <Users size={22} />}
            title={missingIntent ? 'Discord is blocking the member list' : 'No member tenure data yet'}
            description={
              missingIntent
                ? 'Reading join dates needs the Server Members privileged intent. It is a switch in your own Discord application — no Discord approval is required while your bot is in fewer than 100 servers.'
                : friendlyLoadError(loadError) ??
                  'Run a member sync to read every current member’s join date from Discord. Nothing is shown until real data exists.'
            }
            action={
              <div className="flex w-full max-w-md flex-col items-center gap-4">
                <ol className="w-full space-y-2 text-left">
                  {INTENT_STEPS.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm text-slate-300">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-emerald)]/20 text-xs font-bold text-[var(--accent-emerald-bright)]">
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
                {syncButton}
              </div>
            }
            className="border-none"
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Median tenure"
              value={formatDays(stats.medianDays)}
              delta={null}
              icon={<Hourglass size={18} />}
              deltaTooltip="Half of the current members have been in the server longer than this."
            />
            <StatCard
              label="Members over 90 days"
              value={stats.retained90Pct === null ? '—' : `${stats.retained90Pct}%`}
              delta={null}
              icon={<Clock size={18} />}
              deltaTooltip={`${stats.retained30Pct ?? '—'}% over 30 days · ${stats.retained180Pct ?? '—'}% over 180 days`}
            />
            <StatCard
              label="Members tracked"
              value={formatCompactNumber(stats.currentMembers)}
              delta={null}
              icon={<Users size={18} />}
              deltaTooltip={`${stats.trackedMembers} rows stored in total (current members + ${stats.departedObserved} observed departures)`}
            />
            <StatCard
              label="Departures observed"
              value={formatCompactNumber(stats.departedObserved)}
              delta={null}
              icon={<UserMinus size={18} />}
              deltaTooltip={
                stats.trackingSince
                  ? `People we have watched leave since tracking started on ${formatLongDate(stats.trackingSince)}`
                  : 'People we have watched leave since tracking started'
              }
            />
          </div>

          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Tenure distribution</h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  {formatCompactNumber(stats.currentMembers)} current members by time spent in the server
                  {stats.missingJoinDate > 0 ? ` · ${stats.missingJoinDate} without a join date` : ''}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white">{formatDays(stats.averageDays)}</div>
                <div className="text-xs text-[var(--text-secondary)]">average tenure</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={bucketData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="tenureBarSapphire" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6db3ff" />
                    <stop offset="55%" stopColor="#2f7cf6" />
                    <stop offset="100%" stopColor="#1e3a8a" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
                <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} tickFormatter={formatCompactNumber} width={48} />
                <Tooltip content={<BucketTooltip />} cursor={{ fill: 'rgba(120,170,255,0.10)', radius: 4 }} />
                <Bar dataKey="count" fill="url(#tenureBarSapphire)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white">Join cohorts</h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Members grouped by the month they joined
                {stats.hasDepartureEvidence
                  ? ' · "still in" is measured against the latest sync'
                  : ' · no departure observed yet, so every tracked member still counts as present'}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-card)] text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                    <th className="pb-2 font-medium">Cohort</th>
                    <th className="pb-2 text-right font-medium">Joined</th>
                    <th className="pb-2 text-right font-medium">Still in</th>
                    <th className="pb-2 text-right font-medium">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((c) => (
                    <tr key={c.month} className="border-b border-[var(--border-card)]/60 last:border-none">
                      <td className="py-2.5 text-slate-300">
                        <span className="text-white">{c.label}</span>
                        {c.survivorsOnly && (
                          <span
                            title="This month is older than our first sync: only the people from it who were still present when tracking began are visible."
                            className="ml-2 rounded-full border border-[var(--border-card)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500"
                          >
                            survivors only
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right text-slate-300">{formatCompactNumber(c.joined)}</td>
                      <td className="py-2.5 text-right text-slate-300">{formatCompactNumber(c.stillPresent)}</td>
                      <td className="py-2.5 text-right font-medium text-white">
                        {c.retentionPct === null ? '—' : `${c.retentionPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {retention.hasData ? (
            <Card className="p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Membership over syncs</h3>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {retention.points.length} sync runs · +{retention.totalJoined} joined · −{retention.totalLeft} left
                    {retention.avgChurnPct !== null ? ` · avg churn ${retention.avgChurnPct}% per sync` : ''}
                  </p>
                </div>
                {retention.netChange !== null && (
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${retention.netChange >= 0 ? 'text-white' : 'text-red-400'}`}>
                      {retention.netChange >= 0 ? '+' : '−'}
                      {formatCompactNumber(Math.abs(retention.netChange))}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">net since first sync</div>
                  </div>
                )}
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={snapshotData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="retentionFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4d9fff" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#4d9fff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatLongDate}
                    stroke="var(--text-secondary)"
                    tick={{ fontSize: 11 }}
                    minTickGap={30}
                  />
                  <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} tickFormatter={formatCompactNumber} width={48} />
                  <Tooltip content={<SnapshotTooltip />} cursor={{ stroke: 'rgba(120,170,255,0.35)', strokeWidth: 1 }} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="#4d9fff"
                    strokeWidth={2.5}
                    fill="url(#retentionFill)"
                    dot={snapshotData.length <= 2}
                    activeDot={{ r: 4, fill: '#4d9fff' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          ) : (
            <Card className="flex items-start gap-3 p-4">
              <Clock size={16} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" />
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                <span className="text-slate-300">Churn chart not available yet.</span> It needs at least two member syncs:
                the second run is the first time we can see who disappeared. Run &ldquo;Sync members&rdquo; regularly (or schedule
                it) and this chart builds itself going forward.
              </p>
            </Card>
          )}

          {/* Honest limitations — stated in the UI, not hidden in a doc. */}
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle size={14} className="text-[var(--text-secondary)]" />
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                How to read these numbers
              </span>
            </div>
            <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
              <li>
                • Tenure is measured on <span className="text-slate-300">members currently in the server</span>. Discord does not
                return people who already left, so anyone who joined and left before we started tracking is not counted.
              </li>
              <li>
                • Because of that, the distribution and the median describe <span className="text-slate-300">survivors</span>, and
                cohorts older than our first sync ({stats.trackingSince ? formatLongDate(stats.trackingSince) : 'first sync'}) are
                marked &ldquo;survivors only&rdquo;.
              </li>
              <li>
                • Real churn is built by <span className="text-slate-300">comparing syncs over time</span>: each run stamps the
                members still present, and anyone who stops appearing is counted as a departure ({stats.departedObserved} so far).
              </li>
              <li>• Bots are excluded. Members without a join date from the API are excluded from the tenure math.</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
