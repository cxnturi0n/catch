// ── Recap data ──────────────────────────────────────────────────────────────
// Builds the cross-platform "recap" summary shown by <RecapPopup/>. It reads the
// real daily rollup rows (platform_metrics jsonb) via the existing db helper —
// nothing here is synthesised. Callers MUST only invoke buildRecap for a
// signed-in user with connected platforms; guests/no-data get the gentle
// "connect a platform" state driven by an empty section list.

import { fetchPlatformMetricRows, type PlatformMetricDay } from './db'
import type { IntegrationKey, WorkspaceId } from '../types'

/** Platforms whose daily metrics we can summarise (twitter is CSV-only → excluded). */
export const RECAP_PLATFORMS: IntegrationKey[] = ['discord', 'telegram', 'galxe', 'zealy', 'snapshot']

interface MetricDef {
  key: string
  label: string
  /** The platform's headline metric — the one whose growth we highlight. */
  primary?: boolean
  suffix?: string
}

// Per-platform metric keys, mirroring the honest set declared in the analytics
// capability matrix (members / followers / participants / total_xp …).
const PLATFORM_METRICS: Record<string, { label: string; metrics: MetricDef[] }> = {
  discord: {
    label: 'Discord',
    metrics: [
      { key: 'members', label: 'Members', primary: true },
      { key: 'bans_7d', label: 'Bans (7d)' },
    ],
  },
  telegram: {
    label: 'Telegram',
    metrics: [{ key: 'members', label: 'Members', primary: true }],
  },
  galxe: {
    label: 'Galxe',
    metrics: [
      { key: 'followers', label: 'Followers', primary: true },
      { key: 'participants', label: 'Participants' },
      { key: 'campaigns', label: 'Campaigns' },
    ],
  },
  zealy: {
    label: 'Zealy',
    metrics: [
      { key: 'members', label: 'Members', primary: true },
      { key: 'total_xp', label: 'Total XP' },
    ],
  },
  snapshot: {
    label: 'Snapshot',
    metrics: [
      { key: 'proposals', label: 'Proposals', primary: true },
      { key: 'votes', label: 'Votes' },
    ],
  },
}

export interface RecapMetric {
  label: string
  value: number
  suffix?: string
}

export interface RecapSection {
  platform: IntegrationKey
  label: string
  /** Headline metric for the platform (or null if the platform reported none). */
  headline: RecapMetric | null
  /** Absolute change of the headline metric over the window (null when unknown). */
  headlineDelta: number | null
  /** Percent change of the headline metric over the window (null when unknown). */
  headlinePct: number | null
  /** Secondary current-level metrics. */
  metrics: RecapMetric[]
}

export interface RecapData {
  hasData: boolean
  /** Members summed across every platform that reports a member/follower count. */
  totalMembers: number
  /** Absolute member growth across platforms over the window (null when unknown). */
  totalGrowth: number | null
  totalGrowthPct: number | null
  /** How many connected platforms actually returned data. */
  activePlatforms: number
  /** Days spanned by the underlying data (for the "over N days" label). */
  windowDays: number
  sections: RecapSection[]
  generatedAt: string
}

/** Metric keys that count toward the aggregated "total members" top line. */
const MEMBERSHIP_KEYS = new Set(['members', 'followers'])

const EMPTY_RECAP: RecapData = {
  hasData: false,
  totalMembers: 0,
  totalGrowth: null,
  totalGrowthPct: null,
  activePlatforms: 0,
  windowDays: 0,
  sections: [],
  generatedAt: new Date().toISOString(),
}

