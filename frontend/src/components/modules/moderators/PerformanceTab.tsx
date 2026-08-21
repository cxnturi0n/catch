import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Clock, Download, MessagesSquare } from 'lucide-react'
import type { Moderator } from '../../../types'
import { Card } from '../../ui/Card'
import { formatRelativeTime } from '../../../lib/format'
import { fetchResponseMetrics, fetchShiftEvents } from '../../../lib/dbPlatformV2'
import { useWorkspace } from '../../../context/WorkspaceContext'
import { useAuth } from '../../../context/AuthContext'

type SortColumn = 'messages' | 'bans' | 'timeouts' | 'response' | 'coverage' | 'warnings' | 'rating'
type SortDir = 'asc' | 'desc'

function coveragePct(m: Moderator): number {
  return m.shiftsAssigned > 0 ? Math.round((m.shiftsCompleted / m.shiftsAssigned) * 100) : 0
}

function responseMinutes(m: Moderator): number {
  const parsed = parseFloat(m.avgResponseTime)
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function toCsv(moderators: Moderator[], isAutoSynced: boolean): string {
  const header = ['Moderator', 'Messages', 'Bans', 'Timeouts', 'Avg Response', 'Shift Coverage', 'Warnings', 'Rating', 'Last Active']
  const rows = moderators.map((m) => [
    m.fullName,
    isAutoSynced ? String(m.messagesThisMonth) : '--',
    isAutoSynced ? String(m.bansExecuted) : '--',
    isAutoSynced ? String(m.timeoutsGiven) : '--',
    isAutoSynced ? m.avgResponseTime : '--',
    `${coveragePct(m)}%`,
    String(m.warnings.length),
    String(m.rating),
    m.lastActiveDate,
  ])
  return [header, ...rows].map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string
  column: SortColumn
  sort: { column: SortColumn; dir: SortDir } | null
  onSort: (c: SortColumn) => void
}) {
  const active = sort?.column === column
  return (
    <th className="px-4 py-3 font-medium">
      <button onClick={() => onSort(column)} className="flex items-center gap-1 hover:text-white transition-colors">
        {label}
        {active ? sort?.dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} /> : <ArrowUpDown size={11} />}
      </button>
    </th>
  )
}

