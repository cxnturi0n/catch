// ── Member tenure & retention ───────────────────────────────────────────────
// "How long do people stay in our Discord?" — everything here is derived from
// REAL rows written by the `discord-members-sync` edge function:
//
//   discord_member_tenure        one row per member ever seen (joined_at + last_seen)
//   discord_membership_snapshots one row per sync run (total / new / left)
//
// Two honesty rules baked into this module:
//   1. A single sync can only measure SURVIVORS. People who left before we ever
//      synced are invisible to the Discord API, so tenure stats describe current
//      members, never the full history of the server.
//   2. Anything that needs history (churn %, retention over time) only becomes
//      available once ≥2 sync runs exist — until then it reports hasData: false
//      instead of guessing.

import { fetchTenure, fetchMembershipSnapshots, type TenureRecord, type MembershipSnapshotRow } from './api/metrics'
export { fetchTenure, fetchMembershipSnapshots, type TenureRecord, type MembershipSnapshotRow }

import { api, isApiError } from './api/client'

/** Member list sync runs daily in the worker; this forces a run now. */
export async function syncDiscordMembers(workspaceId: string): Promise<MembersSyncResult> {
  try {
    const r = await api<{ total: number; new: number; left: number; truncated: boolean }>(`/workspaces/${workspaceId}/integrations/discord/members-sync`, { method: 'POST' })
    return { success: true, ...r }
  } catch (err) {
    if (isApiError(err)) return { success: false, error: err.code, message: err.message }
    return { success: false, error: 'UPSTREAM', message: err instanceof Error ? err.message : 'Sync failed' }
  }
}



export interface MembersSyncResult {
  success: boolean
  total?: number
  new?: number
  left?: number
  truncated?: boolean
  /** 'MISSING_MEMBERS_INTENT' when the privileged intent is off. */
  error?: string
  message?: string
}

/** Returned by the edge function when the Server Members Intent is disabled. */
export const MISSING_MEMBERS_INTENT = 'MISSING_MEMBERS_INTENT'

const DAY_MS = 86_400_000
// A sync run stamps every member it saw with the same timestamp, so "still in
// the server" means "last_seen belongs to the most recent run".
const PRESENCE_TOLERANCE_MS = 5 * 60 * 1000

// ── Fetching ────────────────────────────────────────────────────────────────

/**
 * All tenure rows for a workspace. Paged, because Supabase caps a single select
 * at 1000 rows and a Discord guild can be far larger than that.
 */
/** Sync-run snapshots (oldest → newest) for the last `sinceDays` days. */
/**
 * Kick off a members sync. Mirrors lib/functions.ts's invoke(): supabase-js hides
 * the function's real error behind a generic message, so dig the body out. The
 * MISSING_MEMBERS_INTENT case is returned by the function with a 200 status, so
 * it arrives here as normal data rather than a thrown error.
 */
// ── Pure aggregators ────────────────────────────────────────────────────────

export interface TenureBucket {
  id: string
  label: string
  count: number
  /** Share of members with a known join date, 0–100 (rounded to 1 decimal). */
  pct: number
}

interface BucketDef {
  id: string
  label: string
  /** Inclusive lower bound in days. */
  min: number
  /** Exclusive upper bound in days (Infinity for the last bucket). */
  max: number
}

const BUCKET_DEFS: BucketDef[] = [
  { id: 'lt1w', label: '< 1 week', min: 0, max: 7 },
  { id: '1to4w', label: '1–4 weeks', min: 7, max: 30 },
  { id: '1to3m', label: '1–3 months', min: 30, max: 90 },
  { id: '3to6m', label: '3–6 months', min: 90, max: 180 },
  { id: '6to12m', label: '6–12 months', min: 180, max: 365 },
  { id: 'gt1y', label: '> 1 year', min: 365, max: Infinity },
]

export interface CohortRow {
  /** 'YYYY-MM'. */
  month: string
  label: string
  /** Members we know joined in that month. */
  joined: number
  /** How many of them are still in the server at the latest sync. */
  stillPresent: number
  retentionPct: number | null
  /**
   * True when the cohort predates our first sync: we can only see the members of
   * that month who were STILL present when tracking began, so `joined` is itself
   * a survivor count, not the real intake of that month.
   */
  survivorsOnly: boolean
}

