// The report document. Structure is a constant of the product: the same
// sections, in the same order, with the same metric ids, every time. Only the
// values change. Anything generative (P2) fills the narrative slots and is
// validated against this structure; it can never add, remove or reorder parts.

export const REPORT_VERSION = 1

export const PERIOD_KINDS = ['7d', '30d', '90d'] as const
export type PeriodKind = (typeof PERIOD_KINDS)[number]

export const SECTION_IDS = ['growth', 'engagement', 'sentiment', 'moderation', 'incidents', 'kols', 'operations'] as const
export type SectionId = (typeof SECTION_IDS)[number]

export const SECTION_TITLES: Record<SectionId, string> = {
  growth: 'Community growth',
  engagement: 'Engagement',
  sentiment: 'Sentiment & listening',
  moderation: 'Moderation team',
  incidents: 'Incidents & risk',
  kols: 'KOLs & campaigns',
  operations: 'Operations',
}

/** `ok` = data present; `no_data` = source connected but nothing in the period;
 *  `not_connected` = no integration/feature feeding this section;
 *  `not_available` = the product does not collect this yet. */
export type SectionState = 'ok' | 'no_data' | 'not_connected' | 'not_available'

export type Unit = 'count' | 'pct' | 'seconds' | 'hours' | 'usd' | 'ratio'

export interface Metric {
  id: string
  label: string
  value: number | null
  /** Same metric in the previous period of equal length; null when not comparable. */
  prev: number | null
  unit: Unit
  /** (value - prev) / |prev| * 100, null when prev is 0/null. */
  deltaPct: number | null
}

export interface SeriesPoint {
  t: string
  v: number
}
export interface Series {
  id: string
  label: string
  unit: Unit
  points: SeriesPoint[]
}

export interface Table {
  id: string
  label: string
  columns: { key: string; label: string; unit?: Unit }[]
  rows: Record<string, string | number | null>[]
}

export type InsightSeverity = 'info' | 'warning' | 'critical' | 'positive'
export interface Insight {
  id: string
  sectionId: SectionId
  severity: InsightSeverity
  /** Metric ids the insight was computed from — the audit trail for any narrative. */
  metricIds: string[]
  text: string
}

export interface Section {
  id: SectionId
  title: string
  state: SectionState
  /** Shown when state !== 'ok'. */
  stateReason: string | null
  metrics: Metric[]
  series: Series[]
  tables: Table[]
  insights: Insight[]
  /** Narrative slot: rule text in P1, model text (validated) in P2. */
  note: string
}

export interface Recommendation {
  id: string
  title: string
  rationale: string
  priority: 'high' | 'medium' | 'low'
  metricIds: string[]
  insightIds: string[]
}

export interface Coverage {
  platforms: { platform: string; status: string; lastSyncAt: string | null; lastError: string | null }[]
  daysWithData: number
  periodDays: number
  moderators: number
}

export interface Report {
  version: number
  workspace: { id: string; name: string }
  period: { kind: PeriodKind; days: number; start: string; end: string; prevStart: string; prevEnd: string }
  generatedAt: string
  coverage: Coverage
  summary: string[]
  sections: Section[]
  recommendations: Recommendation[]
  methodology: string[]
  narrativeSource: 'rules' | 'llm'
}

export const PERIOD_DAYS: Record<PeriodKind, number> = { '7d': 7, '30d': 30, '90d': 90 }

export function metric(id: string, label: string, unit: Unit, value: number | null, prev: number | null = null): Metric {
  const deltaPct = value !== null && prev !== null && prev !== 0 ? round(((value - prev) / Math.abs(prev)) * 100, 1) : null
  return { id, label, value: value === null ? null : round(value, unit === 'pct' || unit === 'ratio' ? 1 : 2), prev, unit, deltaPct }
}

export function round(n: number, digits = 1): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

export function emptySection(id: SectionId, state: SectionState, reason: string | null): Section {
  return { id, title: SECTION_TITLES[id], state, stateReason: reason, metrics: [], series: [], tables: [], insights: [], note: '' }
}
