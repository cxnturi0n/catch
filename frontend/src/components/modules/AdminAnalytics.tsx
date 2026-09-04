import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { fetchAdminAnalytics, pct, type AdminAnalytics as Data } from '../../lib/adminAnalytics'

// Per-source gradient palette from the Sapphire handoff (§ "Per-source series").
const SERIES: Record<string, { from: string; to: string; solid: string }> = {
  discord: { from: '#5B8CFF', to: '#3F7BFF', solid: '#7EA6FF' },
  telegram: { from: '#5FD8F5', to: '#37D0F0', solid: '#5FD8F5' },
  zealy: { from: '#B0A2FF', to: '#7B62F0', solid: '#B0A2FF' },
  galxe: { from: '#FF8F7F', to: '#C4553F', solid: '#FF8F7F' },
  twitter: { from: '#8E9BBA', to: '#66739A', solid: '#8E9BBA' },
}

/** Glass card with the 1px top light filament, per the handoff card recipe. */
function Panel({ children, className = '', pad = 'p-[22px]' }: { children: React.ReactNode; className?: string; pad?: string }) {
  return (
    <div className={`glass relative overflow-hidden rounded-[18px] ${pad} ${className}`}>
      <div
        className="pointer-events-none absolute inset-x-[22px] top-0 h-px"
        style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)' }}
      />
      {children}
    </div>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{children}</div>
  )
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[15px] font-bold text-[var(--text-primary)]">{children}</h3>
}

function KpiTile({ eyebrow, value, sub }: { eyebrow: string; value: string; sub: string }) {
  return (
    <Panel pad="p-[18px]">
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="mt-3 font-mono text-[32px] font-bold leading-none tracking-[-0.03em] text-[var(--text-primary)]">{value}</div>
      <div className="mt-3 font-mono text-[11px] text-[var(--text-muted)]">{sub}</div>
    </Panel>
  )
}

function AdoptionRow({ label, count, total }: { label: string; count: number; total: number }) {
  const p = pct(count, total)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">{label}</span>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          {count}/{total} · {p}%
        </span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full"
          style={{ width: `${p}%`, background: 'linear-gradient(90deg,#5B8CFF,#37D0F0)', boxShadow: '0 0 12px rgba(91,140,255,.5)' }}
        />
      </div>
    </div>
  )
}

function IntegrationRow({ label, count, max }: { label: string; count: number; max: number }) {
  const key = label.toLowerCase()
  const s = SERIES[key] ?? SERIES.twitter
  const w = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="grid grid-cols-[90px_1fr_42px] items-center gap-3">
      <span className="text-[13px] capitalize text-[var(--text-secondary)]">{label}</span>
      <div className="h-[22px] overflow-hidden rounded-[7px] bg-white/[0.05]">
        <div
          className="h-full rounded-[7px]"
          style={{ width: `${w}%`, background: `linear-gradient(90deg,${s.from},${s.to})`, boxShadow: `0 0 18px ${s.solid}66` }}
        />
      </div>
      <span className="text-right font-mono text-[13px] font-bold text-[var(--text-primary)]">{count}</span>
    </div>
  )
}

