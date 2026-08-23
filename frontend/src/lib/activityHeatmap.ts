import { fetchActivityBuckets, type ActivityBucket, type ActivityPlatform } from './api/metrics'
export { fetchActivityBuckets, type ActivityBucket, type ActivityPlatform }

/**
 * Community activity heatmap, real message volume per UTC hour × weekday.
 *
 * TIMEZONE: every bucket is stored and aggregated in **UTC**. We deliberately do
 * NOT localise: moderator shifts are defined on a fixed 24h grid (06-14 / 14-22 /
 * 22-06) and a community spans timezones, so a single stable reference frame is
 * the only honest one. The UI must say "times are UTC".
 *
 * DATA HONESTY: rows only exist for hours that actually saw traffic, and only
 * from the moment ingestion was enabled (Telegram webhook has no history at all;
 * Discord sync fills forward from activation). Nothing here invents a value, * absent hours are genuine zeros, and `hasData` tells the caller whether to show
 * the grid or an explanatory empty state.
 */




/**
 * Reads raw hour buckets for a workspace over the last `sinceDays` days.
 * Pass `platform` to narrow to a single source; omit it for everything.
 * Caller is responsible for not calling this when there is no signed-in user.
 */
// ── Aggregation ──

/** The three moderator shifts, mirrored from ModeratorShift in ../types. */
export const SHIFT_LABELS = ['Morning (06-14)', 'Afternoon (14-22)', 'Night (22-06)'] as const
export type ShiftLabel = (typeof SHIFT_LABELS)[number]

/** Weekday labels for rows, index 0 = Monday, matching ScheduleTab. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface PeakHour {
  /** 0 = Mon … 6 = Sun */
  weekday: number
  /** 0 to 23, UTC */
  hour: number
  messages: number
}

export interface ShiftTotal {
  shift: ShiftLabel
  messages: number
  /** Share of all tracked messages, 0 to 100. */
  share: number
}

export interface HeatmapSummary {
  /** [weekday 0=Mon..6=Sun][hour 0..23] → message count. Always fully populated. */
  matrix: number[][]
  /** Highest single-cell value (0 when there is no data). */
  max: number
  /** Sum of every cell. */
  total: number
  /** False when nothing has been tracked yet, show the empty state. */
  hasData: boolean
  /** Distinct UTC days that contain at least one bucket (how much history we hold). */
  daysTracked: number
  /** True when we hold less than a full week, label the view "partial history". */
  partial: boolean
  /** Platforms that actually contributed at least one message. */
  platforms: ActivityPlatform[]
  /** Busiest cells, highest first (zero-valued cells are never included). */
  peakHours: PeakHour[]
  /** Totals mapped onto the three moderator shifts, highest first. */
  shiftTotals: ShiftTotal[]
}

/** UTC weekday with Monday as 0 (JS getUTCDay is Sunday-as-0). */
function weekdayIndexUTC(date: Date): number {
  return (date.getUTCDay() + 6) % 7
}

/** Which moderator shift an hour (0 to 23, UTC) belongs to. */
export function shiftIndexForHour(hour: number): number {
  if (hour >= 6 && hour < 14) return 0
  if (hour >= 14 && hour < 22) return 1
  return 2 // 22-06 wraps midnight
}

function emptyMatrix(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
}

/**
 * Pure aggregator: folds raw buckets into a 7×24 matrix plus the derived
 * summaries the UI needs. No I/O, no clock reads beyond the buckets themselves.
 */
export function buildHeatmap(buckets: ActivityBucket[], peakCount = 3): HeatmapSummary {
  const matrix = emptyMatrix()
  const days = new Set<string>()
  const platforms = new Set<ActivityPlatform>()
  let total = 0
  let max = 0

  for (const b of buckets) {
    const at = new Date(b.bucketStart)
    if (Number.isNaN(at.getTime())) continue
    const weekday = weekdayIndexUTC(at)
    const hour = at.getUTCHours()
    matrix[weekday][hour] += b.count
    if (matrix[weekday][hour] > max) max = matrix[weekday][hour]
    total += b.count
    days.add(b.bucketStart.slice(0, 10))
    if (b.count > 0) platforms.add(b.platform)
  }

  // Peak cells, only real, non-zero ones.
  const cells: PeakHour[] = []
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const messages = matrix[weekday][hour]
      if (messages > 0) cells.push({ weekday, hour, messages })
    }
  }
  cells.sort((a, b) => b.messages - a.messages)

  // Per-shift totals across the whole week.
  const shiftSums = [0, 0, 0]
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      shiftSums[shiftIndexForHour(hour)] += matrix[weekday][hour]
    }
  }
  const shiftTotals: ShiftTotal[] = SHIFT_LABELS.map((shift, i) => ({
    shift,
    messages: shiftSums[i],
    share: total > 0 ? (shiftSums[i] / total) * 100 : 0,
  })).sort((a, b) => b.messages - a.messages)

  const daysTracked = days.size
  return {
    matrix,
    max,
    total,
    hasData: total > 0,
    daysTracked,
    partial: daysTracked > 0 && daysTracked < 7,
    platforms: [...platforms],
    peakHours: cells.slice(0, peakCount),
    shiftTotals,
  }
}

/** "Mon 20:00", the label used in cell tooltips and the peak-hour list. */
export function formatCellLabel(weekday: number, hour: number): string {
  return `${WEEKDAY_LABELS[weekday]} ${String(hour).padStart(2, '0')}:00`
}
