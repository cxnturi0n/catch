import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import { AtSign, Coins, Loader2, Plus, Settings2, Sparkles, Trash2, Users, Wallet, Zap, PencilLine } from 'lucide-react'
import type { CompCurrency, ConversionConfig, Moderator, PointsMetric } from '../../../types'
import {
  deletePointsMetric,
  fetchConversionConfig,
  fetchMemberMessages,
  fetchModeratorMetrics,
  fetchPointsConfig,
  seedPointsConfig,
  upsertConversionConfig,
  upsertModeratorMetric,
  upsertPointsMetric,
  type MemberMessageStat,
} from '../../../lib/db'
import { useWorkspace } from '../../../context/WorkspaceContext'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { Modal } from '../../ui/Modal'
import { Badge } from '../../ui/Badge'
import { SplitPane } from '../../ui/SplitPane'
import { XMetricsImportModal } from './XMetricsImportModal'
import {
  CURRENCY_OPTIONS,
  DEFAULT_POINTS_METRICS,
  PLATFORM_TONE,
  SUPPORTED_METRICS,
  cellKey,
  formatMoney,
  formatPoints,
  metricMeta,
  parseAmount,
  platformOf,
  type SupportedMetric,
} from './comp'

function numStr(n: number): string {
  return Number.isFinite(n) ? String(n) : '0'
}

function normHandle(h: string): string {
  const t = h.trim().toLowerCase()
  if (!t) return ''
  return t.startsWith('@') ? t : `@${t}`
}

const DEFAULT_CONVERSION: ConversionConfig = { rate: 0.01, currency: 'USD' }

/** Small platform badge shown next to every metric (X / Telegram / Discord). */
function MetricLabel({ metricKey, label }: { metricKey: string; label: string }) {
  const p = platformOf(metricKey)
  return (
    <span className="inline-flex items-center gap-2">
      {p && <Badge tone={PLATFORM_TONE[p]}>{p}</Badge>}
      <span>{label}</span>
    </span>
  )
}

