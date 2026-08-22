// Structured, render-ready model for the Catch report one-pager.
//
// `reportBuilder.ts` produces the human/text view of a report (summary, sections,
// recommendations) AND — via `buildReportModel` here — a structured `ReportModel`
// carrying the numbers already shaped for charts. Keeping the model separate from
// the text keeps the builder tidy and lets the preview / printable / email pick
// exactly the visualizations they can each render (recharts in the app; plain
// SVG/HTML in print & email, which run no JS).

import type { CatchTask, KOL, ModerationIncident, TrendPoint, WorkspaceStats } from '../types'

export type ReportType = 'community' | 'general'

export const REPORT_TYPES: { id: ReportType; label: string; blurb: string }[] = [
  { id: 'community', label: 'Community analytics', blurb: 'Growth, messages and KOL reach only.' },
  { id: 'general', label: 'General', blurb: 'Analytics + moderation, moderator activity, payments and tasks.' },
]

// Sapphire categorical series — ordered for maximum adjacent contrast so pie
// slices stay legible. Every value is on-brand (see index.css accent tokens).
export const SAPPHIRE_SERIES = ['#2f7cf6', '#8cc5ff', '#1e3a8a', '#6db3ff', '#14276b', '#4d9fff', '#a9d5ff']
export const SAPPHIRE = {
  cyan: '#2f7cf6',
  emerald: '#4d9fff',
  bright: '#8cc5ff',
  deep: '#1e3a8a',
  mid: '#6db3ff',
  night: '#14276b',
}

export interface ReportKpi {
  label: string
  value: string
  /** Percentage change vs the previous period; null when not applicable. */
  delta: number | null
}

export interface PieDatum {
  label: string
  value: number
  color: string
}

export interface BarDatum {
  label: string
  value: number
  color: string
}

/** One connected platform in the cross-platform "Unified overview". */
export interface PlatformBreakdownRow {
  /** Platform id, e.g. 'discord'. */
  platform: string
  /** Human label, e.g. 'Discord'. */
  label: string
  /** Primary audience count (members / followers) — real latest value. */
  members: number
  /** What `members` actually is on this platform ('Members' vs 'Followers'). */
  memberLabel: string
  /** Optional secondary real metric (bans, participants, XP…). */
  keyMetric?: { label: string; value: number }
  color: string
}

/**
 * Cross-platform rollup — the "one dashboard that unifies every platform"
 * headline. Built ONLY from platforms that really reported data (see
 * `buildUnifiedOverview`); it is omitted entirely when fewer than two platforms
 * have data, because a "unified" view of a single source is not unified.
 */
export interface UnifiedOverview {
  /** How many connected platforms actually contributed. */
  platformCount: number
  /** Sum of each platform's audience count. NOT unique users. */
  totalMembers: number
  /** Honest caveat rendered next to the total. */
  totalMembersNote: string
  /** Per-platform breakdown, largest audience first. */
  platforms: PlatformBreakdownRow[]
  /** Combined message volume in the period, when a platform tracks messages. */
  combinedMessages?: number
  /** Honest note on where the message volume comes from. */
  messagesNote?: string
}

/** Per-moderator + per-platform rollup, flattened for charts (no component deps). */
export interface ModeratorChartInput {
  byModerator: { name: string; points: number; share: number }[]
  byPlatform: { platform: string; points: number }[]
  currency: string
  totalMoney: number
  activeCount: number
  totalCount: number
}

/** Payments folded up for the payments section. */
export interface PaymentSummaryInput {
  totalPaid: number
  currency: string
  count: number
  byModerator: { name: string; amount: number }[]
}

/**
 * The structured, chart-ready view of a report. Sections are optional so the
 * same shape covers the "community" type (analytics only) and "general"
 * (analytics + moderation + moderators + payments + tasks), and so guest
 * sessions — which have no moderator/payment data — simply omit
 * those blocks instead of rendering empty charts.
 */