export interface TenureStats {
  /** False when no member row exists yet — the UI must show an empty state, never zeros. */
  hasData: boolean
  /** Rows in the table: current members + everyone we have observed leaving. */
  trackedMembers: number
  /** Members present at the most recent sync run. */
  currentMembers: number
  /** Members we have actually WATCHED leave (last_seen stopped advancing). */
  departedObserved: number
  /** Current members whose join date Discord did not return (excluded from the math). */
  missingJoinDate: number
  buckets: TenureBucket[]
  medianDays: number | null
  averageDays: number | null
  retained30Pct: number | null
  retained90Pct: number | null
  retained180Pct: number | null
  oldestJoinedAt: string | null
  /** Timestamp of the most recent sync run (max last_seen). */
  lastSyncAt: string | null
  /** Timestamp of the first sync run (min first_seen) — where honest history starts. */
  trackingSince: string | null
  cohorts: CohortRow[]
  /**
   * True once at least one departure has been observed, i.e. the cohort
   * "still present" column is measured rather than trivially equal to `joined`.
   */
  hasDepartureEvidence: boolean
}

const EMPTY_STATS: TenureStats = {
  hasData: false,
  trackedMembers: 0,
  currentMembers: 0,
  departedObserved: 0,
  missingJoinDate: 0,
  buckets: BUCKET_DEFS.map((b) => ({ id: b.id, label: b.label, count: 0, pct: 0 })),
  medianDays: null,
  averageDays: null,
  retained30Pct: null,
  retained90Pct: null,
  retained180Pct: null,
  oldestJoinedAt: null,
  lastSyncAt: null,
  trackingSince: null,
  cohorts: [],
  hasDepartureEvidence: false,
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number)
  if (!year || !month) return key
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Tenure distribution, medians and join cohorts. Tenure is computed on members
 * PRESENT at the latest sync (survivors); departures we have witnessed since
 * tracking started are reported separately and drive the cohort retention column.
 */
export function computeTenureStats(records: TenureRecord[], now = Date.now()): TenureStats {
  if (records.length === 0) return EMPTY_STATS

  let latestRunMs = 0
  let trackingSinceMs = Number.POSITIVE_INFINITY
  for (const r of records) {
    const seenMs = new Date(r.lastSeen).getTime()
    if (seenMs > latestRunMs) latestRunMs = seenMs
    const firstMs = new Date(r.firstSeen).getTime()
    if (firstMs < trackingSinceMs) trackingSinceMs = firstMs
  }
  const presentCutoff = latestRunMs - PRESENCE_TOLERANCE_MS

  const present: TenureRecord[] = []
  let departedObserved = 0
  for (const r of records) {
    if (new Date(r.lastSeen).getTime() >= presentCutoff) present.push(r)
    else departedObserved++
  }

  // Tenure in days for every present member with a known join date.
  const tenures: number[] = []
  let oldestJoinedAt: string | null = null
  let missingJoinDate = 0
  for (const r of present) {
    if (!r.joinedAt) {
      missingJoinDate++
      continue
    }
    const joinedMs = new Date(r.joinedAt).getTime()
    if (!Number.isFinite(joinedMs)) {
      missingJoinDate++
      continue
    }
    tenures.push(Math.max(0, (now - joinedMs) / DAY_MS))
    if (oldestJoinedAt === null || r.joinedAt < oldestJoinedAt) oldestJoinedAt = r.joinedAt
  }

  const measured = tenures.length
  const buckets: TenureBucket[] = BUCKET_DEFS.map((def) => {
    const count = tenures.filter((d) => d >= def.min && d < def.max).length
    return { id: def.id, label: def.label, count, pct: measured > 0 ? round1((count / measured) * 100) : 0 }
  })

  const sorted = [...tenures].sort((a, b) => a - b)
  const medianDays = measured > 0 ? round1(median(sorted)!) : null
  const averageDays = measured > 0 ? round1(tenures.reduce((s, d) => s + d, 0) / measured) : null
  const sharePast = (days: number) =>
    measured > 0 ? round1((tenures.filter((d) => d > days).length / measured) * 100) : null

  // ── Join cohorts (by month of joined_at) ──
  // Built over ALL tracked rows so a cohort's "still present" is a real measured
  // number wherever we have watched people leave.
  const trackingSinceMonth = Number.isFinite(trackingSinceMs) ? monthKey(new Date(trackingSinceMs).toISOString()) : null
  const byMonth = new Map<string, { joined: number; stillPresent: number }>()
  const presentRefs = new Set(present.map((r) => r.memberRef))
  for (const r of records) {
    if (!r.joinedAt) continue
    const key = monthKey(r.joinedAt)
    const entry = byMonth.get(key) ?? { joined: 0, stillPresent: 0 }
    entry.joined++
    if (presentRefs.has(r.memberRef)) entry.stillPresent++
    byMonth.set(key, entry)
  }
  const cohorts: CohortRow[] = [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, v]) => ({
      month,
      label: monthLabel(month),
      joined: v.joined,
      stillPresent: v.stillPresent,
      retentionPct: v.joined > 0 ? round1((v.stillPresent / v.joined) * 100) : null,
      survivorsOnly: trackingSinceMonth === null || month < trackingSinceMonth,
    }))

  return {
    hasData: true,
    trackedMembers: records.length,
    currentMembers: present.length,
    departedObserved,
    missingJoinDate,
    buckets,
    medianDays,
    averageDays,
    retained30Pct: sharePast(30),
    retained90Pct: sharePast(90),
    retained180Pct: sharePast(180),
    oldestJoinedAt,
    lastSyncAt: latestRunMs > 0 ? new Date(latestRunMs).toISOString() : null,
    trackingSince: Number.isFinite(trackingSinceMs) ? new Date(trackingSinceMs).toISOString() : null,
    cohorts,
    hasDepartureEvidence: departedObserved > 0,
  }
}

