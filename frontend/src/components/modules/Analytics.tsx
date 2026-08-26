import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, AtSign, BarChart3, Calendar, Check, ChevronDown, FileSpreadsheet, Heart, MessageSquare, Minus, Monitor, Plus, Repeat2, ShieldCheck, Upload, UserPlus, Users } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getActiveMembersTrend, getDailyMessages, getStats } from '../../data/mockData'
import {
  fetchMemberMessageTrend,
  fetchMetricSnapshots,
  fetchPlatformMetricRows,
  fetchPlatformMetrics,
  submitFeedback,
  type LiveMetrics,
  type MetricSnapshot,
  type PlatformMetricDay,
} from '../../lib/db'
import {
  platformLabel,
  WINDOW_META,
  type AnalyticsDataset,
  type AnalyticsPlatformId,
  type AnalyticsWindow,
  type MetricCapability,
  type WindowResult,
} from '../../lib/analyticsCapabilities'
import {
  capId,
  composeDisplay,
  isLevelMetric,
  metricOptionsFor,
  OVERVIEW_ID,
  parseUrlPlatform,
  platformOptionsFor,
  unionWindowOptions,
  type DisplayItem,
} from '../../lib/analyticsComposition'
import { MultiSelectDropdown } from './analytics/MultiSelectDropdown'
import { AudiencePanel } from './analytics/AudiencePanel'
import { TopChannelsPanel } from './analytics/TopChannelsPanel'
import {
  fetchMembershipSnapshots,
  fetchTenure,
  type MembershipSnapshotRow,
  type TenureRecord,
} from '../../lib/retention'
import { discordSync, galxeSync, telegramSync, zealySync } from '../../lib/functions'
import { RetentionPanel } from './RetentionPanel'
import { loadXAnalytics, saveXAnalytics, clearXAnalytics, parseXAnalyticsCsvFile } from '../../lib/xAnalytics'
import { getGoogleAccessToken, createGoogleSheet } from '../../lib/googleSheets'
import { StatCard, type MetricTooltip } from '../ui/StatCard'
import { Card } from '../ui/Card'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useRealtimeTables } from '../../hooks/useRealtimeTables'
import { formatCompactNumber, formatDay, formatLongDate, formatRelativeTime } from '../../lib/format'
import type { IntegrationKey, XAnalyticsData } from '../../types'

// ── Analytics filters (mirrors the mobile app: platform × metric × time range) ──
type PlatformId = 'aggregated' | 'discord' | 'telegram' | 'twitter'
type MetricId = 'all' | 'members' | 'newMembers' | 'messages' | 'engagement' | 'churn'
type RangeId = '7D' | '1M' | '3M' | '6M' | '1Y'

const PLATFORMS: { id: PlatformId; label: string; mult: number }[] = [
  { id: 'aggregated', label: 'Aggregated', mult: 1 },
  { id: 'discord', label: 'Discord', mult: 0.58 },
  { id: 'telegram', label: 'Telegram', mult: 0.33 },
  { id: 'twitter', label: 'Twitter / X', mult: 0.42 },
]

const METRICS: { id: MetricId; label: string; base: number; amp: number; suffix?: string; color: string }[] = [
  { id: 'all', label: 'Overview', base: 0, amp: 0, color: '#2f7cf6' },
  { id: 'members', label: 'Active Members', base: 3200, amp: 0.22, color: '#2f7cf6' },
  { id: 'newMembers', label: 'New Members', base: 90, amp: 0.5, color: '#4d9fff' },
  { id: 'messages', label: 'Messages', base: 640, amp: 0.4, color: '#6db3ff' },
  { id: 'engagement', label: 'Engagement', base: 42, amp: 0.18, suffix: '%', color: '#8cc5ff' },
  { id: 'churn', label: 'Churn', base: 6, amp: 0.45, suffix: '%', color: '#1e3a8a' },
]

const RANGES: { id: RangeId; label: string; days: number }[] = [
  { id: '7D', label: '7 days', days: 7 },
  { id: '1M', label: '1 month', days: 30 },
  { id: '3M', label: '3 months', days: 90 },
  { id: '6M', label: '6 months', days: 180 },
  { id: '1Y', label: '1 year', days: 365 },
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

/** Deterministic series for a metric×platform×range combination (max ~60 points). */
function buildSeries(seed: number, days: number, base: number, amp: number, mult: number): { date: string; value: number }[] {
  const points = Math.min(days, 60)
  const step = days / points
  const now = Date.now()
  const out: { date: string; value: number }[] = []
  for (let i = 0; i < points; i++) {
    const dayOffset = Math.round((points - 1 - i) * step)
    const t = i / Math.max(1, points - 1)
    const wave = Math.sin(i * 0.5 + seed) * 0.5 + Math.sin(i * 0.13 + seed * 0.3) * 0.3
    const trend = 0.72 + t * 0.5
    const value = Math.max(0, Math.round(base * mult * trend * (1 + wave * amp)))
    out.push({ date: new Date(now - dayOffset * 86400000).toISOString().slice(0, 10), value })
  }
  return out
}

function FilterDropdown<T extends string>({
  icon,
  label,
  options,
  value,
  onChange,
  footer,
}: {
  icon?: ReactNode
  label: string
  options: { id: T; label: string; disabled?: boolean; hint?: string }[]
  value: T
  onChange: (v: T) => void
  /** Optional pinned footer action; receives a `close` callback. */
  footer?: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const current = options.find((o) => o.id === value)
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:border-[var(--accent-emerald)]/50"
      >
        {icon}
        <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">{label}</span>
        <span>{current?.label}</span>
        <ChevronDown size={15} className={`text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 min-w-[190px] rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1.5 shadow-2xl">
          {options.map((o) => (
            <button
              key={o.id}
              disabled={o.disabled}
              title={o.disabled ? o.hint : undefined}
              onClick={() => {
                if (o.disabled) return
                onChange(o.id)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                o.disabled
                  ? 'cursor-not-allowed text-slate-500'
                  : o.id === value
                    ? 'bg-[var(--accent-emerald)]/[0.12] text-white'
                    : 'text-slate-300 hover:bg-white/[0.05]'
              }`}
            >
              <span>{o.label}</span>
              {o.disabled ? (
                <span className="text-[10px] uppercase tracking-wide text-slate-600">{o.hint}</span>
              ) : (
                o.id === value && <Check size={14} className="text-[var(--accent-emerald-bright)]" />
              )}
            </button>
          ))}
          {footer && (
            <div className="mt-1 border-t border-[var(--border-card)] pt-1">
              {footer(() => setOpen(false))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Pinned "＋ Request a metric" action shown at the bottom of the metric dropdown. */
function RequestMetricFooter({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--accent-emerald-bright)] transition-colors hover:bg-[var(--accent-emerald)]/[0.10]"
    >
      <Plus size={14} className="shrink-0" />
      Request a metric
    </button>
  )
}

/**
 * Lightweight request form. Reuses the existing CatchLab feedback channel
 * (category "Analytics & Metrics"), no new table or backend. Requests land in
 * the owner inbox and can be promoted to the public roadmap from CatchLab.
 */
function RequestMetricModal({
  open,
  onClose,
  userId,
  contextHint,
}: {
  open: boolean
  onClose: () => void
  userId: string | null
  contextHint?: string
}) {
  const { showToast } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
    }
  }, [open])

  async function handleSubmit() {
    const t = title.trim()
    if (!t) {
      showToast('Give the metric a name first.')
      return
    }
    if (!userId) {
      showToast('Sign in to request a metric.')
      return
    }
    setSubmitting(true)
    try {
      const detail = description.trim()
      const body = [detail, contextHint ? `, Requested from ${contextHint}` : '']
        .filter(Boolean)
        .join('\n\n') || '(no extra detail)'
      await submitFeedback(userId, {
        category: 'Analytics & Metrics',
        title: t,
        description: body,
        rating: null,
        role: null,
      })
      showToast('Metric request sent, thank you!')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send the request.')
    } finally {
      setSubmitting(false)
    }
  }

  const fieldClass =
    'rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-[var(--accent-emerald)]/60 focus:outline-none'

  return (
    <Modal open={open} onClose={onClose} title="Request a new metric">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Tell us what you'd like to measure. Requests go to the Catch team and show up in CatchLab.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">Metric</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. On-chain holders from the community"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">Details (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="What it should show, from which platform, and why it matters."
            className={`resize-none ${fieldClass}`}
          />
        </label>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Send request
          </Button>
        </div>
      </div>
    </Modal>
  )
}

