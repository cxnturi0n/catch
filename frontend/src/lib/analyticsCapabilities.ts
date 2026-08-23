// ── Analytics capability matrix ─────────────────────────────────────────────
// The single, honest source of truth for what the Analytics module is allowed
// to offer. Every (platform × metric × window) combination the UI shows MUST be
// declared here AND actually be backed by data we currently hold. Nothing is
// synthesised: the dropdowns are driven off this matrix intersected with the
// data really fetched from the API (or the imported X CSV).
//
// Data sources:
//   snapshot-delta      → platform_metric_snapshots (hourly rows) → value now − value N hours ago
//   daily-rollup        → platform_metrics (one row/day, metrics jsonb)
//   member-messages     → member_messages (Telegram, DAILY granularity)
//   membership-snapshot → discord_membership_snapshots (one row per members-sync run)
//   member-tenure       → discord_member_tenure (one row per member, joined_at + last_seen)
//   csv                 → manually imported X/Twitter analytics CSV (localStorage)

import type { MetricSnapshot, PlatformMetricDay } from './db'
import type { MembershipSnapshotRow, TenureRecord } from './retention'
import type { TrendPoint, XAnalyticsData } from '../types'

export type AnalyticsWindow = '1h' | '5h' | '24h' | '7d' | '30d'
export type AnalyticsPlatformId = 'aggregated' | 'discord' | 'telegram' | 'galxe' | 'zealy' | 'twitter'
export type DataSource = 'snapshot-delta' | 'daily-rollup' | 'member-messages' | 'membership-snapshot' | 'member-tenure' | 'csv'

export interface WindowMeta {
  label: string
  /** Lookback size in hours (used to slice snapshots / days). */
  hours: number
  /** True when the value shown is a DELTA (now − N hours ago) rather than a level. */
  isDelta: boolean
}

export const WINDOW_META: Record<AnalyticsWindow, WindowMeta> = {
  '1h': { label: 'Last hour', hours: 1, isDelta: true },
  '5h': { label: 'Last 5 hours', hours: 5, isDelta: true },
  '24h': { label: 'Last 24 hours', hours: 24, isDelta: false },
  '7d': { label: 'Last 7 days', hours: 24 * 7, isDelta: false },
  '30d': { label: 'Last 30 days', hours: 24 * 30, isDelta: false },
}

export interface MetricCapability {
  platform: AnalyticsPlatformId
  /** Stable id, unique within a platform. */
  metric: string
  /** Key inside the metrics jsonb / snapshot. Empty for member-messages & csv. */
  metricKey: string
  label: string
  windows: AnalyticsWindow[]
  color: string
  suffix?: string
  /** Discord's member count is approximate, surface an honest "≈" marker. */
  approx?: boolean
  /** Which data source backs a given window. */
  source: (w: AnalyticsWindow) => DataSource
}

const ALL_WINDOWS: AnalyticsWindow[] = ['1h', '5h', '24h', '7d', '30d']

/** Standard rule: sub-day windows come from snapshot deltas, 24h+ from the daily rollup. */
const deltaOrDaily = (w: AnalyticsWindow): DataSource => (w === '1h' || w === '5h' ? 'snapshot-delta' : 'daily-rollup')

