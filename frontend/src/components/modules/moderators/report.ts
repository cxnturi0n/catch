import type { ConversionConfig, Moderator, PointsMetric } from '../../../types'
import type { ModeratorActivityInput } from '../../../lib/reportBuilder'
import { cellKey, platformOf, type MetricPlatform } from './comp'

export interface MetricLine {
  metricKey: string
  label: string
  platform: MetricPlatform | null
  value: number
  points: number // value × per-unit points
  perUnit: number
}

export interface PlatformLine {
  platform: MetricPlatform
  value: number // sum of raw metric counts on that platform
  points: number
}

export interface ModeratorReport {
  moderator: Moderator
  lines: MetricLine[]
  platforms: PlatformLine[]
  totalPoints: number
  money: number
  rank: number // 1-based, by points
  share: number // 0..1 fraction of total workspace points
  topMetric: MetricLine | null
}

export interface ReportRollup {
  reports: ModeratorReport[] // sorted by points desc
  totalPoints: number
  totalMoney: number
  activeCount: number // moderators with any points
  top: ModeratorReport | null
  mostImproved: null // reserved for when historical periods land
  currency: string
  rate: number
}

const PLATFORM_ORDER: MetricPlatform[] = ['X', 'Telegram', 'Discord']

/**
 * Roll workspace compensation data up into per-moderator activity reports:
 * points, money, per-metric and per-platform breakdowns, ranking and share.
 * Pure, the same inputs the Compensation tab already loads, so no extra I/O.
 */
export function buildRollup(
  moderators: Moderator[],
  metrics: PointsMetric[],
  values: Record<string, number>,
  conversion: ConversionConfig,
): ReportRollup {
  const valueOf = (moderatorId: string, metricKey: string) => values[cellKey(moderatorId, metricKey)] ?? 0

  const partial: Omit<ModeratorReport, 'rank' | 'share'>[] = moderators.map((moderator) => {
    const lines: MetricLine[] = metrics.map((m) => {
      const value = valueOf(moderator.id, m.metricKey)
      return {
        metricKey: m.metricKey,
        label: m.label,
        platform: platformOf(m.metricKey),
        value,
        perUnit: m.points,
        points: value * m.points,
      }
    })

    const platformMap = new Map<MetricPlatform, PlatformLine>()
    for (const line of lines) {
      if (!line.platform) continue
      const entry = platformMap.get(line.platform) ?? { platform: line.platform, value: 0, points: 0 }
      entry.value += line.value
      entry.points += line.points
      platformMap.set(line.platform, entry)
    }
    const platforms = PLATFORM_ORDER.filter((p) => platformMap.has(p)).map((p) => platformMap.get(p)!)

    const totalPoints = lines.reduce((sum, l) => sum + l.points, 0)
    const topMetric = lines.filter((l) => l.points > 0).sort((a, b) => b.points - a.points)[0] ?? null

    return {
      moderator,
      lines,
      platforms,
      totalPoints,
      money: totalPoints * conversion.rate,
      topMetric,
    }
  })

  const totalPoints = partial.reduce((sum, r) => sum + r.totalPoints, 0)
  const sorted = [...partial].sort((a, b) => b.totalPoints - a.totalPoints)

  const reports: ModeratorReport[] = sorted.map((r, i) => ({
    ...r,
    rank: i + 1,
    share: totalPoints > 0 ? r.totalPoints / totalPoints : 0,
  }))

  return {
    reports,
    totalPoints,
    totalMoney: reports.reduce((sum, r) => sum + r.money, 0),
    activeCount: reports.filter((r) => r.totalPoints > 0).length,
    top: reports[0]?.totalPoints > 0 ? reports[0] : null,
    mostImproved: null,
    currency: conversion.currency,
    rate: conversion.rate,
  }
}

/** One-paragraph executive summary of the moderator activity for the period. */
export function execSummary(rollup: ReportRollup): string {
  const { reports, activeCount, top, currency } = rollup
  if (reports.length === 0) return 'No moderators in this workspace yet.'
  if (!top || rollup.totalPoints === 0) {
    return `${reports.length} moderator${reports.length === 1 ? '' : 's'} on the roster, but no tracked activity yet this period. Enter or sync metrics in the Compensation tab to populate reports.`
  }

  const topName = top.moderator.fullName
  const topShare = Math.round(top.share * 100)
  const topPlatform = top.platforms.slice().sort((a, b) => b.points - a.points)[0]?.platform
  const inactive = reports.length - activeCount

  const parts: string[] = []
  parts.push(
    `${activeCount} of ${reports.length} moderators were active this period, generating ${formatInt(rollup.totalPoints)} points (${formatCurrency(rollup.totalMoney, currency)} in payout).`,
  )
  parts.push(
    `${topName} leads with ${formatInt(top.totalPoints)} points, ${topShare}% of all activity${topPlatform ? `, driven mostly by ${topPlatform}` : ''}.`,
  )
  if (inactive > 0) {
    parts.push(`${inactive} moderator${inactive === 1 ? ' has' : 's have'} no recorded activity and may need follow-up.`)
  }
  return parts.join(' ')
}

/** Fold a rollup into the general report's Moderator Activity section (#6). */
export function rollupToActivityInput(rollup: ReportRollup): ModeratorActivityInput | null {
  if (rollup.reports.length === 0) return null

  const lines: string[] = [
    `Active moderators: ${rollup.activeCount} of ${rollup.reports.length}`,
    `Total points earned: ${formatInt(rollup.totalPoints)} (${formatCurrency(rollup.totalMoney, rollup.currency)} payout)`,
  ]
  const top3 = rollup.reports.filter((r) => r.totalPoints > 0).slice(0, 3)
  if (top3.length > 0) {
    lines.push(`Top performers: ${top3.map((r) => `${r.moderator.fullName} (${formatInt(r.totalPoints)} pts)`).join(', ')}`)
  }
  const inactive = rollup.reports.length - rollup.activeCount
  if (inactive > 0) lines.push(`${inactive} moderator${inactive === 1 ? '' : 's'} with no recorded activity`)

  const summaryLine =
    rollup.top && rollup.totalPoints > 0
      ? `On the team side, ${rollup.top.moderator.fullName} led ${rollup.activeCount} active moderator${rollup.activeCount === 1 ? '' : 's'} with ${Math.round(rollup.top.share * 100)}% of tracked activity.`
      : `The moderator roster has ${rollup.reports.length} member${rollup.reports.length === 1 ? '' : 's'} but no tracked activity this period.`

  const recommendation =
    inactive > 0 ? `Follow up with the ${inactive} moderator${inactive === 1 ? '' : 's'} showing no recorded activity this period.` : undefined

  return { summaryLine, lines, recommendation }
}

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function formatCurrency(amount: number, currency: string): string {
  const fixed = Math.abs(amount) >= 1000 ? Math.round(amount) : Number(amount.toFixed(2))
  return `${fixed.toLocaleString('en-US', { minimumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2, maximumFractionDigits: 2 })} ${currency}`
}