export function PerformanceTab({ moderators, isAutoSynced }: { moderators: Moderator[]; isAutoSynced: boolean }) {
  const [sort, setSort] = useState<{ column: SortColumn; dir: SortDir } | null>(null)
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const [punctuality, setPunctuality] = useState<{ pct: number | null; sampleSize: number }>({ pct: null, sampleSize: 0 })
  const [responseRate, setResponseRate] = useState<number | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)

  useEffect(() => {
    if (!user) {
      setPunctuality({ pct: null, sampleSize: 0 })
      setResponseRate(null)
      return
    }
    let cancelled = false
    setMetricsLoading(true)
    Promise.all([fetchShiftEvents(activeWorkspaceId, 30), fetchResponseMetrics(activeWorkspaceId, 30)])
      .then(([events, metrics]) => {
        if (cancelled) return
        const rated = events.filter((e) => e.wasOnTime !== null)
        const onTime = rated.filter((e) => e.wasOnTime === true).length
        setPunctuality({
          pct: rated.length > 0 ? Math.round((onTime / rated.length) * 100) : null,
          sampleSize: rated.length,
        })
        setResponseRate(metrics.reduce((sum, m) => sum + m.responsesCount, 0))
      })
      .catch(() => {
        if (cancelled) return
        setPunctuality({ pct: null, sampleSize: 0 })
        setResponseRate(null)
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, user])

  const totalBans = moderators.reduce((sum, m) => sum + m.bansExecuted, 0)
  const validResponseTimes = moderators.map(responseMinutes).filter((v) => Number.isFinite(v))
  const avgResponse =
    validResponseTimes.length > 0 ? (validResponseTimes.reduce((a, b) => a + b, 0) / validResponseTimes.length).toFixed(1) : null
  const avgCoverage =
    moderators.length > 0 ? Math.round(moderators.reduce((sum, m) => sum + coveragePct(m), 0) / moderators.length) : 0
  const openWarnings = moderators.reduce((sum, m) => sum + m.warnings.length, 0)

  function handleSort(column: SortColumn) {
    setSort((prev) => {
      if (prev?.column !== column) return { column, dir: 'desc' }
      if (prev.dir === 'desc') return { column, dir: 'asc' }
      return null
    })
  }

  const sorted = useMemo(() => {
    if (!sort) return moderators
    const dirMul = sort.dir === 'asc' ? 1 : -1
    const valueOf = (m: Moderator): number => {
      switch (sort.column) {
        case 'messages':
          return m.messagesThisMonth
        case 'bans':
          return m.bansExecuted
        case 'timeouts':
          return m.timeoutsGiven
        case 'response':
          return responseMinutes(m)
        case 'coverage':
          return coveragePct(m)
        case 'warnings':
          return m.warnings.length
        case 'rating':
          return m.rating
      }
    }
    return [...moderators].sort((a, b) => (valueOf(a) - valueOf(b)) * dirMul)
  }, [moderators, sort])

  function handleExportCsv() {
    const csv = toCsv(sorted, isAutoSynced)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `moderator-performance-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card className="p-5">
          <div className="text-2xl font-bold text-white">{isAutoSynced ? totalBans : '--'}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">Total Bans This Month</div>
        </Card>
        <Card className="p-5">
          <div className="text-2xl font-bold text-white">{isAutoSynced && avgResponse ? `${avgResponse} min` : '--'}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">Avg Response Time</div>
        </Card>
        <Card className="p-5">
          <div className="text-2xl font-bold text-white">{avgCoverage}%</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">Shift Coverage Rate</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-2xl font-bold text-white">
            <Clock size={18} className="text-[var(--accent-emerald-bright)]" />
            {metricsLoading ? '…' : punctuality.pct !== null ? `${punctuality.pct}%` : 'No data yet'}
          </div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">
            Punctuality {punctuality.sampleSize > 0 ? `(last ${punctuality.sampleSize} shifts)` : '(last 30d)'}
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-2xl font-bold text-white">
            <MessagesSquare size={18} className="text-[var(--accent-emerald-bright)]" />
            {metricsLoading ? '…' : responseRate !== null && responseRate > 0 ? responseRate.toLocaleString() : 'No data yet'}
          </div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">Responses (last 30d)</div>
        </Card>
        <Card className="p-5">
          <div className="text-2xl font-bold text-red-400">{openWarnings}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">Open Warnings</div>
        </Card>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleExportCsv}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--border-card)] px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/[0.04] transition-colors"
        >
          <Download size={14} /> Export as CSV
        </button>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-card)] text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">Moderator</th>
              <SortHeader label="Messages 🔄" column="messages" sort={sort} onSort={handleSort} />
              <SortHeader label="Bans 🔄" column="bans" sort={sort} onSort={handleSort} />
              <SortHeader label="Timeouts 🔄" column="timeouts" sort={sort} onSort={handleSort} />
              <SortHeader label="Avg Response 🔄" column="response" sort={sort} onSort={handleSort} />
              <SortHeader label="Shift Coverage" column="coverage" sort={sort} onSort={handleSort} />
              <SortHeader label="Warnings" column="warnings" sort={sort} onSort={handleSort} />
              <SortHeader label="Rating" column="rating" sort={sort} onSort={handleSort} />
              <th className="px-4 py-3 font-medium">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={m.id} className="border-b border-[var(--border-card)] last:border-0 hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3 font-medium text-white">{m.fullName}</td>
                <td className="px-4 py-3 text-slate-300" title={isAutoSynced ? undefined : 'Connect Discord/Telegram to auto-populate'}>
                  {isAutoSynced ? m.messagesThisMonth : '--'}
                </td>
                <td className="px-4 py-3 text-slate-300" title={isAutoSynced ? undefined : 'Connect Discord/Telegram to auto-populate'}>
                  {isAutoSynced ? m.bansExecuted : '--'}
                </td>
                <td className="px-4 py-3 text-slate-300" title={isAutoSynced ? undefined : 'Connect Discord/Telegram to auto-populate'}>
                  {isAutoSynced ? m.timeoutsGiven : '--'}
                </td>
                <td className="px-4 py-3 text-slate-300" title={isAutoSynced ? undefined : 'Connect Discord/Telegram to auto-populate'}>
                  {isAutoSynced ? m.avgResponseTime : '--'}
                </td>
                <td className="px-4 py-3 text-slate-300">{coveragePct(m)}%</td>
                <td className="px-4 py-3 text-slate-300">{m.warnings.length}</td>
                <td className="px-4 py-3 text-slate-300">{m.rating.toFixed(1)}</td>
                <td className="px-4 py-3 text-slate-300">{formatRelativeTime(m.lastActiveDate)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-[var(--text-secondary)]">
                  No moderators to show yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