export interface RetentionPoint {
  /** captured_at of the sync run. */
  date: string
  total: number
  joined: number
  left: number
  /** left ÷ previous run's total, in %. Null for the first run (no baseline). */
  churnPct: number | null
  retentionPct: number | null
}

export interface RetentionSeries {
  /** True only with ≥2 sync runs — churn is meaningless without a baseline. */
  hasData: boolean
  points: RetentionPoint[]
  avgChurnPct: number | null
  totalJoined: number
  totalLeft: number
  /** Net member change across the covered runs. */
  netChange: number | null
}

const EMPTY_SERIES: RetentionSeries = {
  hasData: false,
  points: [],
  avgChurnPct: null,
  totalJoined: 0,
  totalLeft: 0,
  netChange: null,
}

/** Churn / retention per sync run, built from the snapshot history only. */
export function computeRetentionSeries(rows: MembershipSnapshotRow[]): RetentionSeries {
  if (rows.length === 0) return EMPTY_SERIES
  const ordered = [...rows].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))

  const points: RetentionPoint[] = ordered.map((row, i) => {
    const previousTotal = i > 0 ? ordered[i - 1].totalMembers : 0
    const churnPct = i > 0 && previousTotal > 0 ? round1((row.leftMembers / previousTotal) * 100) : null
    return {
      date: row.capturedAt,
      total: row.totalMembers,
      joined: row.newMembers,
      left: row.leftMembers,
      churnPct,
      retentionPct: churnPct === null ? null : round1(100 - churnPct),
    }
  })

  // The first run has no baseline: its new_members is just "everyone we saw",
  // so it is excluded from the joined/left totals.
  const comparable = points.slice(1)
  const churns = comparable.map((p) => p.churnPct).filter((v): v is number => v !== null)

  return {
    hasData: points.length >= 2,
    points,
    avgChurnPct: churns.length > 0 ? round1(churns.reduce((s, v) => s + v, 0) / churns.length) : null,
    totalJoined: comparable.reduce((s, p) => s + p.joined, 0),
    totalLeft: comparable.reduce((s, p) => s + p.left, 0),
    netChange: points.length >= 2 ? points[points.length - 1].total - points[0].total : null,
  }
}