export function AdminAnalytics() {
  const { user } = useAuth()
  const isOwner = user?.role === 'admin'

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetchAdminAnalytics()
    if (res.status === 'ok') setData(res.data)
    else if (res.status === 'forbidden') setError('forbidden')
    else setError(res.error)
    setLoading(false)
  }

  useEffect(() => {
    if (isOwner) void load()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner])

  // Non-owner accounts never see this page at all, redirect away before render.
  // (Defence-in-depth: the nav hides the link and the edge function 403s them too.)
  if (!isOwner) return <Navigate to="/dashboard/analytics" replace />

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-[var(--text-secondary)]">
        <Loader2 size={18} className="animate-spin" /> Loading platform analytics…
      </div>
    )
  }
  if (error === 'forbidden') {
    return (
      <div className="rounded-[18px] border border-amber-500/40 bg-amber-500/[0.08] p-6 text-sm text-amber-200">
        The analytics function rejected this session. Sign in as the owner account, then retry.
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-[18px] border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error ?? 'No data.'}, the edge function may not be deployed yet.
        </div>
        <button onClick={load} className="self-start rounded-[11px] border border-[var(--border-card)] bg-white/[0.04] px-3 py-1.5 text-sm text-[var(--text-primary)]">
          Retry
        </button>
      </div>
    )
  }

  const paid = data.users.byPlan.pro + data.users.byPlan.agency + data.users.byPlan.enterprise
  const intEntries = Object.entries(data.integrations.connectedByPlatform)
  const intMax = Math.max(1, ...intEntries.map(([, v]) => v))
  const nowClock = new Date(data.generatedAt).toLocaleTimeString('en-GB', { hour12: false })
  const planData = Object.entries(data.users.byPlan).map(([label, value]) => ({ label, value }))

  return (
    <div className="flex flex-col gap-4">
      {/* 4-up KPI grid */}
      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile eyebrow="Total users" value={String(data.users.total)} sub={`${paid} on paid plans`} />
        <KpiTile eyebrow="Workspaces" value={String(data.workspaces.total)} sub={`+${data.workspaces.new30d} in last 30 days`} />
        <KpiTile
          eyebrow="Live integrations"
          value={String(data.integrations.totalConnected)}
          sub={data.integrations.staleSyncs > 0 ? `${data.integrations.staleSyncs} stale (>25h)` : 'all syncing'}
        />
        <KpiTile
          eyebrow="Discovery leads"
          value={String(data.leads.discoveryResponses)}
          sub={data.leads.avgCompletionMs ? `~${Math.round(data.leads.avgCompletionMs / 1000)}s avg completion` : 'no completions yet'}
        />
      </div>

      {/* 2-up split: feature adoption | connected integrations */}
      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
        <Panel>
          <CardTitle>Feature adoption</CardTitle>
          <div className="mt-5 flex flex-col gap-[18px]">
            <AdoptionRow label="Moderators" count={data.adoption.withModerators} total={data.adoption.total} />
            <AdoptionRow label="Compensation" count={data.adoption.withCompensation} total={data.adoption.total} />
            <AdoptionRow label="Payments" count={data.adoption.withPayments} total={data.adoption.total} />
            <AdoptionRow label="Resources" count={data.adoption.withResources} total={data.adoption.total} />
            <AdoptionRow label="Meetings" count={data.adoption.withMeetings} total={data.adoption.total} />
            <AdoptionRow label="Content scheduling" count={data.adoption.withContent} total={data.adoption.total} />
          </div>
        </Panel>

        <Panel>
          <CardTitle>Connected integrations by platform</CardTitle>
          {intEntries.length > 0 ? (
            <div className="mt-5 flex flex-col gap-[18px]">
              {intEntries
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => (
                  <IntegrationRow key={label} label={label} count={count} max={intMax} />
                ))}
            </div>
          ) : (
            <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">No integrations connected yet.</p>
          )}
          <div className="mt-6 flex items-center gap-2 border-t border-white/[0.06] pt-4">
            <span className="h-[6px] w-[6px] rounded-full bg-[#3EE0A0] shadow-[0_0_8px_#3EE0A0]" style={{ animation: 'breathe 2.4s ease-in-out infinite' }} />
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              {data.integrations.totalConnected} integration{data.integrations.totalConnected === 1 ? '' : 's'} syncing · updated {nowClock}
            </span>
          </div>
        </Panel>
      </div>

      {/* Secondary: signups + plan distribution */}
      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
        <Panel>
          <CardTitle>Signups · last 30 days</CardTitle>
          {data.users.signups30d.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data.users.signups30d} margin={{ top: 16, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="adminSignups" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5B8CFF" stopOpacity={0.42} />
                    <stop offset="100%" stopColor="#5B8CFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,.06)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} />
                <Tooltip contentStyle={{ background: 'rgba(10,16,36,.86)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12 }} />
                <Area type="monotone" dataKey="count" stroke="#8FB2FF" strokeWidth={2.5} fill="url(#adminSignups)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">No signups in the last 30 days.</p>
          )}
        </Panel>

        <Panel>
          <CardTitle>Users by plan</CardTitle>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={planData} margin={{ top: 16, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} />
              <Tooltip contentStyle={{ background: 'rgba(10,16,36,.86)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12 }} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
              <Bar dataKey="value" fill="#5B8CFF" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* AI spend and volume, last 30 days */}
      {data.ai && (
        <Panel>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>AI usage, last 30 days</CardTitle>
            <span className="font-mono text-[12px] text-[var(--text-secondary)]">
              {data.ai.totalCalls} calls · est. ${data.ai.totalUsd.toFixed(2)}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.ai.byDay}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#7E8AA6' }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: '#7E8AA6' }} width={40} tickFormatter={(v: number) => `$${v}`} />
                  <Tooltip formatter={(v) => [`$${Number(v).toFixed(3)}`, "est. cost"]} contentStyle={{ background: '#0c1424', border: '1px solid #1c2b47', borderRadius: 10, fontSize: 12 }} />
                  <Bar dataKey="usd" fill="#E6B84D" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3">
              <div>
                <Eyebrow>By feature</Eyebrow>
                <ul className="mt-1 space-y-1 text-[13px]">
                  {data.ai.byType.map((t) => (
                    <li key={t.type} className="flex justify-between gap-3">
                      <span className="text-[var(--text-secondary)]">{t.type.replace(/^ai_/, '').replace(/_/g, ' ')}</span>
                      <span className="font-mono text-[var(--text-primary)]">
                        {t.calls} · {Math.round(t.tokens / 1000)}k tok · ${t.usd.toFixed(2)}
                      </span>
                    </li>
                  ))}
                  {data.ai.byType.length === 0 && <li className="text-[var(--text-muted)]">No AI calls yet.</li>}
                </ul>
              </div>
              {data.ai.topWorkspaces.length > 0 && (
                <div>
                  <Eyebrow>Top workspaces</Eyebrow>
                  <ul className="mt-1 space-y-1 text-[13px]">
                    {data.ai.topWorkspaces.slice(0, 5).map((w) => (
                      <li key={w.workspaceId ?? w.name} className="flex justify-between gap-3">
                        <span className="truncate text-[var(--text-secondary)]">{w.name}</span>
                        <span className="font-mono text-[var(--text-primary)]">
                          {w.calls} · ${w.usd.toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </Panel>
      )}

      {/* Content volume strip */}
      <Panel>
        <CardTitle>Content across the platform</CardTitle>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: 'Moderators', value: data.content.moderators },
            { label: 'Tasks', value: data.content.tasks },
            { label: 'KOLs', value: data.content.kols },
            { label: 'Resources', value: data.content.resources },
            { label: 'Folders', value: data.content.folders },
            { label: 'Payments', value: data.content.payments },
            { label: 'Meetings', value: data.content.meetings },
            { label: 'Scheduled content', value: data.content.contentScheduled },
            { label: 'Feedback', value: data.feedback.total },
            { label: 'Pending feedback', value: data.feedback.pending },
          ].map((c) => (
            <div key={c.label} className="rounded-[12px] bg-white/[0.04] p-3">
              <Eyebrow>{c.label}</Eyebrow>
              <div className="mt-1 font-mono text-[20px] font-bold text-[var(--text-primary)]">{c.value}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