export interface ReportModel {
  type: ReportType
  kpis: ReportKpi[]
  // Cross-platform unified rollup (any report type, ≥2 platforms with data)
  unified?: UnifiedOverview
  // Community analytics
  membersTrend?: TrendPoint[]
  messagesTrend?: TrendPoint[]
  kolByChannel?: PieDatum[]
  // Moderation (general)
  incidentsByType?: PieDatum[]
  incidentsResolution?: PieDatum[]
  // Moderator activity (general)
  moderatorShare?: PieDatum[]
  moderatorByPlatform?: BarDatum[]
  moderatorMoneyLabel?: string
  // Payments (general)
  paymentsByModerator?: PieDatum[]
  paymentsTotalLabel?: string
  // Tasks (general)
  tasksByStatus?: PieDatum[]
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

/** Public whole-number formatter (mono, thousands-separated) for the unified view. */
export function formatCount(n: number): string {
  return formatNumber(n)
}

/**
 * Per-platform metric map for the unified overview. `memberKey` is the audience
 * count on that platform's daily rollup jsonb; `keyMetric` is an optional second
 * real metric. Only platforms that actually report `memberKey` appear — nothing
 * is invented. Order here is only the tie-break; rows are re-sorted by audience.
 */
const UNIFIED_PLATFORMS: {
  id: string
  label: string
  memberKey: string
  memberLabel: string
  keyMetric?: { key: string; label: string }
}[] = [
  { id: 'discord', label: 'Discord', memberKey: 'members', memberLabel: 'Members', keyMetric: { key: 'bans_7d', label: 'Bans (7d)' } },
  { id: 'telegram', label: 'Telegram', memberKey: 'members', memberLabel: 'Members' },
  { id: 'galxe', label: 'Galxe', memberKey: 'followers', memberLabel: 'Followers', keyMetric: { key: 'participants', label: 'Participants' } },
  { id: 'zealy', label: 'Zealy', memberKey: 'members', memberLabel: 'Members', keyMetric: { key: 'total_xp', label: 'Total XP' } },
]

/**
 * Fold the raw per-platform daily rollup rows into the cross-platform
 * `UnifiedOverview`. Uses each platform's LATEST row for the audience count, sums
 * honestly (subscriptions, not unique users), and returns `undefined` unless at
 * least two platforms genuinely reported data — never fabricates a metric.
 */
export function buildUnifiedOverview(
  rows: { platform: string; date: string; metrics: Record<string, number> }[],
  combinedMessages?: number | null,
): UnifiedOverview | undefined {
  // Latest row per platform (rows may be unsorted / multi-day).
  const latestDate = new Map<string, string>()
  const latestMetrics = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const prev = latestDate.get(r.platform)
    if (!prev || r.date > prev) {
      latestDate.set(r.platform, r.date)
      latestMetrics.set(r.platform, r.metrics ?? {})
    }
  }

  const platforms: PlatformBreakdownRow[] = []
  for (const meta of UNIFIED_PLATFORMS) {
    const metrics = latestMetrics.get(meta.id)
    if (!metrics) continue
    const members = metrics[meta.memberKey]
    if (typeof members !== 'number') continue
    const keyMetric =
      meta.keyMetric && typeof metrics[meta.keyMetric.key] === 'number'
        ? { label: meta.keyMetric.label, value: metrics[meta.keyMetric.key] }
        : undefined
    platforms.push({ platform: meta.id, label: meta.label, members, memberLabel: meta.memberLabel, keyMetric, color: SAPPHIRE.cyan })
  }

  // "Unified" needs ≥2 real sources, otherwise it's just one platform's number.
  if (platforms.length < 2) return undefined

  platforms.sort((a, b) => b.members - a.members)
  platforms.forEach((p, i) => (p.color = SAPPHIRE_SERIES[i % SAPPHIRE_SERIES.length]))

  const totalMembers = platforms.reduce((s, p) => s + p.members, 0)
  const combined = typeof combinedMessages === 'number' && combinedMessages > 0 ? Math.round(combinedMessages) : undefined

  return {
    platformCount: platforms.length,
    totalMembers,
    totalMembersNote: `sum of sign-ups across ${platforms.length} platforms, not unique users`,
    platforms,
    combinedMessages: combined,
    messagesNote: combined !== undefined ? 'message volume tracked in the period (Telegram)' : undefined,
  }
}

export function formatMoney(amount: number, currency: string): string {
  const rounded = Math.abs(amount) >= 1000 ? Math.round(amount) : Number(amount.toFixed(2))
  return `${rounded.toLocaleString('en-US', {
    minimumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2,
    maximumFractionDigits: 2,
  })} ${currency}`
}

/** "+12%", "−3%", or "—" when null. */
export function formatDelta(delta: number | null): string {
  if (delta === null) return '—'
  const sign = delta >= 0 ? '+' : '−'
  return `${sign}${Math.abs(delta)}%`
}

function colored<T extends { label: string; value: number }>(rows: T[]): (T & { color: string })[] {
  return rows.map((r, i) => ({ ...r, color: SAPPHIRE_SERIES[i % SAPPHIRE_SERIES.length] }))
}

function countBy<T>(items: T[], key: (t: T) => string): { label: string; value: number }[] {
  const map = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()].map(([label, value]) => ({ label, value }))
}

export interface ReportModelInput {
  reportType: ReportType
  stats: WorkspaceStats
  membersTrend: TrendPoint[]
  messagesTrend: TrendPoint[]
  incidents: ModerationIncident[]
  kols: KOL[]
  tasks: CatchTask[]
  moderator?: ModeratorChartInput
  payments?: PaymentSummaryInput
  /** Pre-built cross-platform rollup (built by the caller from real data). */
  unified?: UnifiedOverview
}