function numeric(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Pick the earliest and latest daily rows for a platform's row set. */
function firstAndLast(rows: PlatformMetricDay[]): { first: PlatformMetricDay; last: PlatformMetricDay } {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  return { first: sorted[0], last: sorted[sorted.length - 1] }
}

/**
 * Fetch and shape the cross-platform recap. Reads up to `days` of daily rollup
 * rows for the connected platforms and computes the current level plus the
 * change since the earliest row in the window.
 *
 * Returns an empty (hasData:false) recap when nothing came back — callers render
 * the "connect a platform" state in that case. Never fabricates numbers.
 */
export async function buildRecap(
  workspaceId: WorkspaceId,
  connectedPlatforms: IntegrationKey[],
  days = 8,
): Promise<RecapData> {
  const platforms = connectedPlatforms.filter((p) => p in PLATFORM_METRICS)
  if (!workspaceId || platforms.length === 0) return { ...EMPTY_RECAP, generatedAt: new Date().toISOString() }

  let rows: PlatformMetricDay[]
  try {
    rows = await fetchPlatformMetricRows(workspaceId, platforms, days)
  } catch {
    return { ...EMPTY_RECAP, generatedAt: new Date().toISOString() }
  }
  if (rows.length === 0) return { ...EMPTY_RECAP, generatedAt: new Date().toISOString() }

  const byPlatform = new Map<string, PlatformMetricDay[]>()
  for (const row of rows) {
    const list = byPlatform.get(row.platform) ?? []
    list.push(row)
    byPlatform.set(row.platform, list)
  }

  const sections: RecapSection[] = []
  let totalMembers = 0
  let totalMembersThen = 0
  let hasMembersThen = false
  const allDates = new Set<string>()

  // Preserve a stable platform order (matches RECAP_PLATFORMS).
  for (const platform of platforms) {
    const def = PLATFORM_METRICS[platform]
    const pRows = byPlatform.get(platform)
    if (!def || !pRows || pRows.length === 0) continue

    const { first, last } = firstAndLast(pRows)
    for (const r of pRows) allDates.add(r.date)

    let headline: RecapMetric | null = null
    let headlineDelta: number | null = null
    let headlinePct: number | null = null
    const metrics: RecapMetric[] = []

    for (const m of def.metrics) {
      const nowVal = numeric(last.metrics[m.key])
      if (nowVal === null) continue
      const metric: RecapMetric = { label: m.label, value: nowVal, suffix: m.suffix }

      if (m.primary && headline === null) {
        headline = metric
        const thenVal = numeric(first.metrics[m.key])
        if (thenVal !== null && first.date !== last.date) {
          headlineDelta = nowVal - thenVal
          headlinePct = thenVal !== 0 ? ((nowVal - thenVal) / thenVal) * 100 : null
        }
      } else {
        metrics.push(metric)
      }

      // Aggregate top-line membership across platforms.
      if (MEMBERSHIP_KEYS.has(m.key)) {
        totalMembers += nowVal
        const thenVal = numeric(first.metrics[m.key])
        if (thenVal !== null && first.date !== last.date) {
          totalMembersThen += thenVal
          hasMembersThen = true
        }
      }
    }

    sections.push({
      platform: platform as IntegrationKey,
      label: def.label,
      headline,
      headlineDelta,
      headlinePct,
      metrics,
    })
  }

  if (sections.length === 0) return { ...EMPTY_RECAP, generatedAt: new Date().toISOString() }

  const totalGrowth = hasMembersThen ? totalMembers - totalMembersThen : null
  const totalGrowthPct =
    hasMembersThen && totalMembersThen !== 0 ? ((totalMembers - totalMembersThen) / totalMembersThen) * 100 : null

  return {
    hasData: true,
    totalMembers,
    totalGrowth,
    totalGrowthPct,
    activePlatforms: sections.length,
    windowDays: Math.max(allDates.size - 1, 0),
    sections,
    generatedAt: new Date().toISOString(),
  }
}

// ── Catch AI insight layer ───────────────────────────────────────────────────
// Turns the raw recap numbers into a short narrative, prioritised alerts, and
// concrete corrective actions. Fully DETERMINISTIC — no external AI, no
// fabrication: every sentence and threshold is derived from the real metrics in
// `RecapData`. This is the "insight → action" layer the recap popup renders as a
// message from "Catch AI".

export type RecapAlertLevel = 'critical' | 'warning' | 'positive'

export interface RecapAlert {
  level: RecapAlertLevel
  title: string
  detail: string
}

export interface RecapAction {
  label: string
  detail: string
  /** Dashboard route the action deep-links to (relative to app root). */
  to: string
}

export interface RecapNarrative {
  /** One-line verdict in Catch AI's voice. */
  headline: string
  /** One or two sentences summarising scale + trend + the notable mover. */
  body: string
}

export interface RecapInsights {
  narrative: RecapNarrative
  alerts: RecapAlert[]
  actions: RecapAction[]
}

/** Format a signed percentage for prose ("+4.2%", "-11%"). */
function pctText(pct: number): string {
  const sign = pct > 0 ? '+' : ''
  const abs = Math.abs(pct)
  return `${sign}${pct.toFixed(abs >= 100 || abs < 10 ? (abs < 10 ? 1 : 0) : 1)}%`
}

/** Read a named secondary metric off a section (case-insensitive on label). */
function metricValue(section: RecapSection, label: string): number | null {
  const m = section.metrics.find((x) => x.label.toLowerCase() === label.toLowerCase())
  return m ? m.value : null
}

/**
 * Derive the narrative + alerts + actions from a built recap. Safe to call on an
 * empty recap (returns a gentle connect-prompt narrative with no alerts). Caps
 * alerts and actions at 3 each, most important first, and never repeats a route.
 */
export function buildRecapInsights(data: RecapData): RecapInsights {
  if (!data.hasData || data.sections.length === 0) {
    return {
      narrative: {
        headline: 'Nothing to summarise yet',
        body: 'Connect a platform and Catch AI will start tracking growth, flagging risks and suggesting the next move.',
      },
      alerts: [],
      actions: [{ label: 'Connect a platform', detail: 'Link Discord, Telegram, Galxe and more to unlock your recap.', to: '/dashboard/integrations' }],
    }
  }

  // Rank movers by headline % change (known values only).
  const withPct = data.sections.filter((s) => s.headlinePct !== null) as (RecapSection & { headlinePct: number })[]
  const sortedDesc = [...withPct].sort((a, b) => b.headlinePct - a.headlinePct)
  const best = sortedDesc[0]
  const worst = sortedDesc[sortedDesc.length - 1]

  const g = data.totalGrowthPct
  const windowText = data.windowDays > 0 ? ` over the last ${data.windowDays} day${data.windowDays === 1 ? '' : 's'}` : ''

  // ── Narrative ──────────────────────────────────────────────────────────────
  let headline: string
  if (g !== null && g >= 3) headline = 'Your communities are growing'
  else if (g !== null && g <= -3) headline = 'Your communities need attention'
  else headline = 'Your communities are holding steady'

  const parts: string[] = []
  parts.push(
    `You're managing ${formatNumber(data.totalMembers)} members across ${data.activePlatforms} platform${
      data.activePlatforms === 1 ? '' : 's'
    }${windowText}.`,
  )
  if (g !== null) {
    const dir = g > 0 ? 'up' : g < 0 ? 'down' : 'flat'
    let trend = `Overall membership is ${dir} ${pctText(g)}`
    if (best && best.headlinePct > 0) trend += `, led by ${best.label} (${pctText(best.headlinePct)})`
    parts.push(trend + '.')
  }
  if (worst && worst.headlinePct <= -3 && (!best || worst.platform !== best.platform)) {
    parts.push(`${worst.label} slipped ${pctText(worst.headlinePct)} — worth a look.`)
  }
  const narrative: RecapNarrative = { headline, body: parts.join(' ') }

  // ── Alerts ─────────────────────────────────────────────────────────────────
  const alerts: RecapAlert[] = []
  if (g !== null && g <= -5) {
    alerts.push({ level: 'critical', title: 'Membership is declining', detail: `Total members are down ${pctText(g)}${windowText}.` })
  } else if (g !== null && g < 0.5) {
    alerts.push({ level: 'warning', title: 'Growth has stalled', detail: `Overall membership is essentially flat (${pctText(g)})${windowText}.` })
  } else if (g !== null && g >= 8) {
    alerts.push({ level: 'positive', title: 'Strong growth', detail: `Total members are up ${pctText(g)}${windowText}. Capitalise on the momentum.` })
  }

  // Per-platform sharp decline (skip if already the top-line story on one platform).
  if (worst && worst.headlinePct <= -5 && data.activePlatforms > 1) {
    alerts.push({ level: 'warning', title: `${worst.label} dropped ${pctText(worst.headlinePct)}`, detail: `${worst.label} lost ground while other platforms held — investigate recent activity.` })
  }

  // Discord moderation signal — bans relative to member base.
  const discord = data.sections.find((s) => s.platform === 'discord')
  if (discord) {
    const bans = metricValue(discord, 'Bans (7d)')
    const members = discord.headline?.value ?? 0
    if (bans !== null && (bans >= 10 || (members > 0 && bans / members >= 0.01))) {
      alerts.push({ level: 'warning', title: 'Elevated bans on Discord', detail: `${formatNumber(bans)} bans in 7 days — possible raid or spam wave. Check moderation.` })
    }
  }

  // Strong single-platform surge (positive reinforcement).
  if (best && best.headlinePct >= 12) {
    alerts.push({ level: 'positive', title: `${best.label} surged ${pctText(best.headlinePct)}`, detail: `${best.label} is outpacing the rest — double down on what's working there.` })
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  const actions: RecapAction[] = []
  const pushAction = (a: RecapAction) => {
    if (!actions.some((x) => x.to === a.to)) actions.push(a)
  }

  if (g !== null && g <= -5) {
    pushAction({ label: 'Investigate the decline', detail: 'Review analytics to see where members are leaving and when.', to: '/dashboard/analytics' })
  } else if (g !== null && g < 0.5) {
    pushAction({ label: 'Plan a growth campaign', detail: 'Engagement is flat — schedule a quest, AMA or content push.', to: '/dashboard/tasks' })
  }
  if (discord) {
    const bans = metricValue(discord, 'Bans (7d)')
    const members = discord.headline?.value ?? 0
    if (bans !== null && (bans >= 10 || (members > 0 && bans / members >= 0.01))) {
      pushAction({ label: 'Review Discord moderation', detail: 'Unusual ban volume — check for a raid and tighten filters.', to: '/dashboard/analytics' })
    }
  }
  if (worst && worst.headlinePct <= -5 && data.activePlatforms > 1) {
    pushAction({ label: `Dig into ${worst.label}`, detail: `${worst.label} is trending down — compare it against your other channels.`, to: '/dashboard/analytics' })
  }
  if (data.activePlatforms === 1) {
    pushAction({ label: 'Connect more platforms', detail: 'A single source limits your cross-platform picture.', to: '/dashboard/integrations' })
  }
  // Always leave the CM with a next step.
  if (actions.length === 0) {
    pushAction({ label: 'Share this recap', detail: 'Metrics look healthy — send a report to your client or team.', to: '/dashboard/report' })
  }

  return {
    narrative,
    alerts: alerts.slice(0, 3),
    actions: actions.slice(0, 3),
  }
}

/** Compact number formatter (1234 → "1.2k", 1_500_000 → "1.5M"). */
export function formatNumber(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  return `${n}`
}

/** Signed delta with compact formatting ("+320", "-12"). */
export function formatDelta(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : ''
  return `${sign}${formatNumber(Math.abs(n))}`
}