export function CompensationTab({ moderators }: { moderators: Moderator[] }) {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [metrics, setMetrics] = useState<PointsMetric[]>([])
  const [conversion, setConversion] = useState<ConversionConfig>(DEFAULT_CONVERSION)
  const [values, setValues] = useState<Record<string, number>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [memberStats, setMemberStats] = useState<MemberMessageStat[]>([])
  const [loading, setLoading] = useState(true)

  const [addOpen, setAddOpen] = useState(false)
  const [xImportOpen, setXImportOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<PointsMetric | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setDrafts({})
      setMemberStats([])

      if (!user) {
        if (cancelled) return
        setMetrics(DEFAULT_POINTS_METRICS.map((m, i) => ({ id: `local-${i}`, ...m })))
        setConversion(DEFAULT_CONVERSION)
        setValues({})
        setLoading(false)
        return
      }

      try {
        let catalog = await fetchPointsConfig(activeWorkspaceId)
        if (catalog.length === 0) catalog = await seedPointsConfig(activeWorkspaceId, DEFAULT_POINTS_METRICS)
        let conv = await fetchConversionConfig(activeWorkspaceId)
        if (!conv) conv = await upsertConversionConfig(activeWorkspaceId, DEFAULT_CONVERSION)
        const metricValues = await fetchModeratorMetrics(activeWorkspaceId)
        // Best-effort: Telegram messages-per-member feed the auto tg_messages column.
        const members = await fetchMemberMessages(activeWorkspaceId).catch(() => [] as MemberMessageStat[])
        if (cancelled) return
        setMetrics(catalog)
        setConversion(conv)
        const map: Record<string, number> = {}
        for (const v of metricValues) map[cellKey(v.moderatorId, v.metricKey)] = v.value
        setValues(map)
        setMemberStats(members)
      } catch {
        if (cancelled) return
        setMetrics(DEFAULT_POINTS_METRICS.map((m, i) => ({ id: `local-${i}`, ...m })))
        setConversion(DEFAULT_CONVERSION)
        setValues({})
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, user])

  // ── Auto-fill: integration-derived value per (moderator, auto metric) ──
  // Today only Telegram exposes a per-member breakdown (member_messages), which
  // we attribute to a moderator by matching their Telegram handle. Discord's
  // platform_metrics is workspace-level only, so dc_* stays manual until a
  // per-moderator source exists. Auto values are a display default — any stored
  // value in `values` (a CM override) always wins, so nothing is double-counted.
  const autoValues = useMemo(() => {
    const out: Record<string, number> = {}
    if (memberStats.length === 0) return out
    const byHandle = new Map<string, number>()
    for (const s of memberStats) byHandle.set(normHandle(s.displayName), (byHandle.get(normHandle(s.displayName)) ?? 0) + s.messages)
    for (const mod of moderators) {
      const handle = normHandle(mod.telegramHandle)
      if (!handle) continue
      const msgs = byHandle.get(handle)
      if (msgs != null) out[cellKey(mod.id, 'tg_messages')] = msgs
    }
    return out
  }, [memberStats, moderators])

  const effectiveRate = drafts.rate !== undefined ? parseAmount(drafts.rate) : conversion.rate

  function effectivePoints(m: PointsMetric): number {
    const d = drafts[`points::${m.metricKey}`]
    return d !== undefined ? parseAmount(d) : m.points
  }

  function effectiveValue(moderatorId: string, metricKey: string): number {
    const key = cellKey(moderatorId, metricKey)
    const d = drafts[`cell::${key}`]
    if (d !== undefined) return parseAmount(d)
    if (key in values) return values[key]
    if (key in autoValues) return autoValues[key]
    return 0
  }

  /** True when the shown value is an integration-derived default (no CM override yet). */
  function isAutoFilled(moderatorId: string, metricKey: string): boolean {
    const key = cellKey(moderatorId, metricKey)
    return drafts[`cell::${key}`] === undefined && !(key in values) && key in autoValues
  }

  function pointsFor(moderatorId: string): number {
    let total = 0
    for (const m of metrics) total += effectiveValue(moderatorId, m.metricKey) * effectivePoints(m)
    return total
  }

  const grandTotals = useMemo(() => {
    let points = 0
    let money = 0
    for (const mod of moderators) {
      const p = pointsFor(mod.id)
      points += p
      money += p * effectiveRate
    }
    return { points, money }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderators, metrics, values, drafts, conversion, autoValues])

  function draftProps(key: string, current: number, commit: (n: number) => void) {
    return {
      value: drafts[key] !== undefined ? drafts[key] : numStr(current),
      onFocus: () => setDrafts((d) => ({ ...d, [key]: numStr(current) })),
      onChange: (e: ChangeEvent<HTMLInputElement>) => setDrafts((d) => ({ ...d, [key]: e.target.value })),
      onBlur: () => {
        const raw = drafts[key]
        const n = raw !== undefined ? parseAmount(raw) : current
        setDrafts((d) => {
          const next = { ...d }
          delete next[key]
          return next
        })
        commit(n)
      },
    }
  }

  function commitRate(rate: number) {
    setConversion((c) => ({ ...c, rate }))
    if (!user) return
    void upsertConversionConfig(activeWorkspaceId, { rate, currency: conversion.currency }).catch(() =>
      showToast('Failed to save conversion rate', 'error'),
    )
  }

  function changeCurrency(currency: CompCurrency) {
    setConversion((c) => ({ ...c, currency }))
    if (!user) return
    void upsertConversionConfig(activeWorkspaceId, { rate: conversion.rate, currency }).catch(() =>
      showToast('Failed to save currency', 'error'),
    )
  }

  function commitMetricPoints(metric: PointsMetric, points: number) {
    setMetrics((ms) => ms.map((x) => (x.metricKey === metric.metricKey ? { ...x, points } : x)))
    if (!user) return
    void upsertPointsMetric(activeWorkspaceId, { metricKey: metric.metricKey, label: metric.label, points }).catch(() =>
      showToast('Failed to save points', 'error'),
    )
  }

  function commitCell(moderator: Moderator, metric: PointsMetric, value: number) {
    const key = cellKey(moderator.id, metric.metricKey)
    setValues((v) => ({ ...v, [key]: value }))
    if (!user) return
    void upsertModeratorMetric(activeWorkspaceId, moderator.id, metric.metricKey, value).catch(() =>
      showToast('Failed to save metric', 'error'),
    )
  }

  async function handleAddSupported(s: SupportedMetric) {
    if (metrics.some((m) => m.metricKey === s.metricKey)) return
    if (!user) {
      setMetrics((ms) => [...ms, { id: `local-${Date.now()}`, metricKey: s.metricKey, label: s.label, points: s.defaultPoints }])
      showToast('Metric added')
      return
    }
    try {
      const created = await upsertPointsMetric(activeWorkspaceId, { metricKey: s.metricKey, label: s.label, points: s.defaultPoints })
      setMetrics((ms) => [...ms, created])
      showToast('Metric added')
    } catch {
      showToast('Failed to add metric', 'error')
    }
  }

  async function handleRemoveMetric() {
    if (!removeTarget) return
    const target = removeTarget
    setMetrics((ms) => ms.filter((m) => m.metricKey !== target.metricKey))
    setRemoveTarget(null)
    if (!user) {
      showToast('Metric removed')
      return
    }
    try {
      await deletePointsMetric(activeWorkspaceId, target.id)
      showToast('Metric removed')
    } catch {
      showToast('Failed to remove metric', 'error')
    }
  }

  const available = SUPPORTED_METRICS.filter((s) => !metrics.some((m) => m.metricKey === s.metricKey))

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border-card)] py-16 text-sm text-[var(--text-secondary)]">
        <Loader2 size={20} className="animate-spin" />
        Loading compensation…
      </div>
    )
  }

  const mainColumn = (
    <>
      {/* Summary tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SummaryTile
          icon={<Wallet size={18} />}
          label="Total payout (all moderators)"
          value={formatMoney(grandTotals.money, conversion.currency)}
        />
        <SummaryTile icon={<Sparkles size={18} />} label="Total points earned" value={formatPoints(grandTotals.points)} />
      </div>

      {/* Earnings table */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-card)] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
              <Users size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Moderator earnings</h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Auto metrics pull from your integrations; the rest you enter — totals update live.
              </p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => setXImportOpen(true)} className="!px-3 !py-1.5 text-xs">
            <AtSign size={13} /> Import X metrics
          </Button>
        </div>

        {moderators.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-16 text-center text-[var(--text-secondary)]">
            <Users size={26} className="text-slate-600" />
            No moderators in this workspace yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border-card)] text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                  <th className="sticky left-0 z-10 bg-[var(--bg-card)] px-5 py-3 font-medium">Moderator</th>
                  {metrics.map((m) => (
                    <th key={m.metricKey} className="px-3 py-3 text-right font-medium">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap normal-case">
                        {platformOf(m.metricKey) && <Badge tone={PLATFORM_TONE[platformOf(m.metricKey)!]}>{platformOf(m.metricKey)}</Badge>}
                        <span>{m.label}</span>
                      </div>
                      <div className="text-[10px] normal-case text-slate-500">{effectivePoints(m)} pts each</div>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right font-medium">Points</th>
                  <th className="px-5 py-3 text-right font-medium">Earned</th>
                </tr>
              </thead>
              <tbody>
                {moderators.map((mod) => {
                  const points = pointsFor(mod.id)
                  const money = points * effectiveRate
                  return (
                    <tr key={mod.id} className="border-b border-[var(--border-card)] last:border-0 hover:bg-white/[0.02]">
                      <td className="sticky left-0 z-10 bg-[var(--bg-card)] px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-emerald)]/20 text-xs font-bold text-[var(--accent-emerald-bright)]">
                            {mod.avatarInitials}
                          </div>
                          <span className="whitespace-nowrap font-medium text-white">{mod.fullName}</span>
                        </div>
                      </td>
                      {metrics.map((m) => {
                        const auto = isAutoFilled(mod.id, m.metricKey)
                        return (
                          <td key={m.metricKey} className="px-3 py-3 text-right align-top">
                            <input
                              type="text"
                              inputMode="numeric"
                              title={auto ? 'Auto-filled from your integration — edit to override' : undefined}
                              className={`w-20 rounded-lg border bg-black/30 px-2 py-1.5 text-right text-sm text-white outline-none focus:border-[color:var(--accent-emerald)] ${
                                auto ? 'border-[var(--accent-emerald)]/40' : 'border-white/[0.09]'
                              }`}
                              {...draftProps(`cell::${cellKey(mod.id, m.metricKey)}`, effectiveValue(mod.id, m.metricKey), (n) =>
                                commitCell(mod, m, n),
                              )}
                            />
                            {auto && (
                              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[var(--accent-emerald)]">
                                <Zap size={9} /> auto
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-3 py-3 text-right font-semibold text-white">{formatPoints(points)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-[var(--accent-emerald-bright)]">
                        {formatMoney(money, conversion.currency)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border-card)] bg-white/[0.02] text-sm">
                  <td className="sticky left-0 z-10 bg-[var(--bg-card)] px-5 py-3 font-semibold text-white">Total</td>
                  {metrics.map((m) => (
                    <td key={m.metricKey} className="px-3 py-3" />
                  ))}
                  <td className="px-3 py-3 text-right font-bold text-white">{formatPoints(grandTotals.points)}</td>
                  <td className="px-5 py-3 text-right font-bold text-[var(--accent-emerald-bright)]">
                    {formatMoney(grandTotals.money, conversion.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  )

  // Compact points catalog — lives in the resizable right rail. Rows are small so
  // the whole catalog fits; the list scrolls vertically when it overflows.
  const catalogRail = (
    <Card className="flex max-h-[calc(100vh-7rem)] flex-col p-0 lg:min-h-[440px]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-card)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
            <Settings2 size={14} />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-white">Points catalog</h3>
            <p className="text-[10px] text-[var(--text-secondary)]">Only metrics Catch can track.</p>
          </div>
        </div>
        <Button onClick={() => setAddOpen(true)} disabled={available.length === 0} className="!px-2 !py-1.5 text-xs">
          <Plus size={13} />
        </Button>
      </div>

      {/* Conversion rate — moved here from the summary row */}
      <div className="flex items-center gap-2 border-b border-[var(--border-card)] px-4 py-2.5">
        <Coins size={13} className="shrink-0 text-[var(--accent-emerald-bright)]" />
        <span className="text-[11px] text-slate-400">1 pt =</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Conversion rate"
          className="w-16 rounded-lg border border-white/[0.09] bg-black/30 px-2 py-1.5 text-right text-sm text-white outline-none focus:border-[color:var(--accent-emerald)]"
          {...draftProps('rate', conversion.rate, commitRate)}
        />
        <select
          value={conversion.currency}
          onChange={(e) => changeCurrency(e.target.value as CompCurrency)}
          className="rounded-lg border border-white/[0.09] bg-black/30 px-2 py-1.5 text-sm text-white outline-none focus:border-[color:var(--accent-emerald)]"
        >
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {metrics.length === 0 ? (
        <p className="p-4 text-sm text-[var(--text-secondary)]">No metrics yet — add one to start.</p>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
          {metrics.map((m) => {
            const meta = metricMeta(m.metricKey)
            return (
              <div key={m.metricKey} className="flex items-center gap-2 rounded-lg border border-[var(--border-card)] bg-white/[0.02] px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12px] text-white">
                    <MetricLabel metricKey={m.metricKey} label={m.label} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                    {meta?.source === 'auto' ? <Zap size={9} className="text-[var(--accent-emerald)]" /> : <PencilLine size={9} />}
                    {meta ? (meta.source === 'auto' ? 'Auto' : 'Manual / CSV') : 'Legacy'}
                  </div>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`${m.label} points`}
                  className="w-12 rounded-lg border border-white/[0.09] bg-black/30 px-1.5 py-1 text-right text-sm text-white outline-none focus:border-[color:var(--accent-emerald)]"
                  {...draftProps(`points::${m.metricKey}`, m.points, (n) => commitMetricPoints(m, n))}
                />
                <span className="text-[10px] text-[var(--text-secondary)]">pts</span>
                <button
                  onClick={() => setRemoveTarget(m)}
                  aria-label={`Remove ${m.label}`}
                  className="rounded-md p-1 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )

  return (
    <div className="flex flex-col gap-5">
      <SplitPane
        storageKey="catch:payments:catalogSplit"
        initialLeftPct={72}
        minLeftPct={45}
        maxLeftPct={82}
        className="items-start"
        leftClassName="flex min-w-0 flex-col gap-5"
        rightClassName="lg:sticky lg:top-4"
        left={mainColumn}
        right={catalogRail}
      />

      {/* Add metric — pick from the curated, trackable catalog only */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a metric">
        <p className="mb-4 text-xs text-[var(--text-secondary)]">
          Only metrics Catch can actually measure are listed — automatically from an integration, or entered manually (e.g. the X
          CSV export). Pick one to add it to the points catalog.
        </p>
        {available.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-secondary)]">All supported metrics are already in your catalog.</p>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
            {available.map((s) => (
              <button
                key={s.metricKey}
                onClick={() => {
                  void handleAddSupported(s)
                  setAddOpen(false)
                }}
                className="flex items-center gap-3 rounded-xl border border-[var(--border-card)] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-[var(--accent-emerald)]/50 hover:bg-white/[0.04]"
              >
                <Badge tone={PLATFORM_TONE[s.platform]}>{s.platform}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white">{s.label}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                    {s.source === 'auto' ? <Zap size={10} className="text-[var(--accent-emerald)]" /> : <PencilLine size={10} />}
                    {s.source === 'auto' ? 'Auto from integration' : 'Manual / CSV'} · {s.hint}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-[var(--text-secondary)]">{s.defaultPoints} pts</span>
                <Plus size={15} className="shrink-0 text-[var(--accent-emerald)]" />
              </button>
            ))}
          </div>
        )}
      </Modal>

      {/* X / Twitter manual import — per-moderator, quick entry or CSV paste */}
      <XMetricsImportModal
        open={xImportOpen}
        onClose={() => setXImportOpen(false)}
        moderators={moderators}
        valueOf={effectiveValue}
        onCommit={(moderatorId, metricKey, value) => {
          const mod = moderators.find((x) => x.id === moderatorId)
          const metric = metrics.find((x) => x.metricKey === metricKey)
          // Ensure the X metric is in the catalog so it shows in the earnings table.
          if (!metric) {
            const s = SUPPORTED_METRICS.find((x) => x.metricKey === metricKey)
            if (s) void handleAddSupported(s)
          }
          if (mod) {
            const target = metric ?? { id: `pending-${metricKey}`, metricKey, label: metricKey, points: 0 }
            commitCell(mod, target, value)
          }
        }}
      />

      {/* Remove metric confirm */}
      <Modal open={removeTarget !== null} onClose={() => setRemoveTarget(null)} title="Remove metric">
        <p className="text-sm text-[var(--text-secondary)]">
          Remove <span className="text-white">{removeTarget?.label}</span> from the points catalog? Existing earnings that use it
          will no longer count it.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleRemoveMetric}>
            Remove
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function SummaryTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-lg font-bold text-white">{value}</div>
          <div className="truncate text-xs text-[var(--text-secondary)]">{label}</div>
        </div>
      </div>
    </Card>
  )
}