// The matrix. Order matters for "first valid option" fallbacks.
export const CAPABILITY_MATRIX: MetricCapability[] = [
  // Aggregated (only meaningful with ≥2 connected platforms), members summed across platforms.
  { platform: 'aggregated', metric: 'members', metricKey: 'members', label: 'Members (all platforms)', windows: ALL_WINDOWS, color: '#2f7cf6', source: deltaOrDaily },

  // Discord
  { platform: 'discord', metric: 'members', metricKey: 'members', label: 'Members', windows: ALL_WINDOWS, color: '#2f7cf6', approx: true, source: deltaOrDaily },
  { platform: 'discord', metric: 'bans', metricKey: 'bans_7d', label: 'Bans (7d)', windows: ['7d'], color: '#1e3a8a', source: () => 'daily-rollup' },

  // Discord, member tenure & retention (fed by the discord-members-sync run).
  // These are SNAPSHOT / COHORT measures: one data point per sync run, or a count
  // grouped by join DATE. They are deliberately NOT offered on the 1h/5h windows, // there is no hourly delta behind them, so claiming one would be a fabrication.
  // The full distribution / median / cohort table lives in RetentionPanel; these
  // entries only expose the parts that are genuinely a time series.
  { platform: 'discord', metric: 'tracked_members', metricKey: 'total_members', label: 'Members tracked (tenure sync)', windows: ['24h', '7d', '30d'], color: '#4d9fff', source: () => 'membership-snapshot' },
  { platform: 'discord', metric: 'members_left', metricKey: 'left_members', label: 'Members left (per sync)', windows: ['7d', '30d'], color: '#1e3a8a', source: () => 'membership-snapshot' },
  { platform: 'discord', metric: 'joins_retained', metricKey: '', label: 'Joins still in server (by join date)', windows: ['24h', '7d', '30d'], color: '#6db3ff', source: () => 'member-tenure' },

  // Telegram
  { platform: 'telegram', metric: 'members', metricKey: 'members', label: 'Members', windows: ALL_WINDOWS, color: '#2f7cf6', source: deltaOrDaily },
  { platform: 'telegram', metric: 'messages', metricKey: '', label: 'Messages', windows: ['24h', '7d', '30d'], color: '#6db3ff', source: () => 'member-messages' },

  // Galxe
  { platform: 'galxe', metric: 'followers', metricKey: 'followers', label: 'Followers', windows: ALL_WINDOWS, color: '#4d9fff', source: deltaOrDaily },
  { platform: 'galxe', metric: 'participants', metricKey: 'participants', label: 'Participants', windows: ALL_WINDOWS, color: '#6db3ff', source: deltaOrDaily },
  { platform: 'galxe', metric: 'campaigns', metricKey: 'campaigns', label: 'Campaigns', windows: ALL_WINDOWS, color: '#8cc5ff', source: deltaOrDaily },

  // Zealy
  { platform: 'zealy', metric: 'members', metricKey: 'members', label: 'Members', windows: ALL_WINDOWS, color: '#2f7cf6', source: deltaOrDaily },
  { platform: 'zealy', metric: 'total_xp', metricKey: 'total_xp', label: 'Total XP', windows: ALL_WINDOWS, color: '#4d9fff', source: deltaOrDaily },

  // Twitter / X, CSV only; window = the imported CSV period. Rendered by the
  // dedicated XAnalyticsSection, NOT by the dynamic dropdowns (X is never a
  // "Connected" live integration), so windows is intentionally empty here.
  { platform: 'twitter', metric: 'impressions', metricKey: 'impressions', label: 'Impressions', windows: [], color: '#1e3a8a', source: () => 'csv' },
  { platform: 'twitter', metric: 'engagements', metricKey: 'engagements', label: 'Engagements', windows: [], color: '#2f7cf6', source: () => 'csv' },
  { platform: 'twitter', metric: 'likes', metricKey: 'likes', label: 'Likes', windows: [], color: '#4d9fff', source: () => 'csv' },
  { platform: 'twitter', metric: 'retweets', metricKey: 'retweets', label: 'Retweets', windows: [], color: '#6db3ff', source: () => 'csv' },
]

/** Platforms that participate in the live/dynamic dropdowns (excludes twitter). */
const LIVE_PLATFORM_ORDER: AnalyticsPlatformId[] = ['aggregated', 'discord', 'telegram', 'galxe', 'zealy']

export function platformLabel(platform: AnalyticsPlatformId): string {
  switch (platform) {
    case 'aggregated':
      return 'Aggregated'
    case 'discord':
      return 'Discord'
    case 'telegram':
      return 'Telegram'
    case 'galxe':
      return 'Galxe'
    case 'zealy':
      return 'Zealy'
    case 'twitter':
      return 'Twitter / X'
  }
}

export function getCapability(platform: AnalyticsPlatformId, metric: string): MetricCapability | undefined {
  return CAPABILITY_MATRIX.find((c) => c.platform === platform && c.metric === metric)
}

export function platformCapabilities(platform: AnalyticsPlatformId): MetricCapability[] {
  return CAPABILITY_MATRIX.filter((c) => c.platform === platform)
}

// ── Runtime dataset ─────────────────────────────────────────────────────────
// A snapshot of everything the component fetched from real sources. All
// availability decisions below are pure functions of this bundle.

export interface AnalyticsDataset {
  /** Real connected live platforms (e.g. ['discord','telegram']). Excludes twitter/aggregated. */
  connected: AnalyticsPlatformId[]
  /** Raw daily rollup rows (all connected platforms, up to 30d). */
  daily: PlatformMetricDay[]
  /** Recent hourly snapshots (all platforms, last few hours). */
  snapshots: MetricSnapshot[]
  /** Telegram daily message totals (member_messages rolled up per day). */
  memberMessages: TrendPoint[]
  /** Imported X/Twitter CSV, if any. */
  x: XAnalyticsData | null
  /**
   * Discord member tenure rows (one per member ever seen). Optional: a caller
   * that never fetched them simply leaves the tenure metrics unavailable, * fail-safe, never a metric backed by nothing.
   */
  tenure?: TenureRecord[]
  /** Discord membership snapshots, one row per discord-members-sync run. */
  membershipSnapshots?: MembershipSnapshotRow[]
}