const SYNCABLE_PLATFORMS: IntegrationKey[] = ['discord', 'telegram', 'galxe', 'zealy']
// Every live integration that can feed the dynamic (real-data) Analytics view.
// Twitter/X is excluded, it's CSV-only and never reports "Connected".
const LIVE_KEYS: IntegrationKey[] = ['discord', 'telegram', 'galxe', 'zealy']
const STALE_AFTER_MS = 60 * 60 * 1000
const AUTO_REFRESH_MS = 5 * 60 * 1000
// Tables whose rows back everything rendered on this page.
const METRIC_TABLES = ['platform_metrics', 'platform_metric_snapshots', 'message_activity', 'member_messages'] as const

const METRIC_TOOLTIPS: Record<'activeMembers' | 'messagesWeek' | 'newMembers' | 'scamAlerts', MetricTooltip> = {
  activeMembers: {
    what: 'Unique users who sent at least one message in the selected period.',
    how: 'Counted from platform API data (Discord + Telegram combined).',
    why: 'Primary indicator of real community engagement vs. passive membership.',
  },
  messagesWeek: {
    what: 'Total messages sent across all connected platforms.',
    how: 'Summed from Discord channel messages + Telegram group messages.',
    why: 'Measures conversation volume and content activity level.',
  },
  newMembers: {
    what: 'Net new users who joined during the selected period.',
    how: 'Join events tracked via platform webhooks and API.',
    why: 'Indicates growth rate and effectiveness of acquisition campaigns.',
  },
  scamAlerts: {
    what: 'Security incidents logged and resolved in the Moderation module.',
    how: 'Count of incidents with status "Resolved" created in the period.',
    why: 'Proof of security work, critical for client trust and reporting.',
  },
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null
  return (
    <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 text-[var(--text-secondary)]">{formatDay(label)}</div>
      <div className="font-semibold text-white">{formatCompactNumber(payload[0].value)}</div>
    </div>
  )
}

function runSync(platform: IntegrationKey, workspaceId: string) {
  switch (platform) {
    case 'telegram':
      return telegramSync(workspaceId)
    case 'galxe':
      return galxeSync(workspaceId)
    case 'zealy':
      return zealySync(workspaceId)
    default:
      return discordSync(workspaceId)
  }
}

function XChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey: string }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null
  return (
    <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 text-[var(--text-secondary)]">{formatDay(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="font-semibold text-white">
          {p.dataKey === 'impressions' ? 'Impressions' : 'Engagements'}: {formatCompactNumber(p.value)}
        </div>
      ))}
    </div>
  )
}

