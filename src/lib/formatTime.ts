// ── Timezone-aware formatting ────────────────────────────────────────────────
// Pure helpers that render an instant in a given IANA zone. Data is always
// stored/handled in UTC; these are the single place the account timezone turns
// UTC into what the user reads. Pair with `useTimezone()` from TimezoneContext:
//   const { timezone } = useTimezone()
//   formatTimeInTz(task.dueAt, timezone)

import { zoneShortOffset } from './timezones'

type Instant = Date | string | number

function toDate(value: Instant): Date {
  return value instanceof Date ? value : new Date(value)
}

/** Format an instant in `tz` with explicit Intl options. */
export function formatInTz(value: Instant, tz: string, opts: Intl.DateTimeFormatOptions): string {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-GB', opts).format(d)
  }
}

/** "14:05" — 24h wall-clock time in `tz`. */
export function formatTimeInTz(value: Instant, tz: string): string {
  return formatInTz(value, tz, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "6 Aug" — day + short month in `tz`. */
export function formatDateInTz(value: Instant, tz: string): string {
  return formatInTz(value, tz, { day: 'numeric', month: 'short' })
}

/** "Wed 6 Aug" — weekday + day + short month in `tz`. */
export function formatWeekdayDateInTz(value: Instant, tz: string): string {
  return formatInTz(value, tz, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "6 Aug 2026, 14:05" — full date + time in `tz`. */
export function formatDateTimeInTz(value: Instant, tz: string): string {
  return formatInTz(value, tz, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** "14:05 GMT+2" — time plus the zone's current short offset. */
export function formatTimeWithZone(value: Instant, tz: string): string {
  return `${formatTimeInTz(value, tz)} ${zoneShortOffset(tz, toDate(value))}`
}

/** Minutes past midnight (0–1439) of the wall clock in `tz` — for positioning on a day grid. */
export function wallMinutesInTz(value: Instant, tz: string): number {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return 0
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    return h * 60 + m
  } catch {
    return d.getHours() * 60 + d.getMinutes()
  }
}

/** "YYYY-MM-DD" calendar date of an instant as seen in `tz`. */
export function dateKeyInTz(value: Instant, tz: string): string {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
    const y = parts.find((p) => p.type === 'year')?.value ?? '0000'
    const mo = parts.find((p) => p.type === 'month')?.value ?? '01'
    const da = parts.find((p) => p.type === 'day')?.value ?? '01'
    return `${y}-${mo}-${da}`
  } catch {
    return d.toISOString().slice(0, 10)
  }
}