function platformsFor(cap: MetricCapability, ds: AnalyticsDataset): string[] {
  // 'aggregated' fans out across every connected live platform.
  if (cap.platform === 'aggregated') return ds.connected.filter((p) => p !== 'aggregated')
  return [cap.platform]
}

/** All daily rows for the metric within the last `days` days (already sorted). */
function dailySeries(ds: AnalyticsDataset, platforms: string[], key: string, days: number): TrendPoint[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const byDate = new Map<string, number>()
  for (const r of ds.daily) {
    if (!platforms.includes(r.platform)) continue
    if (r.date < cutoff) continue
    const v = r.metrics[key]
    if (typeof v !== 'number') continue
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + v)
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }))
}

/** Snapshot series (forward-filling each platform's last value, then summing). */
function snapshotSeries(ds: AnalyticsDataset, platforms: string[], key: string, hours: number): TrendPoint[] {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
  const rows = ds.snapshots
    .filter((s) => platforms.includes(s.platform) && typeof s.metrics[key] === 'number' && s.capturedAt >= cutoff)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  const last: Record<string, number> = {}
  const out: TrendPoint[] = []
  for (const r of rows) {
    last[r.platform] = r.metrics[key]
    const sum = Object.values(last).reduce((s, v) => s + v, 0)
    out.push({ date: r.capturedAt, value: sum })
  }
  return out
}

/** Membership-snapshot series (one point per sync run) within the window. */
function membershipSeries(ds: AnalyticsDataset, key: string, hours: number): TrendPoint[] {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
  const rows = (ds.membershipSnapshots ?? []).filter((s) => s.capturedAt >= cutoff)
  return rows
    .slice()
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .map((s) => ({
      date: s.capturedAt,
      value: key === 'left_members' ? s.leftMembers : key === 'new_members' ? s.newMembers : s.totalMembers,
    }))
}

/**
 * Members STILL in the server grouped by the day they joined, within the window.
 * Real data (joined_at of current members), but by construction it can only
 * contain people who have not left, which is why the label says so.
 */
function tenureJoinSeries(ds: AnalyticsDataset, days: number): TrendPoint[] {
  const rows = ds.tenure ?? []
  // A sync run stamps every member it saw with the same last_seen, so "still in
  // the server" = last_seen belongs to the most recent run (small slack allowed).
  let latestRun = ''
  for (const r of rows) if (r.lastSeen > latestRun) latestRun = r.lastSeen
  const presentCutoff = latestRun ? new Date(new Date(latestRun).getTime() - 5 * 60_000).toISOString() : ''
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const byDate = new Map<string, number>()
  for (const r of rows) {
    if (!r.joinedAt) continue
    if (r.lastSeen < presentCutoff) continue // already left, not a retained join
    const day = r.joinedAt.slice(0, 10)
    if (day < cutoff) continue
    byDate.set(day, (byDate.get(day) ?? 0) + 1)
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }))
}

/** True when a metric has ANY backing data right now (used to hide empty metrics). */
export function metricHasData(cap: MetricCapability, ds: AnalyticsDataset): boolean {
  if (cap.metricKey === '' && cap.source('24h') === 'member-messages') return ds.memberMessages.length > 0
  if (cap.source('24h') === 'membership-snapshot') return (ds.membershipSnapshots?.length ?? 0) > 0
  if (cap.source('24h') === 'member-tenure') return (ds.tenure ?? []).some((r) => r.joinedAt !== null)
  if (cap.source('24h') === 'csv' || cap.windows.length === 0) return ds.x !== null
  const platforms = platformsFor(cap, ds)
  if (platforms.length === 0) return false
  const inDaily = ds.daily.some((r) => platforms.includes(r.platform) && typeof r.metrics[cap.metricKey] === 'number')
  const inSnap = ds.snapshots.some((s) => platforms.includes(s.platform) && typeof s.metrics[cap.metricKey] === 'number')
  return inDaily || inSnap
}

