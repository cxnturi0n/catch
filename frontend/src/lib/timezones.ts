// ── World timezone catalog ──────────────────────────────────────────────────
// The full IANA timezone list (Europe/Rome, America/New_York, Asia/Tokyo, …),
// grouped by region with a live UTC-offset label, plus helpers to read/sort/
// search them. Sourced from `Intl.supportedValuesOf('timeZone')` (~420 zones) so
// it stays current with the runtime; a curated fallback covers the rare engine
// that lacks that API. Everything here is display-only — data is stored in UTC.

const FALLBACK_ZONES: string[] = [
  'UTC',
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'America/Anchorage', 'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Chicago',
  'America/Denver', 'America/Halifax', 'America/Los_Angeles', 'America/Mexico_City',
  'America/New_York', 'America/Phoenix', 'America/Sao_Paulo', 'America/Toronto',
  'Asia/Bangkok', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Jerusalem',
  'Asia/Kolkata', 'Asia/Karachi', 'Asia/Manila', 'Asia/Seoul', 'Asia/Shanghai',
  'Asia/Singapore', 'Asia/Tokyo', 'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Dublin', 'Europe/Istanbul',
  'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Moscow', 'Europe/Paris',
  'Europe/Rome', 'Europe/Warsaw', 'Pacific/Auckland', 'Pacific/Honolulu',
]

function computeAllZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
  if (typeof supported === 'function') {
    try {
      const list = supported('timeZone')
      if (Array.isArray(list) && list.length > 0) return list.includes('UTC') ? list : ['UTC', ...list]
    } catch {
      /* fall through to the curated list */
    }
  }
  return FALLBACK_ZONES
}

/** Every selectable IANA zone id, computed once. */
export const ALL_TIME_ZONES: string[] = computeAllZones()

/** The browser's own detected zone, or UTC if unavailable. */
export function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** True when a string is a zone the runtime can actually format with. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Signed offset from UTC in minutes for `tz` at instant `at` (DST-aware). */
export function zoneOffsetMinutes(tz: string, at: Date = new Date()): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const parts = dtf.formatToParts(at)
    const map: Record<string, string> = {}
    for (const p of parts) map[p.type] = p.value
    const asUTC = Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour), Number(map.minute), Number(map.second),
    )
    return Math.round((asUTC - at.getTime()) / 60000)
  } catch {
    return 0
  }
}

/** "GMT+2", "GMT−5:30", "GMT" — the current short offset label for `tz`. */
export function zoneShortOffset(tz: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(at)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value
    if (name && name !== 'GMT') return name.replace('-', '−')
  } catch {
    /* fall back to computing it from the offset minutes */
  }
  const mins = zoneOffsetMinutes(tz, at)
  if (mins === 0) return 'GMT'
  const sign = mins > 0 ? '+' : '−'
  const abs = Math.abs(mins)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `GMT${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`
}

/** Region (first path segment): "Europe", "America", "Asia", … */
export function zoneRegion(tz: string): string {
  const i = tz.indexOf('/')
  return i === -1 ? 'Other' : tz.slice(0, i)
}

/** Human city/place label: "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function zoneCity(tz: string): string {
  const seg = tz.includes('/') ? tz.slice(tz.lastIndexOf('/') + 1) : tz
  return seg.replace(/_/g, ' ')
}

/** "Rome · GMT+2" — a compact one-line label for a zone. */
export function zoneLabel(tz: string, at: Date = new Date()): string {
  return `${zoneCity(tz)} · ${zoneShortOffset(tz, at)}`
}

export interface ZoneGroup {
  region: string
  zones: string[]
}

/** All zones grouped by region, regions alphabetical, zones sorted by offset then city. */
export function groupedZones(filter = ''): ZoneGroup[] {
  const q = filter.trim().toLowerCase()
  const now = new Date()
  // Precompute offset + short label per zone once so the search + sort stay cheap.
  const offset = new Map<string, number>()
  const byRegion = new Map<string, string[]>()
  for (const tz of ALL_TIME_ZONES) {
    const so = zoneShortOffset(tz, now)
    if (q && !tz.toLowerCase().includes(q) && !zoneCity(tz).toLowerCase().includes(q) && !so.toLowerCase().includes(q)) continue
    offset.set(tz, zoneOffsetMinutes(tz, now))
    const region = zoneRegion(tz)
    const arr = byRegion.get(region) ?? []
    arr.push(tz)
    byRegion.set(region, arr)
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([region, zones]) => ({
      region,
      zones: zones.sort((a, b) => (offset.get(a)! - offset.get(b)!) || zoneCity(a).localeCompare(zoneCity(b))),
    }))
}
