import type { TaskPriority } from '../../../types'
import type { BadgeTone } from '../../ui/Badge'

// ── Priority styling ──

export const PRIORITY_TONE: Record<TaskPriority, BadgeTone> = {
  High: 'red',
  Medium: 'yellow',
  Low: 'blue',
}

// Calendar chip colors, High red-ish, Medium amber, Low slate/blue.
export const PRIORITY_CHIP: Record<TaskPriority, string> = {
  High: 'bg-red-500/15 text-red-200 border-red-500/40 hover:border-red-400/70',
  Medium: 'bg-amber-500/15 text-amber-200 border-amber-500/40 hover:border-amber-400/70',
  Low: 'bg-sky-500/15 text-sky-200 border-sky-500/40 hover:border-sky-400/70',
}

// A small dot color per priority for the compact summary list.
export const PRIORITY_DOT: Record<TaskPriority, string> = {
  High: 'bg-red-400',
  Medium: 'bg-amber-400',
  Low: 'bg-sky-400',
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Local-date helpers (avoid UTC off-by-one on 'YYYY-MM-DD' strings) ──

/** Parse a 'YYYY-MM-DD' string into a Date at local midnight. */
export function parseDateLocal(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}

/** Format a Date into a 'YYYY-MM-DD' key using local calendar fields. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Today's local 'YYYY-MM-DD' key. */
export function todayKey(): string {
  return toDateKey(new Date())
}

/** Monday-anchored start of the week containing `ref`, as a local Date. */
export function startOfWeek(ref: Date): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
  const weekday = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  d.setDate(d.getDate() - weekday)
  return d
}

/** True if `key` (YYYY-MM-DD) falls within [start, end] inclusive by day. */
export function isWithinDays(key: string, start: Date, end: Date): boolean {
  const t = parseDateLocal(key).getTime()
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime()
  return t >= s && t <= e
}