/** Connected platforms to offer in the Platform dropdown (only those with data). */
export function availablePlatforms(ds: AnalyticsDataset): AnalyticsPlatformId[] {
  const out: AnalyticsPlatformId[] = []
  for (const p of LIVE_PLATFORM_ORDER) {
    if (p === 'aggregated') {
      // Only when ≥2 connected platforms actually expose a matrix metric with data.
      if (ds.connected.length >= 2 && platformCapabilities('aggregated').some((c) => metricHasData(c, ds))) out.push(p)
      continue
    }
    if (!ds.connected.includes(p)) continue
    if (platformCapabilities(p).some((c) => metricHasData(c, ds))) out.push(p)
  }
  return out
}

/** Metrics for a platform that actually have data right now.
 * `windows.length === 0` means the metric is rendered by a dedicated section
 * (X CSV, tenure distribution) and must never reach the windowed dropdowns. */
export function availableMetrics(platform: AnalyticsPlatformId, ds: AnalyticsDataset): MetricCapability[] {
  return platformCapabilities(platform).filter((c) => c.windows.length > 0 && metricHasData(c, ds))
}

export interface WindowOption {
  window: AnalyticsWindow
  enabled: boolean
  /** Tooltip when disabled, e.g. "not enough history yet". */
  hint?: string
}

/** Windows a metric supports AND that have enough data to be meaningful. */
export function availableWindows(cap: MetricCapability, ds: AnalyticsDataset): WindowOption[] {
  return cap.windows.map((w) => {
    const meta = WINDOW_META[w]
    const source = cap.source(w)
    if (source === 'snapshot-delta') {
      // Need ≥2 snapshots inside the window to compute an honest delta.
      const pts = snapshotSeries(ds, platformsFor(cap, ds), cap.metricKey, meta.hours)
      return pts.length >= 2
        ? { window: w, enabled: true }
        : { window: w, enabled: false, hint: 'not enough history yet' }
    }
    if (source === 'member-messages') {
      const days = Math.max(1, Math.round(meta.hours / 24))
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
      const has = ds.memberMessages.some((p) => p.date >= cutoff)
      return has ? { window: w, enabled: true } : { window: w, enabled: false, hint: 'not enough history yet' }
    }
    if (source === 'membership-snapshot') {
      // One point per sync run: a single run is already a real value to plot.
      const pts = membershipSeries(ds, cap.metricKey, meta.hours)
      return pts.length >= 1 ? { window: w, enabled: true } : { window: w, enabled: false, hint: 'sync members first' }
    }
    if (source === 'member-tenure') {
      const days = w === '24h' ? 2 : Math.max(1, Math.round(meta.hours / 24))
      const pts = tenureJoinSeries(ds, days)
      return pts.length >= 1 ? { window: w, enabled: true } : { window: w, enabled: false, hint: 'no joins in this window' }
    }
    if (source === 'csv') {
      return ds.x ? { window: w, enabled: true } : { window: w, enabled: false, hint: 'import a CSV first' }
    }
    // daily-rollup: need ≥1 daily point in range.
    const days = w === '24h' ? 2 : Math.max(1, Math.round(meta.hours / 24))
    const pts = dailySeries(ds, platformsFor(cap, ds), cap.metricKey, days)
    return pts.length >= 1 ? { window: w, enabled: true } : { window: w, enabled: false, hint: 'not enough history yet' }
  })
}

/** Current level (not delta) of a metric key across one/all platforms, the
 * latest daily rollup value, falling back to the latest snapshot. null if none. */
export function latestLevel(ds: AnalyticsDataset, platform: AnalyticsPlatformId, metricKey: string): number | null {
  const platforms = platform === 'aggregated' ? ds.connected.filter((p) => p !== 'aggregated') : [platform]
  let total = 0
  let found = false
  for (const p of platforms) {
    let latestDate = ''
    let value: number | null = null
    for (const r of ds.daily) {
      if (r.platform !== p) continue
      if (typeof r.metrics[metricKey] !== 'number') continue
      if (r.date >= latestDate) {
        latestDate = r.date
        value = r.metrics[metricKey]
      }
    }
    if (value == null) {
      let latestAt = ''
      for (const s of ds.snapshots) {
        if (s.platform !== p) continue
        if (typeof s.metrics[metricKey] !== 'number') continue
        if (s.capturedAt >= latestAt) {
          latestAt = s.capturedAt
          value = s.metrics[metricKey]
        }
      }
    }
    if (value != null) {
      total += value
      found = true
    }
  }
  return found ? total : null
}

export interface WindowResult {
  latest: number
  previous: number | null
  delta: number | null
  deltaPct: number | null
  series: TrendPoint[]
  /** Honest note when history is partial / approximate. */
  note?: string
  approx?: boolean
  suffix?: string
  isDelta: boolean
}