function XAnalyticsSection({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<XAnalyticsData | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    loadXAnalytics(workspaceId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null))
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  async function handleFile(file: File) {
    setImporting(true)
    setImportError(null)
    try {
      const parsed = await parseXAnalyticsCsvFile(file)
      await saveXAnalytics(workspaceId, parsed)
      setData(parsed)
      setModalOpen(false)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to parse file.')
    } finally {
      setImporting(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
    e.target.value = ''
  }

  function handleClear() {
    void clearXAnalytics(workspaceId)
    setData(null)
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AtSign size={18} className="text-[var(--text-secondary)]" />
          <h2 className="text-base font-semibold text-white">X / Twitter Analytics</h2>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-xs text-[var(--text-secondary)]">
              Imported {formatRelativeTime(data.importedAt)} · {formatLongDate(data.periodStart)}, {formatLongDate(data.periodEnd)}
            </span>
          )}
          <Button onClick={() => { setImportError(null); setModalOpen(true) }} className="!px-3 !py-1.5 text-xs flex items-center gap-1.5">
            <Upload size={13} />
            {data ? 'Update CSV' : 'Import CSV'}
          </Button>
          {data && (
            <button onClick={handleClear} className="text-xs text-[var(--text-secondary)] hover:text-red-400 transition-colors">
              Remove
            </button>
          )}
        </div>
      </div>

      {!data ? (
        <Card className="flex flex-col items-center justify-center gap-3 border-dashed py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.04] text-[var(--text-secondary)]">
            <AtSign size={22} />
          </div>
          <div>
            <p className="text-sm font-medium text-white">No X analytics imported yet</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Import a CSV from analytics.twitter.com to see impressions and engagement data.{' '}
              <Link
                to="/dashboard/instructions?section=integrations"
                className="text-[var(--accent-cyan)] hover:underline"
              >
                How to →
              </Link>
            </p>
          </div>
          <Button onClick={() => { setImportError(null); setModalOpen(true) }} className="mt-1 flex items-center gap-2">
            <Upload size={14} /> Import CSV
          </Button>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total Impressions"
              value={formatCompactNumber(data.totalImpressions)}
              delta={null}
              icon={<AtSign size={16} />}
            />
            <StatCard
              label="Total Engagements"
              value={formatCompactNumber(data.totalEngagements)}
              delta={null}
              icon={<MessageSquare size={16} />}
            />
            <StatCard
              label="Total Likes"
              value={formatCompactNumber(data.totalLikes)}
              delta={null}
              icon={<Heart size={16} />}
            />
            <StatCard
              label="Retweets"
              value={formatCompactNumber(data.totalRetweets)}
              delta={null}
              icon={<Repeat2 size={16} />}
            />
          </div>

          <Card className="p-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white">Impressions & Engagements Trend</h3>
              <p className="text-xs text-[var(--text-secondary)]">
                {formatLongDate(data.periodStart)}, {formatLongDate(data.periodEnd)}
              </p>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="xImpressionsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1e3a8a" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#1e3a8a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="xEngagementsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2f7cf6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#2f7cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatDay} stroke="var(--text-secondary)" tick={{ fontSize: 11 }} minTickGap={30} />
                <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} tickFormatter={formatCompactNumber} width={48} />
                <Tooltip content={<XChartTooltip />} />
                <Area type="monotone" dataKey="impressions" stroke="#1e3a8a" strokeWidth={2.5} fill="url(#xImpressionsFill)" dot={false} activeDot={{ r: 4, fill: '#1e3a8a' }} />
                <Area type="monotone" dataKey="engagements" stroke="#2f7cf6" strokeWidth={2} fill="url(#xEngagementsFill)" dot={false} activeDot={{ r: 4, fill: '#2f7cf6' }} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Import X Analytics CSV">
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-[var(--border-card)] bg-white/[0.03] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">How to export from X</p>
            <ol className="flex flex-col gap-2">
              {[
                'Go to analytics.twitter.com',
                'Click the "Tweets" tab',
                'Set the period (max 90 days)',
                'Click "Export data" → "By tweet"',
                'Upload the CSV file below',
              ].map((step, i) => (
                <li key={i} className="flex gap-3 text-sm text-slate-300">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-purple)]/20 text-xs font-bold text-[var(--accent-purple)]">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <Link
              to="/dashboard/instructions?section=integrations"
              onClick={() => setModalOpen(false)}
              className="mt-3 block text-xs text-[var(--accent-cyan)] hover:underline"
            >
              Full guide in the instructions →
            </Link>
          </div>

          {importError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {importError}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} loading={importing} className="flex items-center gap-2">
              <Upload size={14} /> Choose CSV file
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

export function Analytics() {
  const { workspaces, activeWorkspaceId, getWorkspaceIntegrations, refreshIntegrations } = useWorkspace()
  const { showToast } = useToast()
  const { user } = useAuth()
  const [metricReqOpen, setMetricReqOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  // Per-platform deep link: `?platform=discord|telegram|galxe|zealy` scopes the
  // connected dashboard to a single platform. No param = aggregated / all.
  const urlPlatform = parseUrlPlatform(searchParams.get('platform'))
  function handleScopeChange(next: AnalyticsPlatformId | null) {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('platform', next)
    else params.delete('platform')
    setSearchParams(params, { replace: true })
  }
  const [range, setRange] = useState<RangeId>('1M')
  const [platform, setPlatform] = useState<PlatformId>('aggregated')
  const [metric, setMetric] = useState<MetricId>('all')
  const period = RANGES.find((r) => r.id === range)!.days
  const [live, setLive] = useState<LiveMetrics | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [exporting, setExporting] = useState(false)

  async function handleExportToSheets() {
    setExporting(true)
    try {
      const token = await getGoogleAccessToken()
      const wsName = workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? 'Workspace'
      const stats = getStats(activeWorkspaceId)
      const trend = getActiveMembersTrend(activeWorkspaceId).slice(-period)
      const messages = getDailyMessages(activeWorkspaceId).slice(-Math.min(period, 14))
      const xData = await loadXAnalytics(activeWorkspaceId).catch(() => null)

      const sheets = [
        {
          title: 'Overview',
          headers: ['Metric', 'Value'],
          rows: [
            ['Active Members', stats.activeMembers],
            ['Messages This Week', stats.messagesWeek],
            ['New Members', stats.newMembers],
            ['Scam Alerts Blocked', stats.scamAlertsBlocked],
            ['Export Date', new Date().toISOString().slice(0, 10)],
            ['Period', `${period} days`],
          ] as (string | number)[][],
        },
        {
          title: 'Members Trend',
          headers: ['Date', 'Active Members'],
          rows: trend.map((t) => [t.date, t.value] as (string | number)[]),
        },
        {
          title: 'Daily Messages',
          headers: ['Date', 'Messages'],
          rows: messages.map((m) => [m.date, m.value] as (string | number)[]),
        },
        ...(xData
          ? [
              {
                title: 'X Analytics',
                headers: ['Date', 'Impressions', 'Engagements'],
                rows: xData.trend.map((t) => [t.date, t.impressions, t.engagements] as (string | number)[]),
              },
            ]
          : []),
      ]

      const url = await createGoogleSheet(token, `Catch, ${wsName}`, sheets)
      showToast('Spreadsheet created, opening now')
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  const integrations = getWorkspaceIntegrations(activeWorkspaceId)
  const stats = getStats(activeWorkspaceId)

  const connectedPlatforms = useMemo(
    () => SYNCABLE_PLATFORMS.filter((key) => integrations[key].status === 'Connected'),
    [integrations.discord.status, integrations.telegram.status],
  )
  const connectedKey = connectedPlatforms.join(',')

  // Broader set (incl. Galxe/Zealy) that drives the dynamic real-data view.
  const liveConnected = useMemo(
    () => LIVE_KEYS.filter((key) => integrations[key].status === 'Connected'),
    [integrations.discord.status, integrations.telegram.status, integrations.galxe.status, integrations.zealy.status],
  )
  const liveConnectedKey = liveConnected.join(',')

  // Kick off a background sync for any connected platform whose data is
  // stale (or has never been synced) whenever this page is opened.
  useEffect(() => {
    if (!activeWorkspaceId || connectedPlatforms.length === 0) return
    const stale = connectedPlatforms.filter((key) => {
      const lastSync = integrations[key].lastSync
      return !lastSync || Date.now() - new Date(lastSync).getTime() > STALE_AFTER_MS
    })
    if (stale.length === 0) return

    let cancelled = false
    Promise.all(stale.map((key) => runSync(key, activeWorkspaceId).catch(() => null))).then(() => {
      if (cancelled) return
      void refreshIntegrations(activeWorkspaceId)
      setRefreshToken((t) => t + 1)
    })
    return () => {
      cancelled = true
    }
    // Re-runs when the workspace, connected set, or sync timestamps change.
  }, [activeWorkspaceId, connectedKey, integrations.discord.lastSync, integrations.telegram.lastSync, integrations.galxe.lastSync, integrations.zealy.lastSync])

  // Light auto-refresh: while a platform is connected, re-pull the displayed
  // metrics every few minutes so background cron-syncs surface without a reload.
  // Interval is cleared on unmount and whenever the workspace / connected set
  // changes. Guests never have a connected platform, so this stays idle.
  useEffect(() => {
    if (!activeWorkspaceId || liveConnected.length === 0) return
    const id = window.setInterval(() => {
      void refreshIntegrations(activeWorkspaceId)
      setRefreshToken((t) => t + 1)
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [activeWorkspaceId, liveConnectedKey, refreshIntegrations])

  // Fast path on top of that interval: a sync writing metrics for this
  // workspace pushes the refresh through immediately. If Realtime is
  // unavailable the interval above still carries the page.
  useRealtimeTables(activeWorkspaceId, METRIC_TABLES, () => {
    void refreshIntegrations(activeWorkspaceId)
    setRefreshToken((t) => t + 1)
  })

  useEffect(() => {
    if (!activeWorkspaceId || connectedPlatforms.length === 0) {
      setLive(null)
      return
    }
    let cancelled = false
    fetchPlatformMetrics(activeWorkspaceId, connectedPlatforms, period)
      .then((result) => {
        if (!cancelled) setLive(result)
      })
      .catch(() => {
        if (!cancelled) setLive(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, connectedKey, period, refreshToken])

  const isLive = liveConnected.length > 0
  const hasLiveData = live !== null

  const trendData = useMemo(() => {
    if (hasLiveData && live) return live.trend
    return getActiveMembersTrend(activeWorkspaceId).slice(-period)
  }, [activeWorkspaceId, period, hasLiveData, live])

  const messageData = useMemo(() => {
    return getDailyMessages(activeWorkspaceId).slice(-Math.min(period, 14))
  }, [activeWorkspaceId, period])

  const activeMembersValue = hasLiveData && live?.latestMembers != null ? live.latestMembers : stats.activeMembers
  const activeMembersDelta = hasLiveData && live?.latestMembers != null ? null : stats.activeMembersDelta
  const scamAlertsValue = hasLiveData && live?.latestBans7d != null ? live.latestBans7d : stats.scamAlertsBlocked
  const scamAlertsDelta = hasLiveData && live?.latestBans7d != null ? null : stats.scamAlertsDelta

  return (
    <div className="flex flex-col gap-6">
      {isLive ? (
        <LiveAnalyticsView
          workspaceId={activeWorkspaceId}
          connected={liveConnected}
          refreshToken={refreshToken}
          onExport={handleExportToSheets}
          exporting={exporting}
          urlPlatform={urlPlatform}
          onScopeChange={handleScopeChange}
          userId={user?.id ?? null}
        />
      ) : (
      <>
      <RequestMetricModal
        open={metricReqOpen}
        onClose={() => setMetricReqOpen(false)}
        userId={user?.id ?? null}
        contextHint="Analytics (sample view)"
      />
      {/* Filter bar, platform × analytics type × time range, plus export */}
      <div className="flex flex-wrap items-center gap-2.5">
        <FilterDropdown
          icon={<Monitor size={15} className="text-[var(--accent-emerald)]" />}
          label="Platform"
          options={PLATFORMS.map((p) => ({ id: p.id, label: p.label }))}
          value={platform}
          onChange={setPlatform}
        />
        <FilterDropdown
          icon={<BarChart3 size={15} className="text-[var(--accent-emerald)]" />}
          label="Analytics"
          options={METRICS.map((m) => ({ id: m.id, label: m.label }))}
          value={metric}
          onChange={setMetric}
          footer={(close) => (
            <RequestMetricFooter
              onOpen={() => {
                close()
                setMetricReqOpen(true)
              }}
            />
          )}
        />
        <FilterDropdown
          icon={<Calendar size={15} className="text-[var(--accent-emerald)]" />}
          label="Range"
          options={RANGES.map((r) => ({ id: r.id, label: r.label }))}
          value={range}
          onChange={setRange}
        />
        <div className="ml-auto flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={handleExportToSheets}
            loading={exporting}
            className="flex items-center gap-1.5 !px-3 !py-1.5 text-xs"
          >
            <FileSpreadsheet size={14} />
            Export to Google Sheets
          </Button>
        </div>
      </div>

      {/* Focused single-metric view (when a specific analytics type is picked) */}
      {metric !== 'all' && <FocusedMetric workspaceId={activeWorkspaceId} metric={metric} platform={platform} days={period} range={range} />}

      {metric === 'all' && (
      <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active Members"
          value={formatCompactNumber(activeMembersValue)}
          delta={activeMembersDelta}
          icon={<Users size={16} />}
          tooltip={METRIC_TOOLTIPS.activeMembers}
          deltaTooltip={`Compared to the previous ${period}-day period`}
        />
        <StatCard
          label="Messages This Week"
          value={formatCompactNumber(stats.messagesWeek)}
          delta={stats.messagesDelta}
          icon={<MessageSquare size={16} />}
          tooltip={METRIC_TOOLTIPS.messagesWeek}
          deltaTooltip={`Compared to the previous ${period}-day period`}
        />
        <StatCard
          label="New Members"
          value={formatCompactNumber(stats.newMembers)}
          delta={stats.newMembersDelta}
          icon={<UserPlus size={16} />}
          tooltip={METRIC_TOOLTIPS.newMembers}
          deltaTooltip={`Compared to the previous ${period}-day period`}
        />
        <StatCard
          label="Scam Alerts Blocked"
          value={String(scamAlertsValue)}
          delta={scamAlertsDelta}
          icon={<ShieldCheck size={16} />}
          tooltip={METRIC_TOOLTIPS.scamAlerts}
          deltaTooltip={`Compared to the previous ${period}-day period`}
        />
      </div>

      <Card className="p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-white">Active Members Trend</h3>
          <p className="text-xs text-[var(--text-secondary)]">Last {period} days{hasLiveData ? ', live' : ''}</p>
        </div>
        <ResponsiveContainer key={`members-${activeWorkspaceId}`} width="100%" height={300}>
          <AreaChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="membersFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2f7cf6" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#2f7cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDay} stroke="var(--text-secondary)" tick={{ fontSize: 11 }} minTickGap={30} />
            <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} tickFormatter={formatCompactNumber} width={48} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#2f7cf6"
              strokeWidth={2.5}
              fill="url(#membersFill)"
              dot={false}
              activeDot={{ r: 4, fill: '#2f7cf6' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <Card className="p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-white">Daily Messages Volume</h3>
          <p className="text-xs text-[var(--text-secondary)]">Last 14 days</p>
        </div>
        <ResponsiveContainer key={`messages-${activeWorkspaceId}`} width="100%" height={250}>
          <BarChart data={messageData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="barSapphire" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6db3ff" />
                <stop offset="55%" stopColor="#2f7cf6" />
                <stop offset="100%" stopColor="#1e3a8a" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDay} stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} tickFormatter={formatCompactNumber} width={48} />
            {/* Almost-transparent sapphire hover box instead of the default white block */}
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(120,170,255,0.10)', radius: 4 }} />
            <Bar dataKey="value" fill="url(#barSapphire)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="mt-2 flex flex-col gap-4">
        <XAnalyticsSection workspaceId={activeWorkspaceId} />
      </div>
      </>
      )}
      </>
      )}
    </div>
  )
}

// ── Dynamic, real-data view (shown whenever ≥1 live platform is connected) ──

function formatClock(v: string): string {
  const d = new Date(v)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function TimeChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null
  return (
    <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 text-[var(--text-secondary)]">{formatClock(label)}</div>
      <div className="font-semibold text-white">{formatCompactNumber(payload[0].value)}</div>
    </div>
  )
}

/** Honest caption under a StatCard value: "current" for stock levels, else the window. */
function currentCaption(item: DisplayItem): string {
  if (isLevelMetric(item.cap)) return 'current'
  const meta = WINDOW_META[item.window]
  return meta.isDelta ? `Δ ${meta.label.toLowerCase()}` : meta.label.toLowerCase()
}

function LiveAnalyticsView({
  workspaceId,
  connected,
  refreshToken,
  onExport,
  exporting,
  urlPlatform,
  onScopeChange,
  userId,
}: {
  workspaceId: string
  connected: IntegrationKey[]
  refreshToken: number
  onExport: () => void
  exporting: boolean
  urlPlatform: AnalyticsPlatformId | null
  onScopeChange: (next: AnalyticsPlatformId | null) => void
  userId: string | null
}) {
  const [dataset, setDataset] = useState<AnalyticsDataset | null>(null)
  const [metricReqOpen, setMetricReqOpen] = useState(false)
  // Multi-select selections: platforms + metric capabilities. An empty metric
  // selection (or the explicit OVERVIEW_ID) means "show everything available".
  const [selectedPlatforms, setSelectedPlatforms] = useState<AnalyticsPlatformId[]>([])
  // Metric selection: [OVERVIEW_ID] = show everything (the "total" toggle, the
  // default), [] = nothing selected (explicit empty), or specific capability ids.
  const [selectedMetricIds, setSelectedMetricIds] = useState<string[]>([OVERVIEW_ID])
  const [win, setWin] = useState<AnalyticsWindow>('7d')
  const connectedKey = connected.join(',')

  // Pull every real source in parallel. Guest-safe: `connected` is empty for
  useEffect(() => {
    if (!workspaceId || connected.length === 0) {
      setDataset(null)
      return
    }
    let cancelled = false
    Promise.all([
      fetchPlatformMetricRows(workspaceId, connected, 30).catch(() => [] as PlatformMetricDay[]),
      fetchMetricSnapshots(workspaceId, 6).catch(() => [] as MetricSnapshot[]),
      connected.includes('telegram')
        ? fetchMemberMessageTrend(workspaceId, 30, 'telegram').catch(() => [])
        : Promise.resolve([] as { date: string; value: number }[]),
      connected.includes('discord')
        ? fetchMemberMessageTrend(workspaceId, 30, 'discord').catch(() => [])
        : Promise.resolve([] as { date: string; value: number }[]),
      // Member tenure / retention, Discord only, and only once it has been
      // synced at least once. Failures degrade to "metric unavailable".
      connected.includes('discord')
        ? fetchTenure(workspaceId).catch(() => [] as TenureRecord[])
        : Promise.resolve([] as TenureRecord[]),
      connected.includes('discord')
        ? fetchMembershipSnapshots(workspaceId, 30).catch(() => [] as MembershipSnapshotRow[])
        : Promise.resolve([] as MembershipSnapshotRow[]),
      loadXAnalytics(workspaceId).catch(() => null),
    ]).then(([daily, snapshots, memberMessages, discordMessages, tenure, membershipSnapshots, x]) => {
      if (cancelled) return
      setDataset({
        connected: connected as AnalyticsPlatformId[],
        daily,
        snapshots,
        memberMessages,
        memberMessagesByPlatform: { telegram: memberMessages, discord: discordMessages },
        x,
        tenure,
        membershipSnapshots,
      })
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId, connectedKey, refreshToken])

  // Availability-driven options (all pure functions of the fetched dataset).
  const platformOptions = useMemo(() => platformOptionsFor(dataset), [dataset])
  const platformOptionsKey = platformOptions.join(',')

  // Honor `?platform=` on load, keep valid picks otherwise, else default to all
  // connected (non-aggregated) platforms so the Overview spans the community.
  useEffect(() => {
    if (platformOptions.length === 0) return
    setSelectedPlatforms((prev) => {
      if (urlPlatform && platformOptions.includes(urlPlatform)) return [urlPlatform]
      const valid = prev.filter((p) => platformOptions.includes(p))
      if (valid.length > 0) return valid
      const nonAgg = platformOptions.filter((p) => p !== 'aggregated')
      return nonAgg.length > 0 ? nonAgg : platformOptions
    })
  }, [platformOptionsKey, urlPlatform])

  // Empty is a real, honored state now (user cleared the filter), no snap-back.
  const scopePlatforms = selectedPlatforms
  const metricCaps = useMemo(() => metricOptionsFor(scopePlatforms, dataset), [scopePlatforms.join(','), dataset])
  const metricCapsKey = metricCaps.map(capId).join(',')
  const multiPlatformScope = new Set(metricCaps.map((c) => c.platform)).size > 1

  // Prune stale metric picks when the platform scope changes.
  useEffect(() => {
    setSelectedMetricIds((prev) => prev.filter((id) => id === OVERVIEW_ID || metricCaps.some((c) => capId(c) === id)))
    // metricCapsKey captures the meaningful change; metricCaps identity is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricCapsKey])

  const overview = selectedMetricIds.includes(OVERVIEW_ID)
  const selectedMetricKey = selectedMetricIds.join(',')
  const displayedCaps = useMemo(
    () => (overview ? metricCaps : metricCaps.filter((c) => selectedMetricIds.includes(capId(c)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, metricCapsKey, selectedMetricKey],
  )

  const windowOptions = useMemo(() => unionWindowOptions(displayedCaps, dataset), [displayedCaps, dataset])
  const windowKey = windowOptions.map((w) => `${w.window}:${w.enabled}`).join(',')
  // Keep the Range selection valid for the current metric mix.
  useEffect(() => {
    const enabled = windowOptions.filter((w) => w.enabled)
    if (enabled.length > 0 && !enabled.some((w) => w.window === win)) setWin(enabled[0].window)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey, win])

  const displayItems = useMemo(() => composeDisplay(displayedCaps, win, dataset), [displayedCaps, win, dataset])

  function handlePlatformChange(next: AnalyticsPlatformId[]) {
    // "Aggregated" is the total/global toggle: click → select every platform,
    // click again (when all are on) → clear to empty. Real platforms toggle
    // independently and CAN go down to zero (no snap-back to all).
    const real = platformOptions.filter((p) => p !== 'aggregated')
    const wasAll = real.length > 0 && real.every((p) => selectedPlatforms.includes(p))
    const shown = wasAll ? [...selectedPlatforms, 'aggregated' as AnalyticsPlatformId] : selectedPlatforms
    const aggToggled = next.includes('aggregated') !== shown.includes('aggregated')
    if (aggToggled) {
      const resolved = wasAll ? [] : real
      setSelectedPlatforms(resolved)
      onScopeChange(null)
      return
    }
    const resolved = next.filter((p) => p !== 'aggregated')
    setSelectedPlatforms(resolved)
    // Reflect a single-platform scope in the URL; clear it for multi/empty.
    onScopeChange(resolved.length === 1 ? resolved[0] : null)
  }

  function handleMetricChange(next: string[]) {
    // "Overview (all)" is the total toggle: click → everything, click again → none.
    // Real metrics toggle independently and CAN go down to zero.
    const shown = overview ? [OVERVIEW_ID] : selectedMetricIds
    const added = next.find((id) => !shown.includes(id))
    const removed = shown.find((id) => !next.includes(id))
    if (added === OVERVIEW_ID) {
      setSelectedMetricIds([OVERVIEW_ID]) // select all
      return
    }
    if (removed === OVERVIEW_ID) {
      setSelectedMetricIds([]) // clear all
      return
    }
    if (added) {
      setSelectedMetricIds(overview ? [added] : [...selectedMetricIds, added])
      return
    }
    if (removed) {
      setSelectedMetricIds((overview ? [] : selectedMetricIds).filter((id) => id !== removed))
    }
  }

  function metricOptionLabel(c: MetricCapability): string {
    return multiPlatformScope ? `${platformLabel(c.platform)} · ${c.label}` : c.label
  }

  // "Total" state for each multi-select: whether every real option is selected,
  // what the trigger should read, and (platform only) the checkbox set to show
  // "Aggregated" ticked when all are on.
  const realPlatformOpts = platformOptions.filter((p) => p !== 'aggregated')
  const platformsAll = realPlatformOpts.length > 0 && realPlatformOpts.every((p) => selectedPlatforms.includes(p))
  const platformShownSelected = platformsAll ? [...selectedPlatforms, 'aggregated' as AnalyticsPlatformId] : selectedPlatforms
  const platformSummary = selectedPlatforms.length === 0 ? 'None' : platformsAll ? 'All platforms' : undefined
  const metricSummary = overview ? 'Overview' : selectedMetricIds.length === 0 ? 'None' : undefined

  return (
    <>
      {/* Dynamic filter bar, Platform & Metric are multi-select; every option is
          backed by real data availability. Range stays a single time window. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <MultiSelectDropdown
          icon={<Monitor size={15} className="text-[var(--accent-emerald)]" />}
          label="Platform"
          options={platformOptions.map((p) => ({ id: p, label: p === 'aggregated' ? 'Aggregated (all)' : platformLabel(p) }))}
          selected={platformShownSelected}
          onChange={(ids) => handlePlatformChange(ids as AnalyticsPlatformId[])}
          summary={platformSummary}
          allLabel="None"
        />
        <MultiSelectDropdown
          icon={<BarChart3 size={15} className="text-[var(--accent-emerald)]" />}
          label="Metric"
          options={[
            { id: OVERVIEW_ID, label: 'Overview (all)' },
            ...metricCaps.map((c) => ({ id: capId(c), label: metricOptionLabel(c) })),
          ]}
          selected={overview ? [OVERVIEW_ID] : selectedMetricIds}
          onChange={handleMetricChange}
          summary={metricSummary}
          allLabel="None"
          footer={(close) => (
            <RequestMetricFooter
              onOpen={() => {
                close()
                setMetricReqOpen(true)
              }}
            />
          )}
        />
        <FilterDropdown
          icon={<Calendar size={15} className="text-[var(--accent-emerald)]" />}
          label="Range"
          options={windowOptions.map((w) => ({
            id: w.window,
            label: WINDOW_META[w.window].label,
            disabled: !w.enabled,
            hint: w.enabled ? undefined : 'not enough history yet',
          }))}
          value={win}
          onChange={(v) => setWin(v)}
        />
        <div className="ml-auto flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={onExport}
            loading={exporting}
            className="flex items-center gap-1.5 !px-3 !py-1.5 text-xs"
          >
            <FileSpreadsheet size={14} />
            Export to Google Sheets
          </Button>
        </div>
      </div>

      {/* Collapsible sections, one per connected platform. All closed by
          default; opening one reveals its metrics split into time-series
          (left) and current-value metrics (right). */}
      {displayItems.length > 0 && <PlatformSections items={displayItems} window={win} />}

      {displayItems.length === 0 && (
        <Card className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <p className="text-sm font-medium text-white">
            {dataset === null
              ? 'Loading live data…'
              : scopePlatforms.length === 0
                ? 'No platform selected'
                : !overview && selectedMetricIds.length === 0
                  ? 'No metric selected'
                  : 'No data for this selection yet'}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            {dataset === null
              ? 'Fetching the latest metrics from your connected platforms.'
              : scopePlatforms.length === 0
                ? 'Pick a platform from the filter, or click Aggregated to select them all.'
                : !overview && selectedMetricIds.length === 0
                  ? 'Pick a metric from the filter, or click Overview to show them all.'
                  : 'Tracking has just started, values will appear as snapshots accumulate.'}
          </p>
        </Card>
      )}

      {/* Member tenure & retention, Discord only, entirely real data. */}
      {connected.includes('discord') && (
        <div className="mt-2">
          <RetentionPanel workspaceId={workspaceId} />
        </div>
      )}

      <div className="mt-2">
        <AudiencePanel workspaceId={workspaceId} />
      </div>

      {(connected.includes('discord') || connected.includes('telegram')) && (
        <div className="mt-2">
          <TopChannelsPanel workspaceId={workspaceId} />
        </div>
      )}

      <div className="mt-2 flex flex-col gap-4">
        <XAnalyticsSection workspaceId={workspaceId} />
      </div>

      <RequestMetricModal
        open={metricReqOpen}
        onClose={() => setMetricReqOpen(false)}
        userId={userId}
        contextHint={`Analytics · ${scopePlatforms.map(platformLabel).join(', ') || 'all platforms'}`}
      />
    </>
  )
}

/** One current-value metric tile (no temporal chart), used in a section's right rail. */
function MetricTile({ item }: { item: DisplayItem }) {
  const value = `${formatCompactNumber(item.result.latest)}${item.result.suffix ?? ''}`
  const delta = item.result.deltaPct
  const positive = delta !== null && delta >= 0
  const negative = delta !== null && delta < 0
  const note = item.result.note ?? `Trend over ${WINDOW_META[item.window].label.toLowerCase()}`
  const spark = buildSpark(item.result.series)
  const gid = `spark-${capId(item.cap).replace(/[^a-z0-9]/gi, '')}`
  return (
    <div className="glass sf-card p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-[var(--text-secondary)]">{item.cap.label}</span>
        <span title={note} className={`sf-pill ${positive ? 'sf-pill-pos' : negative ? 'sf-pill-neg' : 'sf-pill-neutral'}`}>
          {positive && <ArrowUpRight size={12} />}
          {negative && <ArrowDownRight size={12} />}
          {delta === null && <Minus size={12} />}
          {delta === null ? 'n/a' : `${Math.abs(delta)}%`}
        </span>
      </div>
      <div className="sf-value text-[var(--text-primary)]">{value}</div>
      {spark && (
        <svg viewBox="0 0 240 40" preserveAspectRatio="none" className="mt-3 h-9 w-full">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={item.cap.color} stopOpacity="0.42" />
              <stop offset="1" stopColor={item.cap.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={spark.area} fill={`url(#${gid})`} />
          <path d={spark.line} fill="none" stroke={item.cap.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <div className="mt-2 text-[11px] text-[var(--text-muted)]">{currentCaption(item)}</div>
    </div>
  )
}

/**
 * The Cards view: one collapsible section per platform that actually has
 * data. Every section is closed by default. Inside,
 * the metrics split in two: time-series charts on the left, current-value
 * metrics (those without a real temporal series) on the right.
 */
function PlatformSections({ items, window: win }: { items: DisplayItem[]; window: AnalyticsWindow }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  // Group by platform, keeping a stable, canonical section order.
  const ORDER: AnalyticsPlatformId[] = ['discord', 'telegram', 'galxe', 'zealy']
  const byPlatform = new Map<AnalyticsPlatformId, DisplayItem[]>()
  for (const item of items) {
    const list = byPlatform.get(item.cap.platform) ?? []
    list.push(item)
    byPlatform.set(item.cap.platform, list)
  }
  const platforms = [
    ...ORDER.filter((p) => byPlatform.has(p)),
    ...[...byPlatform.keys()].filter((p) => p !== 'aggregated' && !ORDER.includes(p)),
  ]

  const sections: { key: string; label: string; items: DisplayItem[] }[] = platforms.map((p) => ({ key: p, label: platformLabel(p), items: byPlatform.get(p) ?? [] }))

  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => {
        const isOpen = open[section.key] ?? false
        // Charts need ≥2 real points; everything else is a current-value tile.
        const charts = section.items.filter((i) => i.result.series.length >= 2)
        const tiles = section.items.filter((i) => i.result.series.length < 2)
        const count = section.items.length
        const accent = section.items[0]?.cap.color ?? 'var(--accent-emerald)'
        return (
          <Card key={section.key} className="overflow-hidden p-0">
            <button
              type="button"
              onClick={() => toggle(section.key)}
              aria-expanded={isOpen}
              className="focus-ring flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
              <span className="text-sm font-semibold text-white">{section.label}</span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {`${count} metric${count === 1 ? '' : 's'} · ${WINDOW_META[win].label.toLowerCase()}`}
              </span>
              <ChevronDown
                size={16}
                className={`ml-auto shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isOpen && (
              <div className="border-t border-[var(--border-card)] p-4">
                {count === 0 ? (
                  <p className="text-[13px] text-[var(--text-secondary)]">No metric for this selection yet.</p>
                ) : (
                  <div className={`flex flex-col gap-4 ${charts.length > 0 && tiles.length > 0 ? 'lg:flex-row' : ''}`}>
                    {/* LEFT, metrics over time */}
                    {charts.length > 0 && (
                      <div className={`flex min-w-0 flex-col gap-4 ${tiles.length > 0 ? 'lg:flex-[2]' : 'w-full'}`}>
                        {charts.map((item) => (
                          <RealFocusedMetric
                            key={capId(item.cap)}
                            cap={item.cap}
                            platform={item.cap.platform}
                            window={item.window}
                            result={item.result}
                          />
                        ))}
                      </div>
                    )}

                    {/* RIGHT, metrics that aren't a function of time */}
                    {tiles.length > 0 && (
                      <div
                        className={
                          charts.length > 0
                            ? 'flex min-w-0 flex-col gap-3 lg:flex-[1]'
                            : 'grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4'
                        }
                      >
                        {tiles.map((item) => (
                          <MetricTile key={capId(item.cap)} item={item} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

/** Build a normalised sparkline (line + area) path from a real value series. */
function buildSpark(series: { value: number }[], w = 240, h = 40): { line: string; area: string } | null {
  if (series.length < 2) return null
  const vals = series.map((s) => s.value)
  const min = Math.min(...vals)
  const span = Math.max(...vals) - min || 1
  const stepX = w / (series.length - 1)
  const pts = series.map((s, i) => [i * stepX, h - ((s.value - min) / span) * (h - 4) - 2] as const)
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  return { line, area: `${line} L${w},${h} L0,${h} Z` }
}

function RealFocusedMetric({
  cap,
  platform,
  window: win,
  result,
}: {
  cap: MetricCapability
  platform: AnalyticsPlatformId
  window: AnalyticsWindow
  result: WindowResult
}) {
  const meta = WINDOW_META[win]
  const fmt = (n: number) => `${formatCompactNumber(n)}${result.suffix ?? ''}`
  const positive = (result.delta ?? result.deltaPct ?? 0) >= 0

  const deltaLine = (() => {
    if (result.isDelta) {
      if (result.delta == null) return 'first tracked point'
      const sign = result.delta >= 0 ? '+' : '−'
      return `Δ ${sign}${fmt(Math.abs(result.delta))} · last ${meta.hours}h`
    }
    if (result.deltaPct == null) return 'since tracking started'
    return `${result.deltaPct >= 0 ? '↑' : '↓'} ${Math.abs(result.deltaPct)}% vs start of period`
  })()

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            {cap.label} · {platformLabel(platform)}
          </h3>
          <p className="text-xs text-[var(--text-secondary)]">
            {meta.label}
            {result.note ? ` · ${result.note}` : ''}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white">{fmt(result.latest)}</div>
          <div className={`text-xs font-medium ${positive ? 'text-[var(--accent-emerald-bright)]' : 'text-red-400'}`}>
            {deltaLine}
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={result.series} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="liveFocusFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cap.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={cap.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={meta.isDelta ? formatClock : formatDay}
            stroke="var(--text-secondary)"
            tick={{ fontSize: 11 }}
            minTickGap={28}
          />
          <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} tickFormatter={formatCompactNumber} width={48} />
          <Tooltip
            content={meta.isDelta ? <TimeChartTooltip /> : <ChartTooltip />}
            cursor={{ stroke: 'rgba(120,170,255,0.35)', strokeWidth: 1 }}
          />
          <Area type="monotone" dataKey="value" stroke={cap.color} strokeWidth={2.5} fill="url(#liveFocusFill)" dot={result.series.length <= 2} activeDot={{ r: 4, fill: cap.color }} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}

function FocusedMetric({
  workspaceId,
  metric,
  platform,
  days,
  range,
}: {
  workspaceId: string
  metric: MetricId
  platform: PlatformId
  days: number
  range: RangeId
}) {
  const meta = METRICS.find((m) => m.id === metric)!
  const plat = PLATFORMS.find((p) => p.id === platform)!
  const series = useMemo(
    () => buildSeries(hashStr(`${workspaceId}-${metric}-${platform}`), days, meta.base, meta.amp, plat.mult),
    [workspaceId, metric, platform, days, meta.base, meta.amp, plat.mult],
  )
  const latest = series[series.length - 1]?.value ?? 0
  const first = series[0]?.value ?? 0
  const deltaPct = first > 0 ? Math.round(((latest - first) / first) * 100) : 0
  const total = series.reduce((s, p) => s + p.value, 0)
  const peak = series.reduce((m, p) => Math.max(m, p.value), 0)
  const fmt = (n: number) => `${formatCompactNumber(n)}${meta.suffix ?? ''}`

  const rangeLabel = RANGES.find((r) => r.id === range)!.label

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            {meta.label} · {plat.label}
          </h3>
          <p className="text-xs text-[var(--text-secondary)]">Last {rangeLabel}</p>
        </div>
        <div className="flex items-center gap-5">
          <div>
            <div className="text-2xl font-bold text-white">{fmt(latest)}</div>
            <div className={`text-xs font-medium ${deltaPct >= 0 ? 'text-[var(--accent-emerald-bright)]' : 'text-red-400'}`}>
              {deltaPct >= 0 ? '↑' : '↓'} {Math.abs(deltaPct)}% vs start
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-xs text-[var(--text-secondary)]">Peak {fmt(peak)}</div>
            <div className="text-xs text-[var(--text-secondary)]">Avg {fmt(Math.round(total / Math.max(1, series.length)))}</div>
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={series} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="focusFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={meta.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={meta.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDay} stroke="var(--text-secondary)" tick={{ fontSize: 11 }} minTickGap={28} />
          <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} tickFormatter={formatCompactNumber} width={48} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(120,170,255,0.35)', strokeWidth: 1 }} />
          <Area type="monotone" dataKey="value" stroke={meta.color} strokeWidth={2.5} fill="url(#focusFill)" dot={false} activeDot={{ r: 4, fill: meta.color }} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}
