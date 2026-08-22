import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, Loader2, Minus, Printer, RotateCw, Sparkles } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge, type BadgeTone } from '../ui/Badge'
import { useWorkspace } from '../../context/WorkspaceContext'
import {
  fetchIntelligenceReport,
  fetchIntelligenceReports,
  generateIntelligenceReport,
  type IntelligenceReportDoc,
  type IntelligenceReportListItem,
  type ReportInsight,
  type ReportMetric,
  type ReportPeriod,
  type ReportSection,
  type ReportSeries,
} from '../../lib/api/misc'

// Deterministic report: the server builds a fixed document (same sections,
// same metric ids every time) and this component only lays it out. Nothing
// here computes a number.

const PERIODS: { id: ReportPeriod; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
]

export function IntelligenceReport() {
  const { activeWorkspaceId } = useWorkspace()
  const [period, setPeriod] = useState<ReportPeriod>('30d')
  const [doc, setDoc] = useState<IntelligenceReportDoc | null>(null)
  const [history, setHistory] = useState<IntelligenceReportListItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      setHistory(await fetchIntelligenceReports(activeWorkspaceId))
    } catch {
      /* history is optional */
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    setDoc(null)
    void loadHistory()
  }, [loadHistory])

  const generate = async () => {
    if (!activeWorkspaceId) return
    setBusy(true)
    setError(null)
    try {
      const r = await generateIntelligenceReport(activeWorkspaceId, period)
      setDoc(r.report)
      void loadHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate the report')
    } finally {
      setBusy(false)
    }
  }

  const open = async (id: string) => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      setDoc((await fetchIntelligenceReport(activeWorkspaceId, id)).report)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]">
            <Sparkles size={22} className="text-[var(--accent-emerald)]" /> Intelligence Report
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Same structure every time; only the data changes. Every figure is computed from synced platform data for the period.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)} className="focus-ring h-10 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] outline-none hover:border-white/20" aria-label="Period">
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <Button onClick={generate} disabled={busy || !activeWorkspaceId}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />} Generate report
          </Button>
          {doc && (
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer size={16} /> Print / PDF
            </Button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      {!doc && (
        <Card className="p-8 text-center">
          <p className="text-[var(--text-secondary)]">Pick a period and generate the report. Previous reports stay available below.</p>
        </Card>
      )}

      {doc && <ReportView doc={doc} />}

      {history.length > 0 && (
        <Card className="p-5 print:hidden">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Previous reports</h2>
          <ul className="divide-y divide-[var(--border-card)]">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="font-medium text-[var(--text-primary)]">{h.periodKind}</span> · {h.periodStart} → {h.periodEnd}
                  <span className="ml-2 text-[var(--text-muted)]">{new Date(h.createdAt).toLocaleString()}</span>
                </span>
                <button onClick={() => open(h.id)} className="text-[var(--accent-emerald)] hover:underline">
                  Open
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

// ---- document -------------------------------------------------------------

function ReportView({ doc }: { doc: IntelligenceReportDoc }) {
  return (
    <article className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{doc.workspace.name}</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {doc.period.start} → {doc.period.end} ({doc.period.days} days), compared with {doc.period.prevStart} → {doc.period.prevEnd}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Generated {new Date(doc.generatedAt).toLocaleString()} · narrative: {doc.narrativeSource === 'llm' ? 'AI (validated)' : 'rules'}</p>
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
                          {fmtCell(r[c.key], c.unit)}
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
      <div className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{fmtValue(m.value, m.unit)}</div>
      {m.prev !== null && (
        <div className={`mt-0.5 flex items-center gap-1 text-xs ${tone}`}>
          <Arrow size={12} /> {d === null ? `prev ${fmtValue(m.prev, m.unit)}` : `${d > 0 ? '+' : ''}${d.toFixed(1)}% vs ${fmtValue(m.prev, m.unit)}`}
        </div>
      )}
    </div>
  )
}

/** Minimal dependency-free bar strip; enough for a printable report. */
function SeriesBars({ se }: { se: ReportSeries }) {
  if (se.points.length === 0) return null
  const max = Math.max(...se.points.map((p) => p.v), 1)
  return (
    <div className="mt-4">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{se.label}</h4>
      <div className="flex h-16 items-end gap-[2px]" role="img" aria-label={se.label}>
        {se.points.map((p) => (
          <div key={p.t} title={`${p.t}: ${fmtValue(p.v, se.unit)}`} className="flex-1 rounded-t bg-[var(--accent-emerald)]/70" style={{ height: `${Math.max(2, (p.v / max) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-[var(--text-muted)]">
        <span>{se.points[0]!.t}</span>
        <span>{se.points[se.points.length - 1]!.t}</span>
      </div>
    </div>
  )
}

function fmtValue(v: number | null, unit: ReportMetric['unit']): string {
  if (v === null) return '—'
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
function fmtCell(v: string | number | null, unit?: ReportMetric['unit']): string {
  if (v === null || v === undefined) return '—'
  return typeof v === 'number' ? fmtValue(v, unit ?? 'count') : v
}
