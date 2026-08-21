import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ReportData } from '../../../lib/reportBuilder'
import type { BarDatum, PieDatum } from '../../../lib/reportModel'
import { formatDelta, SAPPHIRE } from '../../../lib/reportModel'
import { formatCompactNumber, formatDay, formatLongDate } from '../../../lib/format'

/**
 * On-screen branded one-pager. This is the actual rendered PREVIEW that replaced
 * the old raw <pre> text block: sapphire top/bottom stripes, KPI row, and
 * recharts pies / area / bars chosen per the report model. Screen-only — the
 * print/PDF path renders through PrintableReport instead.
 */
export function ReportPreview({ data }: { data: ReportData }) {
  const { model } = data
  const typeLabel = data.reportType === 'community' ? 'Community Analytics Report' : 'General Report'
  const periodLabel = `${formatLongDate(data.periodStart)} – ${formatLongDate(data.periodEnd)}`

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)]">
      {/* TOP sapphire stripe */}
      <div className="h-2 w-full bg-gradient-to-r from-[var(--accent-purple)] via-[var(--accent-cyan)] to-[var(--accent-emerald-bright)]" />

      <div className="p-6 sm:p-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent-purple)] via-[var(--accent-cyan)] to-[var(--accent-emerald-bright)] text-lg font-extrabold text-white shadow-[var(--glow-emerald)]">
              C
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{typeLabel}</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                {data.workspaceName} · {periodLabel}
              </p>
            </div>
          </div>
          <span className="hidden shrink-0 rounded-full border border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/[0.08] px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--accent-emerald-bright)] sm:inline-block">
            {data.reportType === 'community' ? 'Community' : 'General'}
          </span>
        </div>

        {/* Executive summary */}
        <p className="mt-5 rounded-xl border border-[var(--border-card)] bg-white/[0.02] px-4 py-3 text-sm leading-relaxed text-slate-200">
          {data.summary}
        </p>

        {/* KPI row */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {model.kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">{kpi.label}</div>
              <div className="mt-1 text-xl font-bold text-white">{kpi.value}</div>
              {kpi.delta !== null && (
                <div className={`mt-0.5 text-xs font-medium ${kpi.delta >= 0 ? 'text-[var(--accent-emerald-bright)]' : 'text-red-400'}`}>
                  {formatDelta(kpi.delta)} vs last period
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {model.membersTrend && model.membersTrend.length > 1 && (
            <ChartCard title="Active Members Trend" note={`Last ${model.membersTrend.length} days`} className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={model.membersTrend} margin={{ top: 5, right: 10, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="reportMembersFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SAPPHIRE.cyan} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={SAPPHIRE.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickFormatter={formatDay} stroke="var(--text-secondary)" tick={{ fontSize: 11 }} minTickGap={28} />
                  <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} tickFormatter={formatCompactNumber} width={44} />
                  <Tooltip content={<TrendTooltip />} />
                  <Area type="monotone" dataKey="value" stroke={SAPPHIRE.cyan} strokeWidth={2.5} fill="url(#reportMembersFill)" dot={false} activeDot={{ r: 4, fill: SAPPHIRE.cyan }} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {model.messagesTrend && model.messagesTrend.length > 1 && (
            <ChartCard title="Daily Messages Volume" note={`Last ${model.messagesTrend.length} days`} className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={model.messagesTrend} margin={{ top: 5, right: 10, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="reportBarFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SAPPHIRE.mid} />
                      <stop offset="55%" stopColor={SAPPHIRE.cyan} />
                      <stop offset="100%" stopColor={SAPPHIRE.deep} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickFormatter={formatDay} stroke="var(--text-secondary)" tick={{ fontSize: 11 }} minTickGap={20} />
                  <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} tickFormatter={formatCompactNumber} width={44} />
                  <Tooltip content={<TrendTooltip />} cursor={{ fill: 'rgba(120,170,255,0.10)', radius: 4 }} />
                  <Bar dataKey="value" fill="url(#reportBarFill)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {model.incidentsByType && (
            <ChartCard title="Incidents by Type" note="Moderation activity in period">
              <PieBlock data={model.incidentsByType} />
            </ChartCard>
          )}

          {model.incidentsResolution && (
            <ChartCard title="Incident Resolution" note="Resolved vs. open">
              <PieBlock data={model.incidentsResolution} donut />
            </ChartCard>
          )}

          {model.moderatorShare && (
            <ChartCard title="Moderator Activity Share" note={model.moderatorMoneyLabel ?? 'Points share by moderator'}>
              <PieBlock data={model.moderatorShare} valueSuffix=" pts" />
            </ChartCard>
          )}

          {model.moderatorByPlatform && (
            <ChartCard title="Moderator Points by Platform" note="Where the work happens">
              <BarBlock data={model.moderatorByPlatform} />
            </ChartCard>
          )}

          {model.paymentsByModerator && (
            <ChartCard title="Payments by Moderator" note={model.paymentsTotalLabel ?? 'Payout distribution'}>
              <PieBlock data={model.paymentsByModerator} />
            </ChartCard>
          )}

          {model.tasksByStatus && (
            <ChartCard title="Tasks by Status" note="Delivery snapshot">
              <PieBlock data={model.tasksByStatus} donut />
            </ChartCard>
          )}

          {model.kolByChannel && (
            <ChartCard title="KOL Reach by Channel" note="Share of total partner reach">
              <PieBlock data={model.kolByChannel} />
            </ChartCard>
          )}
        </div>

        {/* Recommendations */}
        {data.recommendations.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--accent-emerald-bright)]">Recommendations</h3>
            <ul className="flex flex-col gap-2">
              {data.recommendations.map((r, i) => (
                <li key={i} className="rounded-lg border border-[var(--accent-emerald)]/25 bg-[var(--accent-emerald)]/[0.07] px-4 py-2.5 text-sm text-slate-200">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 text-center text-xs text-[var(--text-muted)]">
          Generated by Catch · {formatLongDate(data.generatedAt)}
        </div>
      </div>

      {/* BOTTOM sapphire stripe */}
      <div className="h-2 w-full bg-gradient-to-r from-[var(--accent-emerald-bright)] via-[var(--accent-cyan)] to-[var(--accent-purple)]" />
    </div>
  )
}

function ChartCard({ title, note, className = '', children }: { title: string; note?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border border-[var(--border-card)] bg-white/[0.015] p-4 ${className}`}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {note && <p className="text-xs text-[var(--text-secondary)]">{note}</p>}
      </div>
      {children}
    </div>
  )
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null
  return (
    <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 text-[var(--text-secondary)]">{formatDay(label)}</div>
      <div className="font-semibold text-white">{formatCompactNumber(payload[0].value)}</div>
    </div>
  )
}

function PieTooltip({ active, payload, suffix }: { active?: boolean; payload?: { name: string; value: number }[]; suffix?: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold text-white">{p.name}</div>
      <div className="text-[var(--text-secondary)]">{formatCompactNumber(p.value)}{suffix ?? ''}</div>
    </div>
  )
}

function PieBlock({ data, donut = false, valueSuffix }: { data: PieDatum[]; donut?: boolean; valueSuffix?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="flex items-center gap-3">
      <div className="h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={donut ? 42 : 0}
              outerRadius={68}
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="var(--bg-card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.label} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<PieTooltip suffix={valueSuffix} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((d) => {
          const share = total > 0 ? Math.round((d.value / total) * 100) : 0
          return (
            <li key={d.label} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="min-w-0 flex-1 truncate text-slate-300">{d.label}</span>
              <span className="shrink-0 font-medium text-white">{share}%</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function BarBlock({ data }: { data: BarDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
        <XAxis type="number" hide tickFormatter={formatCompactNumber} />
        <YAxis type="category" dataKey="label" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} width={72} />
        <Tooltip content={<PieTooltip suffix=" pts" />} cursor={{ fill: 'rgba(120,170,255,0.08)' }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
