import type { CSSProperties } from 'react'
import type { ReportData } from '../../../lib/reportBuilder'
import type { PieDatum } from '../../../lib/reportModel'
import { formatDelta } from '../../../lib/reportModel'
import { formatLongDate } from '../../../lib/format'

// Force background colors (the sapphire stripes) to actually render in the
// printed/PDF output — browsers skip backgrounds by default.
const printColor: CSSProperties = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as CSSProperties

const STRIPE: CSSProperties = {
  ...printColor,
  height: '8px',
  background: 'linear-gradient(90deg, #1e3a8a, #2f7cf6, #8cc5ff)',
}

/**
 * Rendered off-screen at all times (`hidden print:block`) — this is what
 * `window.print()` actually captures. Everything else in the app carries a
 * matching `print:hidden` so only this shows up in the printed/PDF output.
 * Branded to the sapphire palette: top/bottom stripes, KPI row and pure-SVG
 * donuts (recharts needs a measured viewport it doesn't reliably get in print).
 */
export function PrintableReport({ data }: { data: ReportData | null }) {
  if (!data) return null
  // `model` may be absent on report snapshots saved before it was introduced —
  // fall back to KPI-less text so Download PDF still works for old history rows.
  const model = data.model
  const typeLabel = data.reportType === 'community' ? 'Community Analytics Report' : 'General Report'

  const pies: { title: string; data: PieDatum[] }[] = (
    model
      ? [
          model.incidentsByType && { title: 'Incidents by type', data: model.incidentsByType },
          model.incidentsResolution && { title: 'Incident resolution', data: model.incidentsResolution },
          model.moderatorShare && { title: 'Moderator activity share', data: model.moderatorShare },
          model.paymentsByModerator && { title: 'Payments by moderator', data: model.paymentsByModerator },
          model.tasksByStatus && { title: 'Tasks by status', data: model.tasksByStatus },
          model.kolByChannel && { title: 'KOL reach by channel', data: model.kolByChannel },
        ]
      : []
  ).filter(Boolean) as { title: string; data: PieDatum[] }[]

  return (
    <div className="hidden print:block print:bg-white print:text-black">
      <div style={STRIPE} />

      <div className="px-1 pt-5">
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-lg font-extrabold text-white"
            style={{ ...printColor, background: 'linear-gradient(135deg, #1e3a8a, #2f7cf6, #8cc5ff)' }}
          >
            C
          </div>
          <div>
            <div className="text-xl font-bold" style={{ color: '#14276b' }}>
              Catch — {typeLabel}
            </div>
            <div className="text-sm text-black/70">
              {data.workspaceName} · {formatLongDate(data.periodStart)} – {formatLongDate(data.periodEnd)}
            </div>
          </div>
        </div>

        {/* KPI row */}
        {model && (
        <div className="mb-5 grid grid-cols-4 gap-3">
          {model.kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-lg border border-black/15 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-black/50">{kpi.label}</div>
              <div className="text-lg font-bold text-black">{kpi.value}</div>
              {kpi.delta !== null && (
                <div className="text-[11px] font-medium" style={{ color: kpi.delta >= 0 ? '#1d4ed8' : '#b91c1c' }}>
                  {formatDelta(kpi.delta)}
                </div>
              )}
            </div>
          ))}
        </div>
        )}

        <section className="mb-5">
          <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: '#2f7cf6' }}>
            Executive Summary
          </h2>
          <p className="text-sm leading-relaxed text-black/85">{data.summary}</p>
        </section>

        {/* Donut grid */}
        {pies.length > 0 && (
          <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4">
            {pies.map((p) => (
              <Donut key={p.title} title={p.title} data={p.data} />
            ))}
          </div>
        )}

        {/* Text sections kept for completeness (compact) */}
        {data.sections.map((section) => (
          <section key={section.title} className="mb-4">
            <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: '#2f7cf6' }}>
              {section.title}
            </h2>
            <ul className="list-disc pl-5 text-sm leading-relaxed text-black/85">
              {section.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        ))}

        <section className="mb-5">
          <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: '#2f7cf6' }}>
            Recommendations
          </h2>
          <ul className="list-disc pl-5 text-sm leading-relaxed text-black/85">
            {data.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      </div>

      <div style={STRIPE} />

      <div className="report-print-footer fixed inset-x-0 bottom-0 border-t border-black/20 px-2 py-2 text-center text-[10px] text-black/70">
        Catch — {typeLabel} · {data.workspaceName} · Generated {formatLongDate(data.generatedAt)}
      </div>
    </div>
  )
}

/** Pure-SVG donut + legend (no recharts) for reliable print rendering. */
function Donut({ title, data }: { title: string; data: PieDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = 26
  const c = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="flex items-center gap-3">
      <svg width="72" height="72" viewBox="0 0 72 72" style={printColor}>
        <g transform="rotate(-90 36 36)">
          {total === 0 ? (
            <circle cx="36" cy="36" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
          ) : (
            data.map((d) => {
              const len = (d.value / total) * c
              const dash = `${len} ${c - len}`
              const seg = (
                <circle
                  key={d.label}
                  cx="36"
                  cy="36"
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth="12"
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                />
              )
              offset += len
              return seg
            })
          )}
        </g>
      </svg>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: '#14276b' }}>
          {title}
        </div>
        <ul className="space-y-0.5">
          {data.map((d) => {
            const share = total > 0 ? Math.round((d.value / total) * 100) : 0
            return (
              <li key={d.label} className="flex items-center gap-1.5 text-[11px] text-black/80">
                <span className="inline-block h-2 w-2 rounded-full" style={{ ...printColor, backgroundColor: d.color }} />
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                <span className="font-medium">{share}%</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
