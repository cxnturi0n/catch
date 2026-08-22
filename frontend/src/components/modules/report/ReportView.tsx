import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, Minus } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Badge, type BadgeTone } from '../../ui/Badge'
import type { IntelligenceReportDoc, ReportInsight, ReportMetric, ReportSection, ReportSeries } from '../../../lib/api/misc'
import { formatMetricValue } from '../../../lib/intelligenceReport'

// Lays out the server-built report. The document's structure is fixed by the
// backend (same sections and metric ids every time); nothing here computes a
// number.

export function ReportView({ doc }: { doc: IntelligenceReportDoc }) {
  return (
    <article className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">
              {doc.workspace.name}
              {doc.platform && <span className="text-[var(--text-secondary)]"> · {doc.platform}</span>}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {doc.period.start} → {doc.period.end} ({doc.period.days} days), compared with {doc.period.prevStart} → {doc.period.prevEnd}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Generated {new Date(doc.generatedAt).toLocaleString()} · {doc.scope} · narrative: {doc.narrativeSource === 'llm' ? 'AI (validated)' : 'rules'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {doc.coverage.platforms.map((p) => (
              <Badge key={p.platform} tone={p.status === 'connected' ? 'green' : 'gray'}>
                {p.platform}
              </Badge>
            ))}
            <Badge tone="blue" dot={false}>
              {doc.coverage.daysWithData}/{doc.coverage.periodDays} days with data
            </Badge>
          </div>
        </div>
        <h3 className="mt-5 text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Executive summary</h3>
        <ul className="mt-2 space-y-1.5">
          {doc.summary.map((s, i) => (
            <li key={i} className="flex gap-2 text-[15px] text-[var(--text-primary)]">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-emerald)]" />
              {s}
            </li>
          ))}
        </ul>
      </Card>

      {doc.sections.map((s) => (
        <SectionView key={s.id} s={s} />
      ))}

      <Card className="p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Recommendations</h3>
        {doc.recommendations.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Nothing crossed a threshold this period.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {doc.recommendations.map((r, i) => (
              <li key={r.id} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-primary)]">{i + 1}</span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--text-primary)]">{r.title}</span>
                    <Badge tone={r.priority === 'high' ? 'red' : r.priority === 'medium' ? 'yellow' : 'gray'} dot={false}>
                      {r.priority}
                    </Badge>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)]">{r.rationale}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">based on {r.metricIds.join(', ')}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Methodology & data gaps</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
          {doc.methodology.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </Card>
    </article>
  )
}

const STATE_LABEL: Record<ReportSection['state'], string> = { ok: '', no_data: 'No data', not_connected: 'Not connected', not_available: 'Not available yet' }

function SectionView({ s }: { s: ReportSection }) {
  return (
    <Card className="p-6 print:break-inside-avoid">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">{s.title}</h3>
        {s.state !== 'ok' && (
          <Badge tone="gray" dot={false}>
            {STATE_LABEL[s.state]}
          </Badge>
        )}
      </div>
      {s.state !== 'ok' ? (
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{s.stateReason}</p>
      ) : (
        <>
          <p className="mt-2 text-[15px] text-[var(--text-primary)]">{s.note}</p>
          {s.insights.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {s.insights.map((i) => (
                <InsightRow key={i.id} i={i} />
              ))}
            </ul>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {s.metrics.map((m) => (
              <MetricTile key={m.id} m={m} />
            ))}
          </div>
          {s.series.map((se) => (
            <SeriesBars key={se.id} se={se} />
          ))}
          {s.tables.map((t) => (
            <div key={t.id} className="mt-4 overflow-x-auto">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{t.label}</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-muted)]">
                    {t.columns.map((c) => (
                      <th key={c.key} className="py-1 pr-4 font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r, i) => (
                    <tr key={i} className="border-t border-[var(--border-card)]">
                      {t.columns.map((c) => (
                        <td key={c.key} className="py-1.5 pr-4 text-[var(--text-primary)]">
                          {r[c.key] === null || r[c.key] === undefined ? '—' : typeof r[c.key] === 'number' ? formatMetricValue(r[c.key] as number, c.unit ?? 'count') : String(r[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </Card>
  )
}

const SEVERITY: Record<ReportInsight['severity'], { tone: BadgeTone; Icon: typeof Info }> = {
  critical: { tone: 'red', Icon: AlertTriangle },
  warning: { tone: 'yellow', Icon: AlertTriangle },
  positive: { tone: 'green', Icon: CheckCircle2 },
  info: { tone: 'blue', Icon: Info },
}

function InsightRow({ i }: { i: ReportInsight }) {
  const { tone, Icon } = SEVERITY[i.severity]
  return (
    <li className="flex items-start gap-2 text-sm">
      <Badge tone={tone} dot={false}>
        <Icon size={12} /> {i.severity}
      </Badge>
      <span className="text-[var(--text-secondary)]">{i.text}</span>
    </li>
  )
}

function MetricTile({ m }: { m: ReportMetric }) {
  const d = m.deltaPct
  const Arrow = d === null ? Minus : d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus
  const tone = d === null || d === 0 ? 'text-[var(--text-muted)]' : d > 0 ? 'text-emerald-400' : 'text-red-400'
  return (
    <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-elevated)] p-3">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{m.label}</div>
      <div className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{formatMetricValue(m.value, m.unit)}</div>
      {m.prev !== null && (
        <div className={`mt-0.5 flex items-center gap-1 text-xs ${tone}`}>
          <Arrow size={12} /> {d === null ? `prev ${formatMetricValue(m.prev, m.unit)}` : `${d > 0 ? '+' : ''}${d.toFixed(1)}% vs ${formatMetricValue(m.prev, m.unit)}`}
        </div>
      )}
    </div>
  )
}

/** Dependency-free bar strip; enough for a printable report. */
function SeriesBars({ se }: { se: ReportSeries }) {
  if (se.points.length === 0) return null
  const values = se.points.map((p) => p.v)
  const max = Math.max(...values, 1)
  // Membership series move a few percent over a period: scale from the
  // minimum so the trend is visible, and say so in the label.
  const min = Math.min(...values)
  const zoom = se.id.startsWith('growth.') && min > 0 && (max - min) / max < 0.2
  const floor = zoom ? min * 0.98 : 0
  return (
    <div className="mt-4">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        {se.label}
        {zoom && <span className="ml-2 normal-case tracking-normal text-[var(--text-muted)]">(axis from {formatMetricValue(Math.round(floor), se.unit)})</span>}
      </h4>
      <div className="flex h-16 items-end gap-[2px]" role="img" aria-label={se.label}>
        {se.points.map((p) => (
          <div key={p.t} title={`${p.t}: ${formatMetricValue(p.v, se.unit)}`} className="flex-1 rounded-t bg-[var(--accent-emerald)]/70" style={{ height: `${Math.max(2, ((p.v - floor) / (max - floor || 1)) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-[var(--text-muted)]">
        <span>{se.points[0]!.t}</span>
        <span>{se.points[se.points.length - 1]!.t}</span>
      </div>
    </div>
  )
}
