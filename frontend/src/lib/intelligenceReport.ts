// Adapters from the server-built intelligence report (the source of truth)
// to the presentation helpers that predate it: plain text, share/email, the
// print one-pager and the History table all consume `ReportData`.
import type { IntelligenceReportDoc, ReportMetric, ReportSection } from './api/misc'
import { slugify, type ReportData } from './reportBuilder'
import type { ReportKpi } from './reportModel'
import type { ReportDataWithMeta } from '../components/modules/report/reportMeta'

export function formatMetricValue(v: number | null, unit: ReportMetric['unit']): string {
  if (v === null) return 'n/a'
  switch (unit) {
    case 'pct':
      return `${v.toFixed(1)}%`
    case 'usd':
      return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    case 'hours':
      return `${String(v).padStart(2, '0')}:00`
    case 'ratio':
      return v.toFixed(1)
    case 'seconds':
      return `${Math.round(v)}s`
    default:
      return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1)
  }
}

function metricLine(m: ReportMetric): string {
  const delta = m.deltaPct === null ? (m.prev === null ? '' : ` (prev ${formatMetricValue(m.prev, m.unit)})`) : ` (${m.deltaPct > 0 ? '+' : ''}${m.deltaPct.toFixed(1)}% vs previous period)`
  return `${m.label}: ${formatMetricValue(m.value, m.unit)}${delta}`
}

function sectionLines(s: ReportSection): string[] {
  if (s.state !== 'ok') return [s.stateReason ?? 'No data']
  const lines = [s.note, ...s.insights.map((i) => `[${i.severity}] ${i.text}`), ...s.metrics.map(metricLine)]
  for (const t of s.tables) {
    lines.push(`${t.label}:`)
    for (const r of t.rows) lines.push('  ' + t.columns.map((c) => `${c.label} ${typeof r[c.key] === 'number' ? formatMetricValue(r[c.key] as number, c.unit ?? 'count') : (r[c.key] ?? 'n/a')}`).join(' · '))
  }
  return lines
}

/** First four headline metrics of the document, for the print one-pager. */
function kpis(doc: IntelligenceReportDoc): ReportKpi[] {
  const out: ReportKpi[] = []
  for (const s of doc.sections) {
    if (s.state !== 'ok') continue
    for (const m of s.metrics.slice(0, 2)) out.push({ label: m.label, value: formatMetricValue(m.value, m.unit), delta: m.deltaPct })
    if (out.length >= 4) break
  }
  return out.slice(0, 4)
}

export function toReportData(doc: IntelligenceReportDoc): ReportDataWithMeta {
  const base: ReportData = {
    workspaceId: doc.workspace.id,
    workspaceName: doc.platform ? `${doc.workspace.name} · ${doc.platform.charAt(0).toUpperCase()}${doc.platform.slice(1)}` : doc.workspace.name,
    workspaceSlug: slugify(doc.workspace.name),
    reportType: doc.scope === 'moderation' ? 'general' : 'community',
    periodStart: `${doc.period.start}T00:00:00.000Z`,
    periodEnd: `${doc.period.end}T00:00:00.000Z`,
    generatedAt: doc.generatedAt,
    summary: doc.summary.join(' '),
    sections: [
      ...doc.sections.map((s) => ({ title: s.title, lines: sectionLines(s) })),
      { title: 'Methodology & data gaps', lines: doc.methodology },
    ],
    recommendations: doc.recommendations.map((r) => `${r.title}, ${r.rationale}`),
    model: { type: doc.scope === 'moderation' ? 'general' : 'community', kpis: kpis(doc) },
  }
  return {
    ...base,
    uiKind: doc.platform ? 'single' : doc.scope === 'moderation' ? 'moderation' : 'overview',
    platform: doc.platform ?? undefined,
    platformLabel: doc.platform ? doc.platform.charAt(0).toUpperCase() + doc.platform.slice(1) : undefined,
  }
}
