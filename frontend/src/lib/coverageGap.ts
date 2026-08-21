// Coverage-gap analysis: cross the community's activity-by-hour against the
// moderators' assigned shift windows to find hours where the community is busy
// but nobody is on shift. All hours are UTC. Weekday convention here is
// 0=Sun … 6=Sat, matching both JS getUTCDay() and Moderator.shiftDays.

import type { ActivityBucket } from './activityHeatmap'
import type { Moderator } from '../types'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export interface CoverageGap {
  weekday: number // 0=Sun..6=Sat
  startHour: number // inclusive, UTC
  endHour: number // exclusive, UTC
  messages: number // total messages observed in this window over the period
}

export interface CoverageGapResult {
  gaps: CoverageGap[]
  /** Hours in a week that have activity but zero shift coverage. */
  uncoveredActiveHours: number
  /** Total moderators with a usable shift window. */
  scheduledModerators: number
  hasShiftData: boolean
  hasActivityData: boolean
}

/** Hours covered by a single shift window, handling midnight wrap (e.g. 22→06). */
function hoursInWindow(startUtc: number, endUtc: number): number[] {
  const hours: number[] = []
  if (startUtc === endUtc) return hours
  let h = startUtc
  // Walk forward, wrapping past 24, until we reach endUtc.
  for (let i = 0; i < 24; i++) {
    if (h === endUtc) break
    hours.push(h)
    h = (h + 1) % 24
  }
  return hours
}

/**
 * Builds a [7][24] coverage count matrix from the roster's shift windows.
 * A cell > 0 means at least one moderator is scheduled for that weekday+hour.
 */
function buildCoverageMatrix(moderators: Moderator[]): { matrix: number[][]; scheduled: number } {
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  let scheduled = 0
  for (const m of moderators) {
    if (m.shiftStartUtc === undefined || m.shiftEndUtc === undefined) continue
    const days = m.shiftDays && m.shiftDays.length > 0 ? m.shiftDays : [1, 2, 3, 4, 5]
    const hours = hoursInWindow(m.shiftStartUtc, m.shiftEndUtc)
    if (hours.length === 0) continue
    scheduled++
    for (const d of days) {
      if (d < 0 || d > 6) continue
      for (const h of hours) matrix[d][h] += 1
    }
  }
  return { matrix, scheduled }
}

/** Sums activity buckets into a [7][24] message-count matrix (UTC). */
function buildActivityMatrix(buckets: ActivityBucket[]): { matrix: number[][]; total: number } {
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  let total = 0
  for (const b of buckets) {
    const d = new Date(b.bucketStart)
    if (Number.isNaN(d.getTime())) continue
    matrix[d.getUTCDay()][d.getUTCHours()] += b.count
    total += b.count
  }
  return { matrix, total }
}

/** Groups consecutive uncovered hours within the same weekday into ranges. */
function groupContiguous(cells: { weekday: number; hour: number; messages: number }[]): CoverageGap[] {
  const byDay = new Map<number, { hour: number; messages: number }[]>()
  for (const c of cells) {
    const arr = byDay.get(c.weekday) ?? []
    arr.push({ hour: c.hour, messages: c.messages })
    byDay.set(c.weekday, arr)
  }
  const gaps: CoverageGap[] = []
  for (const [weekday, arr] of byDay) {
    arr.sort((a, b) => a.hour - b.hour)
    let run: { hour: number; messages: number }[] = []
    const flush = () => {
      if (run.length === 0) return
      gaps.push({
        weekday,
        startHour: run[0].hour,
        endHour: run[run.length - 1].hour + 1,
        messages: run.reduce((s, x) => s + x.messages, 0),
      })
      run = []
    }
    for (const cell of arr) {
      if (run.length === 0 || cell.hour === run[run.length - 1].hour + 1) run.push(cell)
      else {
        flush()
        run.push(cell)
      }
    }
    flush()
  }
  return gaps.sort((a, b) => b.messages - a.messages)
}

/**
 * Finds hours with meaningful activity (>= the mean of non-zero cells) that no
 * moderator shift covers. Returns ranked, human-groupable gaps.
 */
export function computeCoverageGaps(buckets: ActivityBucket[], moderators: Moderator[]): CoverageGapResult {
  const { matrix: activity, total } = buildActivityMatrix(buckets)
  const { matrix: coverage, scheduled } = buildCoverageMatrix(moderators)

  const hasActivityData = total > 0
  const hasShiftData = scheduled > 0

  // Threshold: only flag hours at or above the average of active hours, so we
  // don't nag about a single stray message at 4am.
  const nonZero = activity.flat().filter((v) => v > 0)
  const meanActive = nonZero.length > 0 ? nonZero.reduce((s, v) => s + v, 0) / nonZero.length : 0

  const cells: { weekday: number; hour: number; messages: number }[] = []
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const a = activity[d][h]
      if (a > 0 && a >= meanActive && coverage[d][h] === 0) {
        cells.push({ weekday: d, hour: h, messages: a })
      }
    }
  }

  return {
    gaps: groupContiguous(cells),
    uncoveredActiveHours: cells.length,
    scheduledModerators: scheduled,
    hasShiftData,
    hasActivityData,
  }
}

function fmtHour(h: number): string {
  return `${String(h % 24).padStart(2, '0')}:00`
}

/** Report-ready lines describing the coverage gaps, for the report builder. */
export function coverageGapReportLines(result: CoverageGapResult): {
  summaryLine: string
  lines: string[]
  recommendation?: string
} {
  if (!result.hasActivityData) {
    return {
      summaryLine: 'Coverage analysis unavailable — no tracked community activity yet.',
      lines: ['Connect Discord or Telegram and let activity accumulate to map shift coverage.'],
    }
  }
  if (!result.hasShiftData) {
    return {
      summaryLine: 'Coverage analysis unavailable — no moderator shift windows set.',
      lines: ['Assign each moderator a timezone and shift in Moderators → Roster to enable this.'],
    }
  }
  if (result.gaps.length === 0) {
    return {
      summaryLine: `Shift coverage is healthy across ${result.scheduledModerators} scheduled moderator${result.scheduledModerators === 1 ? '' : 's'}.`,
      lines: ['No high-activity hours are left uncovered by the current shift plan.'],
    }
  }

  const top = result.gaps.slice(0, 6)
  const lines = top.map(
    (g) =>
      `${WEEKDAY_LABELS[g.weekday]} ${fmtHour(g.startHour)}–${fmtHour(g.endHour)} UTC — ${g.messages.toLocaleString()} msgs, no moderator on shift.`,
  )
  const worst = top[0]
  return {
    summaryLine: `${result.uncoveredActiveHours} active hour${result.uncoveredActiveHours === 1 ? '' : 's'}/week fall outside moderator shift coverage.`,
    lines,
    recommendation: `Consider adding coverage around ${WEEKDAY_LABELS[worst.weekday]} ${fmtHour(worst.startHour)}–${fmtHour(worst.endHour)} UTC — the busiest uncovered window — by shifting an existing moderator or hiring for that timezone.`,
  }
}
