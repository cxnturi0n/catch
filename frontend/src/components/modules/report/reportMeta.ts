import type { IntegrationKey } from '../../../types'
import type { ReportData } from '../../../lib/reportBuilder'

/** The three user-facing report kinds exposed by the control bar. */
export type UiReportKind = 'overview' | 'single' | 'moderation'

/**
 * Extra, presentation-only metadata we stash on a persisted report so the
 * History table can label it as Overview / Single platform / Moderation.
 *
 * `ReportData` (in lib/) can't carry these fields, and both `community`-mapped
 * kinds (Overview + Single platform) share the same `reportType`, so we attach
 * them locally and read them back defensively (legacy entries have none).
 */
export interface ReportMeta {
  uiKind?: UiReportKind
  platform?: IntegrationKey
  platformLabel?: string
}

export type ReportDataWithMeta = ReportData & ReportMeta

export const UI_KIND_LABEL: Record<UiReportKind, string> = {
  overview: 'Overview',
  single: 'Single platform',
  moderation: 'Moderation',
}

const PLATFORM_LABELS: Record<string, string> = {
  discord: 'Discord',
  telegram: 'Telegram',
  galxe: 'Galxe',
  zealy: 'Zealy',
}

export function platformLabel(key: string): string {
  return PLATFORM_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

/** Human label for the History "Type" column, resilient to legacy entries. */
export function reportKindLabel(data: ReportDataWithMeta): string {
  if (data.uiKind === 'single') return data.platformLabel ? `Single platform · ${data.platformLabel}` : 'Single platform'
  if (data.uiKind) return UI_KIND_LABEL[data.uiKind]
  // Legacy entries persisted before this metadata existed.
  return data.reportType === 'general' ? 'Moderation' : 'Overview'
}
