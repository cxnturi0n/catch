// ── Analytics composition helpers ───────────────────────────────────────────
// Pure, data-driven glue between the capability matrix and the dynamic dashboard.
// Nothing here synthesises data: it only SELECTS and GROUPS the real capabilities
// that already passed the availability checks in `analyticsCapabilities`.
//
// The dashboard is composed from a SET of capabilities (platform × metric pairs).
// Each capability is split by its nature:
//   • level  → a current STOCK you'd read "as of now" (members, followers …)
//   • flow   → activity over a period (messages, bans, joins …)
// Level metrics anchor the top "current" StatCard band; every capability with
// ≥2 real temporal points also earns a time-series chart below.

import {
  availableMetrics,
  availablePlatforms,
  availableWindows,
  computeWindow,
  type AnalyticsDataset,
  type AnalyticsPlatformId,
  type AnalyticsWindow,
  type MetricCapability,
  type WindowOption,
  type WindowResult,
} from './analyticsCapabilities'

// Windows in canonical order (mirrors the capability matrix; kept local so this
// module stays a pure consumer of the matrix without widening its exports).
const WINDOW_ORDER: AnalyticsWindow[] = ['1h', '5h', '24h', '7d', '30d']

/** URL-addressable platform keys honored by `?platform=<key>`. */
export const URL_PLATFORM_KEYS = ['discord', 'telegram', 'galxe', 'zealy'] as const
export type UrlPlatformKey = (typeof URL_PLATFORM_KEYS)[number]

/** Parse the `?platform=` query value into a real platform id (or null). */
export function parseUrlPlatform(value: string | null | undefined): AnalyticsPlatformId | null {
  if (!value) return null
  return (URL_PLATFORM_KEYS as readonly string[]).includes(value) ? (value as AnalyticsPlatformId) : null
}

/** Stable, unique id for a capability across the whole matrix. */
export function capId(cap: MetricCapability): string {
  return `${cap.platform}:${cap.metric}`
}

/** Sentinel used by the metric multi-select to mean "show everything available". */
export const OVERVIEW_ID = 'overview'

// Metric ids that represent a current STOCK (level) rather than a flow/count.
const LEVEL_METRICS = new Set(['members', 'followers', 'participants', 'campaigns', 'total_xp', 'tracked_members'])

/** True when a metric is a "current level" (best read as a snapshot number). */
export function isLevelMetric(cap: MetricCapability): boolean {
  return LEVEL_METRICS.has(cap.metric)
}

/** Platforms offered in the (multi-select) Platform filter — only those with data. */
export function platformOptionsFor(ds: AnalyticsDataset | null): AnalyticsPlatformId[] {
  return ds ? availablePlatforms(ds) : []
}

/** Union of every metric capability that has data across the selected platforms. */
export function metricOptionsFor(platforms: AnalyticsPlatformId[], ds: AnalyticsDataset | null): MetricCapability[] {
  if (!ds) return []
  const seen = new Set<string>()
  const out: MetricCapability[] = []
  for (const p of platforms) {
    for (const cap of availableMetrics(p, ds)) {
      const id = capId(cap)
      if (seen.has(id)) continue
      seen.add(id)
      out.push(cap)
    }
  }
  return out
}

/** One resolved, ready-to-render analytics tile: the real result for a window. */
export interface DisplayItem {
  cap: MetricCapability
  /** The window actually used (clamped to one the metric genuinely supports). */
  window: AnalyticsWindow
  result: WindowResult
}

/**
 * Pick the best window for a capability: the preferred one when it's enabled,
 * otherwise the first window the metric genuinely supports right now. Returns
 * null when the metric has no enabled window at all (→ it won't be charted).
 */
export function resolveWindow(cap: MetricCapability, preferred: AnalyticsWindow, ds: AnalyticsDataset): AnalyticsWindow | null {
  const enabled = availableWindows(cap, ds).filter((o) => o.enabled)
  if (enabled.length === 0) return null
  return enabled.some((o) => o.window === preferred) ? preferred : enabled[0].window
}

/** Resolve a set of capabilities into real, renderable items (skips empty ones). */
export function composeDisplay(caps: MetricCapability[], preferred: AnalyticsWindow, ds: AnalyticsDataset | null): DisplayItem[] {
  if (!ds) return []
  const items: DisplayItem[] = []
  for (const cap of caps) {
    const window = resolveWindow(cap, preferred, ds)
    if (!window) continue
    const result = computeWindow(cap, window, ds)
    if (!result) continue
    items.push({ cap, window, result })
  }
  return items
}

/**
 * The Range selector's options, made dynamic to the currently displayed metrics:
 * a window is offered when at least one displayed metric supports it, and enabled
 * when at least one has enough real history for it.
 */
export function unionWindowOptions(caps: MetricCapability[], ds: AnalyticsDataset | null): WindowOption[] {
  if (!ds || caps.length === 0) return []
  const present = new Set<AnalyticsWindow>()
  const enabled = new Set<AnalyticsWindow>()
  for (const cap of caps) {
    for (const opt of availableWindows(cap, ds)) {
      present.add(opt.window)
      if (opt.enabled) enabled.add(opt.window)
    }
  }
  return WINDOW_ORDER.filter((w) => present.has(w)).map((w) => ({ window: w, enabled: enabled.has(w) }))
}
