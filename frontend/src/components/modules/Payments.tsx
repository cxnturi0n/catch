import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BadgeDollarSign,
  ExternalLink,
  Loader2,
  Receipt,
  Users,
  Wallet,
} from 'lucide-react'
import type { ConversionConfig, Moderator, Payment, PointsMetric } from '../../types'
import {
  addPayment,
  fetchConversionConfig,
  fetchModeratorMetrics,
  fetchModerators,
  fetchPayments,
  fetchPointsConfig,
} from '../../lib/db'
import { getModerators as getSeedModerators } from '../../data/moderatorsData'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { FormField, inputClass } from '../ui/FormControls'
import { formatLongDate } from '../../lib/format'
import {
  CURRENCY_OPTIONS,
  DEFAULT_POINTS_METRICS,
  cellKey,
  formatMoney,
  parseAmount,
} from './moderators/comp'

const DEFAULT_CONVERSION: ConversionConfig = { rate: 0.01, currency: 'USD' }

// Quick date-range presets for the payment history log.
const HISTORY_RANGES: { id: string; label: string; days: number | null }[] = [
  { id: 'week', label: 'Last week', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
]

function currentPeriodLabel(): string {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface RecordDraft {
  moderatorId: string
  amount: string
  currency: string
  period: string
  note: string
  date: string
}

export function Payments() {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [moderators, setModerators] = useState<Moderator[]>([])
  const [metrics, setMetrics] = useState<PointsMetric[]>([])
  const [conversion, setConversion] = useState<ConversionConfig>(DEFAULT_CONVERSION)
  const [values, setValues] = useState<Record<string, number>>({})
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)

  const [recordDraft, setRecordDraft] = useState<RecordDraft | null>(null)
  const [payTarget, setPayTarget] = useState<Moderator | null>(null)
  const [saving, setSaving] = useState(false)

  // Filters for the history log
  const [filterModerator, setFilterModerator] = useState('all')
  const [filterPeriod, setFilterPeriod] = useState('all')
  const [rangeId, setRangeId] = useState('all')
  const [groupBy, setGroupBy] = useState<'none' | 'moderator' | 'period'>('none')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)

      if (!user) {
        // Guest mode, render seeded moderators and empty comp/payment state in memory.
        if (cancelled) return
        setModerators(getSeedModerators(activeWorkspaceId))
        setMetrics(DEFAULT_POINTS_METRICS.map((m, i) => ({ id: `local-${i}`, ...m })))
        setConversion(DEFAULT_CONVERSION)
        setValues({})
        setPayments([])
        setLoading(false)
        return
      }

      try {
        const [mods, catalog, conv, metricValues, pays] = await Promise.all([
          fetchModerators(activeWorkspaceId),
          fetchPointsConfig(activeWorkspaceId),
          fetchConversionConfig(activeWorkspaceId),
          fetchModeratorMetrics(activeWorkspaceId),
          fetchPayments(activeWorkspaceId),
        ])
        if (cancelled) return
        setModerators(mods)
        setMetrics(catalog.length > 0 ? catalog : DEFAULT_POINTS_METRICS.map((m, i) => ({ id: `local-${i}`, ...m })))
        setConversion(conv ?? DEFAULT_CONVERSION)
        const map: Record<string, number> = {}
        for (const v of metricValues) map[cellKey(v.moderatorId, v.metricKey)] = v.value
        setValues(map)
        setPayments(pays)
      } catch {
        if (cancelled) return
        setModerators([])
        setMetrics(DEFAULT_POINTS_METRICS.map((m, i) => ({ id: `local-${i}`, ...m })))
        setConversion(DEFAULT_CONVERSION)
        setValues({})
        setPayments([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, user])

  const moderatorName = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of moderators) map.set(m.id, m.fullName)
    return map
  }, [moderators])

  function earnedFor(moderatorId: string): number {
    let points = 0
    for (const m of metrics) points += (values[cellKey(moderatorId, m.metricKey)] ?? 0) * m.points
    return points * conversion.rate
  }

  function paidFor(moderatorId: string): number {
    return payments.filter((p) => p.moderatorId === moderatorId).reduce((sum, p) => sum + p.amount, 0)
  }

  const totals = useMemo(() => {
    let earned = 0
    for (const mod of moderators) earned += earnedFor(mod.id)
    const paid = payments.reduce((sum, p) => sum + p.amount, 0)
    return { earned, paid }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderators, metrics, values, conversion, payments])

  function openRecord(mod: Moderator) {
    setPayTarget(null)
    setRecordDraft({
      moderatorId: mod.id,
      amount: earnedFor(mod.id).toFixed(2),
      currency: conversion.currency,
      period: currentPeriodLabel(),
      note: '',
      date: todayIso(),
    })
  }

  async function submitRecord() {
    if (!recordDraft) return
    const draft = recordDraft
    const amount = parseAmount(draft.amount)
    const payload = {
      moderatorId: draft.moderatorId,
      amount,
      currency: draft.currency,
      period: draft.period.trim(),
      note: draft.note.trim(),
      paidAt: new Date(`${draft.date}T12:00:00`).toISOString(),
    }

    if (!user) {
      // Guest mode, keep the payment in memory only.
      const local: Payment = { id: `local-${Date.now()}`, ...payload }
      setPayments((prev) => [local, ...prev])
      setRecordDraft(null)
      showToast('Payment recorded')
      return
    }

    setSaving(true)
    try {
      const created = await addPayment(activeWorkspaceId, payload)
      setPayments((prev) => [created, ...prev])
      setRecordDraft(null)
      showToast('Payment recorded')
    } catch {
      showToast('Failed to record payment', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── History filtering + grouping ──
  const periods = useMemo(() => {
    const set = new Set<string>()
    for (const p of payments) if (p.period) set.add(p.period)
    return [...set]
  }, [payments])

  const filteredPayments = useMemo(() => {
    const days = HISTORY_RANGES.find((r) => r.id === rangeId)?.days ?? null
    const cutoff = days != null ? Date.now() - days * 86_400_000 : null
    return payments.filter(
      (p) =>
        (filterModerator === 'all' || p.moderatorId === filterModerator) &&
        (filterPeriod === 'all' || p.period === filterPeriod) &&
        (cutoff == null || new Date(p.paidAt).getTime() >= cutoff),
    )
  }, [payments, filterModerator, filterPeriod, rangeId])

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: '', label: '', rows: filteredPayments }]
    const map = new Map<string, Payment[]>()
    for (const p of filteredPayments) {
      const key = groupBy === 'moderator' ? moderatorName.get(p.moderatorId) ?? 'Unknown' : p.period || 'No period'
      const list = map.get(key) ?? []
      list.push(p)
      map.set(key, list)
    }
    return [...map.entries()].map(([key, rows]) => ({ key, label: key, rows }))
  }, [filteredPayments, groupBy, moderatorName])

  const filteredTotal = filteredPayments.reduce((sum, p) => sum + p.amount, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border-card)] py-16 text-sm text-[var(--text-secondary)]">
        <Loader2 size={20} className="animate-spin" />
        Loading payments…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Payments</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Track what each moderator has earned and log the payments you send from your external wallet.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryTile icon={<Wallet size={18} />} label="Total earned (all moderators)" value={formatMoney(totals.earned, conversion.currency)} />
        <SummaryTile icon={<Receipt size={18} />} label="Total paid out" value={formatMoney(totals.paid, conversion.currency)} />
        <SummaryTile
          icon={<BadgeDollarSign size={18} />}
          label="Outstanding"
          value={formatMoney(Math.max(0, totals.earned - totals.paid), conversion.currency)}
        />
      </div>

      {/* Per-moderator earnings + actions */}
      <Card className="p-0">
        <div className="flex items-center gap-2 border-b border-[var(--border-card)] px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
            <Users size={16} />
          </div>
          <h3 className="text-sm font-semibold text-white">Moderator balances</h3>
        </div>

        {moderators.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-16 text-center text-[var(--text-secondary)]">
            <Users size={26} className="text-slate-600" />
            No moderators in this workspace yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border-card)] text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                  <th className="px-5 py-3 font-medium">Moderator</th>
                  <th className="px-3 py-3 text-right font-medium">Earned</th>
                  <th className="px-3 py-3 text-right font-medium">Paid</th>
                  <th className="px-3 py-3 text-right font-medium">Outstanding</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {moderators.map((mod) => {
                  const earned = earnedFor(mod.id)
                  const paid = paidFor(mod.id)
                  const outstanding = Math.max(0, earned - paid)
                  return (
                    <tr key={mod.id} className="border-b border-[var(--border-card)] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-emerald)]/20 text-xs font-bold text-[var(--accent-emerald-bright)]">
                            {mod.avatarInitials}
                          </div>
                          <span className="whitespace-nowrap font-medium text-white">{mod.fullName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-[var(--accent-emerald-bright)]">
                        {formatMoney(earned, conversion.currency)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-300">{formatMoney(paid, conversion.currency)}</td>
                      <td className="px-3 py-3 text-right text-white">{formatMoney(outstanding, conversion.currency)}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openRecord(mod)}
                            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border-card)] px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white"
                          >
                            <Receipt size={12} /> Record payment
                          </button>
                          <button
                            onClick={() => setPayTarget(mod)}
                            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 px-2.5 py-1.5 text-xs font-medium text-[var(--accent-emerald-bright)] transition-colors hover:bg-[var(--accent-emerald)]/20"
                          >
                            <ExternalLink size={12} /> Pay
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Payment history */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-card)] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
              <Receipt size={16} />
            </div>
            <h3 className="text-sm font-semibold text-white">Payment history</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] p-0.5">
              {HISTORY_RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRangeId(r.id)}
                  aria-pressed={rangeId === r.id}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    rangeId === r.id ? 'bg-white/[0.08] text-white' : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <select value={filterModerator} onChange={(e) => setFilterModerator(e.target.value)} className={`${inputClass} w-auto`}>
              <option value="all">All moderators</option>
              {moderators.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
            <select value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)} className={`${inputClass} w-auto`}>
              <option value="all">All periods</option>
              {periods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} className={`${inputClass} w-auto`}>
              <option value="none">No grouping</option>
              <option value="moderator">Group by moderator</option>
              <option value="period">Group by period</option>
            </select>
          </div>
        </div>

        {filteredPayments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-16 text-center text-[var(--text-secondary)]">
            <Receipt size={26} className="text-slate-600" />
            No payments logged yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border-card)] text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Moderator</th>
                  <th className="px-3 py-3 font-medium">Period</th>
                  <th className="px-3 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const groupTotalByCurrency = group.rows.reduce((sum, p) => sum + p.amount, 0)
                  const groupCurrency = group.rows[0]?.currency ?? conversion.currency
                  return (
                    <GroupBody
                      key={group.key || 'all'}
                      showHeader={groupBy !== 'none'}
                      label={group.label}
                      rows={group.rows}
                      total={groupTotalByCurrency}
                      currency={groupCurrency}
                      moderatorName={moderatorName}
                    />
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border-card)] bg-white/[0.02]">
                  <td className="px-5 py-3 font-semibold text-white" colSpan={3}>
                    Total ({filteredPayments.length})
                  </td>
                  <td className="px-3 py-3 text-right font-bold text-[var(--accent-emerald-bright)]">
                    {formatMoney(filteredTotal, filteredPayments[0]?.currency ?? conversion.currency)}
                  </td>
                  <td className="px-5 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Record payment modal */}
      <Modal open={recordDraft !== null} onClose={() => setRecordDraft(null)} title="Record payment">
        {recordDraft && (
          <div className="flex flex-col gap-4">
            <FormField label="Moderator">
              <select
                value={recordDraft.moderatorId}
                onChange={(e) => setRecordDraft({ ...recordDraft, moderatorId: e.target.value })}
                className={inputClass}
              >
                {moderators.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Amount">
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  value={recordDraft.amount}
                  onChange={(e) => setRecordDraft({ ...recordDraft, amount: e.target.value })}
                />
              </FormField>
              <FormField label="Currency">
                <select
                  value={recordDraft.currency}
                  onChange={(e) => setRecordDraft({ ...recordDraft, currency: e.target.value })}
                  className={inputClass}
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Period">
                <input
                  className={inputClass}
                  value={recordDraft.period}
                  onChange={(e) => setRecordDraft({ ...recordDraft, period: e.target.value })}
                  placeholder="e.g. July 2026"
                />
              </FormField>
              <FormField label="Date">
                <input
                  type="date" lang="en-US"
                  className={inputClass}
                  value={recordDraft.date}
                  onChange={(e) => setRecordDraft({ ...recordDraft, date: e.target.value })}
                />
              </FormField>
            </div>
            <FormField label="Note (optional)">
              <input
                className={inputClass}
                value={recordDraft.note}
                onChange={(e) => setRecordDraft({ ...recordDraft, note: e.target.value })}
                placeholder="e.g. USDT to wallet 0x…"
              />
            </FormField>
            <div className="mt-1 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setRecordDraft(null)}>
                Cancel
              </Button>
              <Button onClick={submitRecord} loading={saving}>
                Save payment
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Pay (external wallet) modal */}
      <Modal open={payTarget !== null} onClose={() => setPayTarget(null)} title="Pay moderator">
        {payTarget && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--text-secondary)]">
              Payments are completed in your own external wallet, Catch never moves funds. Send{' '}
              <span className="font-semibold text-[var(--accent-emerald-bright)]">
                {formatMoney(Math.max(0, earnedFor(payTarget.id) - paidFor(payTarget.id)), conversion.currency)}
              </span>{' '}
              to <span className="text-white">{payTarget.fullName}</span>, then log it here so your salary history stays
              accurate.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setPayTarget(null)}>
                Close
              </Button>
              <Button onClick={() => openRecord(payTarget)}>
                <Receipt size={16} /> Record this payment
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function GroupBody({
  showHeader,
  label,
  rows,
  total,
  currency,
  moderatorName,
}: {
  showHeader: boolean
  label: string
  rows: Payment[]
  total: number
  currency: string
  moderatorName: Map<string, string>
}) {
  return (
    <>
      {showHeader && (
        <tr className="bg-white/[0.03]">
          <td colSpan={5} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--accent-emerald-bright)]">
            {label} · {formatMoney(total, currency)}
          </td>
        </tr>
      )}
      {rows.map((p) => (
        <tr key={p.id} className="border-b border-[var(--border-card)] last:border-0 hover:bg-white/[0.02]">
          <td className="whitespace-nowrap px-5 py-3 text-slate-300">{formatLongDate(p.paidAt.slice(0, 10))}</td>
          <td className="whitespace-nowrap px-3 py-3 font-medium text-white">{moderatorName.get(p.moderatorId) ?? 'Unknown'}</td>
          <td className="whitespace-nowrap px-3 py-3 text-slate-300">{p.period || 'n/a'}</td>
          <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-[var(--accent-emerald-bright)]">
            {formatMoney(p.amount, p.currency)}
          </td>
          <td className="px-5 py-3 text-slate-400">{p.note || 'n/a'}</td>
        </tr>
      ))}
    </>
  )
}

function SummaryTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="p-5">
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
