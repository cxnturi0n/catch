import type { CompCurrency, PointsMetric } from '../../../types'
import type { PointsMetricInput } from '../../../lib/db'
import type { BadgeTone } from '../../ui/Badge'

export type MetricPlatform = 'X' | 'Telegram' | 'Discord'
export type MetricSource = 'auto' | 'manual'

/**
 * The CURATED catalog of metrics Catch can actually track, either pulled
 * automatically from an integration ('auto') or entered by the CM ('manual',
 * e.g. from the X CSV export). The CM can ONLY pick metrics from this list, so
 * they never create a metric we have no way of measuring. Each metric is tied
 * to a specific platform.
 */
export interface SupportedMetric {
  metricKey: string
  label: string
  platform: MetricPlatform
  source: MetricSource
  defaultPoints: number
  hint: string
}

export const SUPPORTED_METRICS: SupportedMetric[] = [
  // ── X / Twitter (from the CSV export today; paid API later) ──
  { metricKey: 'content_created', label: 'Content created', platform: 'X', source: 'manual', defaultPoints: 10, hint: 'Tweets published' },
  { metricKey: 'likes', label: 'Likes', platform: 'X', source: 'manual', defaultPoints: 1, hint: 'Likes received' },
  { metricKey: 'retweets', label: 'Retweets', platform: 'X', source: 'manual', defaultPoints: 2, hint: 'Reposts received' },
  { metricKey: 'quote_tweets', label: 'Quote tweets', platform: 'X', source: 'manual', defaultPoints: 3, hint: 'Quote reposts' },
  { metricKey: 'replies', label: 'Replies', platform: 'X', source: 'manual', defaultPoints: 1, hint: 'Comments received' },
  { metricKey: 'impressions', label: 'Impressions', platform: 'X', source: 'manual', defaultPoints: 0, hint: 'Views (own account only)' },
  // ── Telegram ──
  { metricKey: 'tg_messages', label: 'Messages', platform: 'Telegram', source: 'auto', defaultPoints: 1, hint: 'Messages sent in the group' },
  // ── Discord ──
  { metricKey: 'dc_messages', label: 'Messages', platform: 'Discord', source: 'auto', defaultPoints: 1, hint: 'Messages sent in the server' },
  { metricKey: 'dc_bans', label: 'Bans executed', platform: 'Discord', source: 'auto', defaultPoints: 5, hint: 'Bans via audit log' },
  { metricKey: 'dc_timeouts', label: 'Timeouts given', platform: 'Discord', source: 'auto', defaultPoints: 2, hint: 'Timeouts issued' },
]

/** The X / Twitter metrics the CM imports by hand (no live API). Order matches
 * the CSV paste layout: Name,content,likes,retweets,quotes,replies,impressions. */
export const X_METRICS: SupportedMetric[] = SUPPORTED_METRICS.filter((m) => m.platform === 'X')

/** Metric keys pulled automatically from an integration (pre-fillable in the earnings table). */
export const AUTO_METRIC_KEYS: string[] = SUPPORTED_METRICS.filter((m) => m.source === 'auto').map((m) => m.metricKey)

/** Legacy metric keys (from an earlier seed) mapped to a platform for display. */
const LEGACY_PLATFORM: Record<string, MetricPlatform> = { messages: 'Telegram' }

export function platformOf(metricKey: string): MetricPlatform | null {
  return metricMeta(metricKey)?.platform ?? LEGACY_PLATFORM[metricKey] ?? null
}

export function metricMeta(metricKey: string): SupportedMetric | undefined {
  return SUPPORTED_METRICS.find((m) => m.metricKey === metricKey)
}

export const PLATFORM_TONE: Record<MetricPlatform, BadgeTone> = {
  X: 'gray',
  Telegram: 'cyan',
  Discord: 'indigo',
}

/** Seeded on first open: the full supported catalog (CM can remove what they don't use). */
export const DEFAULT_POINTS_METRICS: PointsMetricInput[] = SUPPORTED_METRICS.map((m) => ({
  metricKey: m.metricKey,
  label: m.label,
  points: m.defaultPoints,
}))

export const CURRENCY_OPTIONS: CompCurrency[] = ['USD', 'USDT', 'EUR']

/** Stable key for one (moderator, metric) cell in the earnings table. */
export function cellKey(moderatorId: string, metricKey: string): string {
  return `${moderatorId}::${metricKey}`
}

/** Total points for a moderator = Σ(metric value × metric points). */
export function totalPointsFor(metrics: PointsMetric[], valueOf: (metricKey: string) => number): number {
  let total = 0
  for (const m of metrics) total += valueOf(m.metricKey) * m.points
  return total
}

/** Money earned = total points × rate. */
export function moneyFor(points: number, rate: number): number {
  return points * rate
}

export function formatMoney(amount: number, currency: string): string {
  const fixed = Math.abs(amount) >= 1000 ? amount.toFixed(0) : amount.toFixed(2)
  return `${Number(fixed).toLocaleString('en-US', { minimumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2, maximumFractionDigits: 2 })} ${currency}`
}

export function formatPoints(points: number): string {
  return points.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/** Parse a raw input string to a non-negative number, tolerating intermediate typing. */
export function parseAmount(raw: string): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