/**
 * Pure transform: workspace data → chart-ready `ReportModel`. The chosen
 * `reportType` decides which blocks are populated; blocks with no data are left
 * undefined so the renderers can skip them entirely.
 */
export function buildReportModel(input: ReportModelInput): ReportModel {
  const { reportType, stats, incidents, kols, tasks } = input
  const activeKols = kols.filter((k) => k.status === 'Active')

  // ── KOL reach share by channel (community + general) ──
  const kolReachByChannel = new Map<string, number>()
  for (const k of kols) kolReachByChannel.set(k.channel, (kolReachByChannel.get(k.channel) ?? 0) + k.reach)
  const kolByChannel = colored(
    [...kolReachByChannel.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
  )

  const membersTrend = input.membersTrend
  const messagesTrend = input.messagesTrend

  if (reportType === 'community') {
    return {
      type: 'community',
      unified: input.unified,
      kpis: [
        { label: 'Active Members', value: formatNumber(stats.activeMembers), delta: stats.activeMembersDelta },
        { label: 'New Members', value: formatNumber(stats.newMembers), delta: stats.newMembersDelta },
        { label: 'Messages', value: formatNumber(stats.messagesWeek), delta: stats.messagesDelta },
        { label: 'Active KOLs', value: formatNumber(activeKols.length), delta: null },
      ],
      membersTrend,
      messagesTrend,
      kolByChannel: kolByChannel.length > 0 ? kolByChannel : undefined,
    }
  }

  // ── General ──
  const resolved = incidents.filter((i) => i.status === 'Resolved').length
  const open = incidents.filter((i) => i.status === 'Open').length

  const incidentsByType = colored(countBy(incidents, (i) => i.type).sort((a, b) => b.value - a.value))
  const incidentsResolution =
    incidents.length > 0
      ? [
          { label: 'Resolved', value: resolved, color: SAPPHIRE.emerald },
          { label: 'Open', value: open, color: SAPPHIRE.night },
        ]
      : undefined

  const tasksByStatus =
    tasks.length > 0
      ? [
          { label: 'Done', value: tasks.filter((t) => t.status === 'Done').length, color: SAPPHIRE.emerald },
          { label: 'In Progress', value: tasks.filter((t) => t.status === 'In Progress').length, color: SAPPHIRE.mid },
          { label: 'To Do', value: tasks.filter((t) => t.status === 'To Do').length, color: SAPPHIRE.deep },
        ].filter((s) => s.value > 0)
      : undefined

  const mod = input.moderator
  const moderatorShare =
    mod && mod.byModerator.length > 0
      ? colored(
          mod.byModerator
            .filter((m) => m.points > 0)
            .slice(0, 6)
            .map((m) => ({ label: m.name, value: m.points })),
        )
      : undefined
  const moderatorByPlatform =
    mod && mod.byPlatform.some((p) => p.points > 0)
      ? colored(mod.byPlatform.filter((p) => p.points > 0).map((p) => ({ label: p.platform, value: p.points })))
      : undefined

  const pay = input.payments
  const paymentsByModerator =
    pay && pay.byModerator.length > 0
      ? colored(
          pay.byModerator
            .filter((m) => m.amount > 0)
            .slice(0, 6)
            .map((m) => ({ label: m.name, value: m.amount })),
        )
      : undefined

  const kpis: ReportKpi[] = [
    { label: 'Active Members', value: formatNumber(stats.activeMembers), delta: stats.activeMembersDelta },
    { label: 'Messages', value: formatNumber(stats.messagesWeek), delta: stats.messagesDelta },
    { label: 'Scam Alerts Blocked', value: formatNumber(stats.scamAlertsBlocked), delta: stats.scamAlertsDelta },
  ]
  if (pay && pay.totalPaid > 0) {
    kpis.push({ label: 'Payout', value: formatMoney(pay.totalPaid, pay.currency), delta: null })
  } else {
    kpis.push({
      label: 'Incidents',
      value: `${resolved}/${incidents.length}`,
      delta: null,
    })
  }

  return {
    type: 'general',
    unified: input.unified,
    kpis,
    membersTrend,
    incidentsByType: incidentsByType.length > 0 ? incidentsByType : undefined,
    incidentsResolution,
    kolByChannel: kolByChannel.length > 0 ? kolByChannel : undefined,
    moderatorShare,
    moderatorByPlatform,
    moderatorMoneyLabel:
      mod && mod.activeCount > 0 ? `${mod.activeCount}/${mod.totalCount} active · ${formatMoney(mod.totalMoney, mod.currency)} earned` : undefined,
    paymentsByModerator,
    paymentsTotalLabel: pay && pay.totalPaid > 0 ? `${formatMoney(pay.totalPaid, pay.currency)} across ${pay.count} payment${pay.count === 1 ? '' : 's'}` : undefined,
    tasksByStatus,
  }
}