/** Compute the REAL values + series for a (metric × window). Never synthesises. */
export function computeWindow(cap: MetricCapability, w: AnalyticsWindow, ds: AnalyticsDataset): WindowResult | null {
  const meta = WINDOW_META[w]
  const source = cap.source(w)
  const platforms = platformsFor(cap, ds)

  if (source === 'snapshot-delta') {
    const series = snapshotSeries(ds, platforms, cap.metricKey, meta.hours)
    if (series.length === 0) return null
    const latest = series[series.length - 1].value
    const previous = series.length >= 2 ? series[0].value : null
    const delta = previous == null ? null : latest - previous
    const deltaPct = previous && previous > 0 ? Math.round(((latest - previous) / previous) * 100) : null
    // Partial history if the oldest point is newer than the window start.
    const windowStart = Date.now() - meta.hours * 3_600_000
    const partial = new Date(series[0].date).getTime() > windowStart + 60_000
    const notes: string[] = []
    if (cap.approx) notes.push('≈ approssimato')
    if (partial || previous == null) notes.push('since tracking started')
    return { latest, previous, delta, deltaPct, series, note: notes.join(' · ') || undefined, approx: cap.approx, suffix: cap.suffix, isDelta: true }
  }

  if (source === 'member-messages') {
    const days = w === '24h' ? 2 : Math.max(1, Math.round(meta.hours / 24))
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const series = ds.memberMessages.filter((p) => p.date >= cutoff)
    if (series.length === 0) return null
    const latest = series[series.length - 1].value
    const previous = series.length >= 2 ? series[0].value : null
    const delta = previous == null ? null : latest - previous
    const deltaPct = previous && previous > 0 ? Math.round(((latest - previous) / previous) * 100) : null
    const partial = series.length < days
    return { latest, previous, delta, deltaPct, series, note: partial ? 'since tracking started' : undefined, suffix: cap.suffix, isDelta: false }
  }

  if (source === 'membership-snapshot') {
    const series = membershipSeries(ds, cap.metricKey, meta.hours)
    if (series.length === 0) return null
    const latest = series[series.length - 1].value
    const previous = series.length >= 2 ? series[0].value : null
    const delta = previous == null ? null : latest - previous
    const deltaPct = previous && previous > 0 ? Math.round(((latest - previous) / previous) * 100) : null
    return {
      latest,
      previous,
      delta,
      deltaPct,
      series,
      note: series.length < 2 ? 'una sola sincronizzazione finora' : undefined,
      suffix: cap.suffix,
      isDelta: false,
    }
  }

  if (source === 'member-tenure') {
    const days = w === '24h' ? 2 : Math.max(1, Math.round(meta.hours / 24))
    const series = tenureJoinSeries(ds, days)
    if (series.length === 0) return null
    const latest = series[series.length - 1].value
    const previous = series.length >= 2 ? series[0].value : null
    const delta = previous == null ? null : latest - previous
    const deltaPct = previous && previous > 0 ? Math.round(((latest - previous) / previous) * 100) : null
    // Only members who are STILL in the server can appear here, people who
    // joined and already left are invisible to the Discord member list.
    return { latest, previous, delta, deltaPct, series, note: 'only members still present', suffix: cap.suffix, isDelta: false }
  }

  if (source === 'csv') {
    if (!ds.x) return null
    const series = ds.x.trend.map((t) => ({ date: t.date, value: cap.metricKey === 'engagements' ? t.engagements : t.impressions }))
    const latest = series[series.length - 1]?.value ?? 0
    const previous = series[0]?.value ?? null
    return { latest, previous, delta: null, deltaPct: null, series, suffix: cap.suffix, isDelta: false }
  }

  // daily-rollup
  const days = w === '24h' ? 2 : Math.max(1, Math.round(meta.hours / 24))
  const series = dailySeries(ds, platforms, cap.metricKey, days)
  if (series.length === 0) return null
  const latest = series[series.length - 1].value
  const previous = series.length >= 2 ? series[0].value : null
  const delta = previous == null ? null : latest - previous
  const deltaPct = previous && previous > 0 ? Math.round(((latest - previous) / previous) * 100) : null
  const partial = series.length < days
  const notes: string[] = []
  if (cap.approx) notes.push('≈ approssimato')
  if (partial || previous == null) notes.push('since tracking started')
  return { latest, previous, delta, deltaPct, series, note: notes.join(' · ') || undefined, approx: cap.approx, suffix: cap.suffix, isDelta: false }
}
