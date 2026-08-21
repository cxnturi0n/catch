import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, ExternalLink, FileText, Loader2, Printer, RotateCw, Share2, Sparkles } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'
import { buildReportData, reportDataToHtml, reportDataToPlainText, type BuildReportInput, type ReportData } from '../../lib/reportBuilder'
import { formatCount, type ModeratorChartInput, type PaymentSummaryInput, type ReportType, type UnifiedOverview } from '../../lib/reportModel'
import type { IntegrationKey, Moderator } from '../../types'
import { fetchConversionConfig, fetchIncidents, fetchKOLs, fetchMemberMessageTrend, fetchModeratorMetrics, fetchModerators, fetchPayments, fetchPlatformMetricRows, fetchPlatformMetrics, fetchPointsConfig, fetchTasks } from '../../lib/db'
import { fetchActivityBuckets } from '../../lib/activityHeatmap'
import { computeCoverageGaps, coverageGapReportLines } from '../../lib/coverageGap'
import { cellKey } from './moderators/comp'
import { buildRollup, rollupToActivityInput } from './moderators/report'
import { useReportHistory, type ReportHistoryEntry } from '../../hooks/useReportHistory'
import { PrintableReport } from './report/PrintableReport'
import { ShareReportModal } from './report/ShareReportModal'
import { ReportHistoryTable, type ReportContact } from './report/ReportHistoryTable'
import { ReportPreview } from './report/ReportPreview'
import { ReportScheduleControls } from './report/ReportScheduleControls'
import { platformLabel, type ReportDataWithMeta, type UiReportKind } from './report/reportMeta'

/** The three control-bar report kinds and their blurbs. */
const UI_KINDS: { id: UiReportKind; label: string; blurb: string }[] = [
  { id: 'overview', label: 'Overview', blurb: 'Aggregated community report across all connected platforms.' },
  { id: 'single', label: 'Single platform', blurb: 'Community report scoped to one connected platform.' },
  { id: 'moderation', label: 'Moderation', blurb: 'Moderator activity, payments and shift-coverage analysis.' },
]

/** Kind → the builder report type it maps to. */
function reportTypeForKind(kind: UiReportKind): ReportType {
  return kind === 'moderation' ? 'general' : 'community'
}

const TIME_HORIZONS = [7, 14, 30, 60, 90]

interface GeneralData {
  moderatorActivity?: BuildReportInput['moderatorActivity']
  moderator?: ModeratorChartInput
  payments?: PaymentSummaryInput
}

/** Local YYYY-MM-DD for a date offset (used by the range inputs). */
function isoDay(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

/**
 * Best-effort: pull the moderator compensation rollup + payments and shape them
 * into both the text lines and the chart-ready inputs the general report uses.
 * Signed-in only — never fires a Supabase call for a guest session.
 */
async function loadGeneralData(workspaceId: string, periodStart: string, periodEnd: string): Promise<GeneralData> {
  try {
    const [moderators, metrics, conversion, metricValues, payments] = await Promise.all([
      fetchModerators(workspaceId),
      fetchPointsConfig(workspaceId),
      fetchConversionConfig(workspaceId),
      fetchModeratorMetrics(workspaceId),
      fetchPayments(workspaceId).catch(() => []),
    ])

    const out: GeneralData = {}

    if (moderators.length > 0) {
      const values: Record<string, number> = {}
      for (const v of metricValues) values[cellKey(v.moderatorId, v.metricKey)] = v.value
      const rollup = buildRollup(moderators, metrics, values, conversion ?? { rate: 0.01, currency: 'USD' })
      out.moderatorActivity = rollupToActivityInput(rollup) ?? undefined

      const platformPoints = new Map<string, number>()
      for (const rep of rollup.reports) {
        for (const p of rep.platforms) platformPoints.set(p.platform, (platformPoints.get(p.platform) ?? 0) + p.points)
      }
      out.moderator = {
        byModerator: rollup.reports.map((r) => ({ name: r.moderator.fullName, points: r.totalPoints, share: r.share })),
        byPlatform: [...platformPoints.entries()].map(([platform, points]) => ({ platform, points })),
        currency: rollup.currency,
        totalMoney: rollup.totalMoney,
        activeCount: rollup.activeCount,
        totalCount: rollup.reports.length,
      }
    }

    // Payments within the selected window, aggregated per moderator.
    const nameById = new Map(moderators.map((m) => [m.id, m.fullName]))
    const start = new Date(periodStart).getTime()
    const end = new Date(periodEnd).getTime() + 86_400_000 - 1
    const inRange = payments.filter((p) => {
      const t = new Date(p.paidAt).getTime()
      return !Number.isNaN(t) && t >= start && t <= end
    })
    if (inRange.length > 0) {
      const byMod = new Map<string, number>()
      for (const p of inRange) {
        const name = nameById.get(p.moderatorId) ?? 'Unknown'
        byMod.set(name, (byMod.get(name) ?? 0) + p.amount)
      }
      out.payments = {
        totalPaid: inRange.reduce((s, p) => s + p.amount, 0),
        currency: inRange[0].currency || 'USD',
        count: inRange.length,
        byModerator: [...byMod.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
      }
    }

    return out
  } catch {
    return {}
  }
}

/**
 * Coverage-gap section: crosses community activity-by-hour with moderator shift
 * windows. Signed-in only; returns undefined when there's nothing to say so the
 * report simply omits the section.
 */
async function loadCoverageGap(workspaceId: string): Promise<BuildReportInput['coverageGap'] | undefined> {
  try {
    const [buckets, moderators] = await Promise.all([
      fetchActivityBuckets(workspaceId, 28).catch(() => []),
      fetchModerators(workspaceId).catch(() => []),
    ])
    const result = computeCoverageGaps(buckets, moderators)
    if (!result.hasActivityData && !result.hasShiftData) return undefined
    return coverageGapReportLines(result)
  } catch {
    return undefined
  }
}

/**
 * Real community data from Supabase (members, messages, incidents, KOLs, tasks)
 * for a signed-in workspace, shaped into the report's `live` override. Falls
 * back to undefined on any failure so the builder uses the mock dataset instead.
 */
async function loadLiveData(
  workspaceId: string,
  connected: IntegrationKey[],
): Promise<BuildReportInput['live'] | undefined> {
  try {
    const [incidents, kols, tasks, metrics, msgTrend, platformRows] = await Promise.all([
      fetchIncidents(workspaceId).catch(() => []),
      fetchKOLs(workspaceId).catch(() => []),
      fetchTasks(workspaceId).catch(() => []),
      connected.length > 0 ? fetchPlatformMetrics(workspaceId, connected, 30).catch(() => null) : Promise.resolve(null),
      fetchMemberMessageTrend(workspaceId, 30).catch(() => []),
      connected.length > 0 ? fetchPlatformMetricRows(workspaceId, connected, 30).catch(() => []) : Promise.resolve([]),
    ])

    // Nothing real to show → let the mock fallback take over.
    if (incidents.length === 0 && kols.length === 0 && tasks.length === 0 && !metrics && msgTrend.length === 0) {
      return undefined
    }

    const membersTrend = metrics?.trend ?? []
    const activeMembers = metrics?.latestMembers ?? (membersTrend.at(-1)?.value ?? 0)
    const firstMembers = membersTrend[0]?.value ?? activeMembers
    const activeMembersDelta =
      firstMembers > 0 && membersTrend.length >= 2 ? Math.round(((activeMembers - firstMembers) / firstMembers) * 100) : null
    const newMembers = Math.max(0, activeMembers - firstMembers)

    const last7 = msgTrend.slice(-7).reduce((s, p) => s + p.value, 0)
    const prev7 = msgTrend.slice(-14, -7).reduce((s, p) => s + p.value, 0)
    const messagesDelta = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null

    return {
      stats: {
        activeMembers,
        activeMembersDelta,
        newMembers,
        newMembersDelta: null,
        messagesWeek: last7,
        messagesDelta,
        scamAlertsBlocked: incidents.length,
        scamAlertsDelta: null,
      },
      incidents,
      kols,
      tasks,
      membersTrend,
      messagesTrend: msgTrend,
      platformRows,
    }
  } catch {
    return undefined
  }
}

const ACTION_BTN =
  'flex items-center gap-2 rounded-xl border border-[var(--accent-emerald)]/45 bg-[var(--accent-emerald)]/[0.10] px-4 py-2.5 text-sm font-semibold text-[var(--accent-emerald-bright)] transition-all hover:bg-[var(--accent-emerald)]/20 hover:border-[var(--accent-emerald)]/70 hover:text-white'

const LIVE_PLATFORMS: IntegrationKey[] = ['discord', 'telegram', 'galxe', 'zealy']

export function Report() {
  const { workspaces, activeWorkspaceId, getWorkspaceIntegrations } = useWorkspace()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<ReportData | null>(null)
  const [printData, setPrintData] = useState<ReportData | null>(null)
  const [copied, setCopied] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [uiKind, setUiKind] = useState<UiReportKind>('overview')
  const [singlePlatform, setSinglePlatform] = useState<IntegrationKey | ''>('')
  const [rangeStart, setRangeStart] = useState(() => isoDay(-7))
  const [rangeEnd, setRangeEnd] = useState(() => isoDay(0))
  const [contacts, setContacts] = useState<ReportContact[]>([])
  const timeoutRef = useRef<number | null>(null)
  const shouldPrintRef = useRef(false)
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  activeWorkspaceIdRef.current = activeWorkspaceId

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const { entries: history, addEntry } = useReportHistory(activeWorkspaceId)
  const canPersistSchedule = Boolean(user) && !activeWorkspaceId.startsWith('local-')
  const reportType = reportTypeForKind(uiKind)

  // Platforms currently connected for this workspace (drives the Single-platform picker).
  const connectedPlatforms: IntegrationKey[] = activeWorkspace
    ? LIVE_PLATFORMS.filter((p) => getWorkspaceIntegrations(activeWorkspace.id)[p]?.status === 'Connected')
    : []

  // Workspace switched — cancel any in-flight generation and clear the
  // stale report so we never render/apply a result for the wrong workspace.
  useEffect(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setLoading(false)
    setReport(null)
    setPrintData(null)
    setCopied(false)
    setSinglePlatform('')
  }, [activeWorkspaceId])

  // Build the "Share with…" contact list: workspace moderators that have an
  // email (signed-in only), plus the signed-in user's own address. Guests get
  // just their own (if any) so the picker still works with a custom email.
  useEffect(() => {
    const own: ReportContact[] = user?.email ? [{ name: `${user.name} (you)`, email: user.email }] : []
    if (!user || activeWorkspaceId.startsWith('local-')) {
      setContacts(own)
      return
    }
    let cancelled = false
    fetchModerators(activeWorkspaceId)
      .then((mods) => {
        if (cancelled) return
        const modContacts: ReportContact[] = mods
          .map((m) => ({ name: m.fullName, email: (m as Moderator & { email?: string | null }).email ?? '' }))
          .filter((c) => c.email.trim().length > 0)
        setContacts([...own, ...modContacts])
      })
      .catch(() => {
        if (!cancelled) setContacts(own)
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, user])

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    }
  }, [])

  // Print is invoked from an effect (not directly in the click handler) so
  // it always runs after `printData` has actually committed to the DOM.
  useEffect(() => {
    if (shouldPrintRef.current && printData) {
      shouldPrintRef.current = false
      const id = requestAnimationFrame(() => window.print())
      return () => cancelAnimationFrame(id)
    }
  }, [printData])

  function triggerPrint(data: ReportData) {
    shouldPrintRef.current = true
    setPrintData(data)
  }

  function handleGenerate() {
    if (!activeWorkspace) return
    // Single-platform reports need a platform chosen.
    if (uiKind === 'single' && !singlePlatform) return
    const workspace = activeWorkspace
    const kind = uiKind
    const platform = kind === 'single' ? (singlePlatform as IntegrationKey) : null
    // Guard against an inverted range (swap so periodStart <= periodEnd).
    const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd
    const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart
    const periodStart = new Date(`${start}T00:00:00`).toISOString()
    const periodEnd = new Date(`${end}T00:00:00`).toISOString()
    const type = reportTypeForKind(kind)
    const isModeration = kind === 'moderation'
    setLoading(true)
    setCopied(false)

    // Moderation folds in Supabase-backed moderator activity + payments (signed-in
    // only); the community-mapped kinds use workspace analytics alone.
    const dataPromise: Promise<GeneralData> =
      isModeration && user ? loadGeneralData(workspace.id, periodStart, periodEnd) : Promise.resolve<GeneralData>({})
    // Shift coverage is now implicit in Moderation — always computed there, never elsewhere.
    const coveragePromise: Promise<BuildReportInput['coverageGap'] | undefined> =
      isModeration && user ? loadCoverageGap(workspace.id) : Promise.resolve(undefined)
    // Real community numbers from the DB for signed-in workspaces; falls back to
    // mock when nothing real. Single-platform restricts metrics to the one platform.
    const allConnected = user
      ? LIVE_PLATFORMS.filter((p) => getWorkspaceIntegrations(workspace.id)[p]?.status === 'Connected')
      : []
    const connected = platform ? allConnected.filter((p) => p === platform) : allConnected
    const livePromise: Promise<BuildReportInput['live'] | undefined> =
      user ? loadLiveData(workspace.id, connected) : Promise.resolve(undefined)
    const delay = new Promise<void>((resolve) => {
      timeoutRef.current = window.setTimeout(resolve, 1400)
    })

    void Promise.all([dataPromise, coveragePromise, livePromise, delay]).then(([general, coverageGap, live]) => {
      // Guard against a workspace switch mid-generation.
      if (activeWorkspaceIdRef.current !== workspace.id) return
      // Single-platform title/labels reflect the chosen platform.
      const label = platform ? platformLabel(platform) : null
      const builderWorkspace = label ? { ...workspace, name: `${workspace.name} · ${label}` } : workspace
      const data = buildReportData(builderWorkspace, {
        reportType: type,
        periodStart,
        periodEnd,
        moderatorActivity: general.moderatorActivity,
        coverageGap,
        live,
        moderator: general.moderator,
        payments: general.payments,
      })
      // Attach presentation-only metadata so History can label the kind.
      const enriched: ReportDataWithMeta = {
        ...data,
        uiKind: kind,
        platform: platform ?? undefined,
        platformLabel: label ?? undefined,
      }
      setReport(enriched)
      addEntry(enriched)
      setLoading(false)
      timeoutRef.current = null
    })
  }

  async function handleCopy() {
    if (!report) return
    try {
      await navigator.clipboard.writeText(reportDataToPlainText(report))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable — silently ignore, the text is still on screen.
    }
  }

  function handleViewReport() {
    if (!report) return
    const html = reportDataToHtml(report)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  function handleHistoryDownloadPdf(entry: ReportHistoryEntry) {
    triggerPrint(entry.data)
  }

  function handleHistoryView(entry: ReportHistoryEntry) {
    const html = reportDataToHtml(entry.data)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6 print:hidden">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent-purple)] via-[var(--accent-cyan)] to-[var(--accent-emerald-bright)] text-white shadow-[var(--glow-emerald)]">
            <FileText size={20} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Report Generator</h3>
            <p className="text-xs text-[var(--text-secondary)]">{activeWorkspace?.name}</p>
          </div>
        </div>

        {/* Setup on the LEFT, email-schedule fill-in on the RIGHT. */}
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
          {/* ── LEFT: report setup + small Generate button ── */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              {/* TYPE dropdown */}
              <label className="flex min-w-[10rem] flex-col gap-1.5 text-xs">
                <span className="font-medium uppercase tracking-wide text-[var(--text-secondary)]">Report type</span>
                <div className="relative">
                  <select
                    value={uiKind}
                    onChange={(e) => {
                      const next = e.target.value as UiReportKind
                      setUiKind(next)
                      // Default the platform picker to the first connected platform.
                      if (next === 'single' && !singlePlatform && connectedPlatforms.length > 0) {
                        setSinglePlatform(connectedPlatforms[0])
                      }
                    }}
                    className="focus-ring w-full appearance-none rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] py-2.5 pl-3 pr-9 text-sm text-white outline-none transition-colors hover:border-white/20"
                  >
                    {UI_KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                </div>
              </label>

              {/* SECOND dropdown — only for Single platform */}
              {uiKind === 'single' && (
                <label className="flex min-w-[10rem] flex-col gap-1.5 text-xs">
                  <span className="font-medium uppercase tracking-wide text-[var(--text-secondary)]">Platform</span>
                  <div className="relative">
                    <select
                      value={singlePlatform}
                      onChange={(e) => setSinglePlatform(e.target.value as IntegrationKey)}
                      disabled={connectedPlatforms.length === 0}
                      className="focus-ring w-full appearance-none rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] py-2.5 pl-3 pr-9 text-sm text-white outline-none transition-colors hover:border-white/20 disabled:opacity-50"
                    >
                      {connectedPlatforms.length === 0 && <option value="">No connected platforms</option>}
                      {connectedPlatforms.map((p) => (
                        <option key={p} value={p}>
                          {platformLabel(p)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  </div>
                </label>
              )}
            </div>

            {/* TIME HORIZON — date inputs */}
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1.5 text-xs">
                <span className="font-medium uppercase tracking-wide text-[var(--text-secondary)]">From</span>
                <input
                  type="date" lang="en-US"
                  value={rangeStart}
                  max={rangeEnd}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className="focus-ring rounded-xl border border-[var(--border-card)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-white outline-none [color-scheme:dark]"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs">
                <span className="font-medium uppercase tracking-wide text-[var(--text-secondary)]">To</span>
                <input
                  type="date" lang="en-US"
                  value={rangeEnd}
                  min={rangeStart}
                  max={isoDay(0)}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className="focus-ring rounded-xl border border-[var(--border-card)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-white outline-none [color-scheme:dark]"
                />
              </label>
            </div>

            {/* Quick horizon buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Last</span>
              {TIME_HORIZONS.map((days) => {
                const active = rangeEnd === isoDay(0) && rangeStart === isoDay(-days)
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => {
                      setRangeStart(isoDay(-days))
                      setRangeEnd(isoDay(0))
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                      active
                        ? 'border-[var(--accent-emerald)]/60 bg-[var(--accent-emerald)]/[0.12] text-white'
                        : 'border-[var(--border-card)] text-slate-300 hover:bg-white/[0.04] hover:text-white'
                    }`}
                  >
                    {days} days
                  </button>
                )
              })}
            </div>

            <p className="text-[11px] leading-snug text-[var(--text-muted)]">
              {UI_KINDS.find((k) => k.id === uiKind)?.blurb}
            </p>

            {/* Generate — small */}
            <Button
              onClick={handleGenerate}
              loading={loading}
              disabled={uiKind === 'single' && !singlePlatform}
              size="sm"
              className="w-fit"
            >
              {!loading && <Sparkles size={16} />}
              {loading ? 'Generating…' : 'Generate report'}
            </Button>
          </div>

          {/* ── RIGHT: email automation (fill-in), report type comes from the left ── */}
          <ReportScheduleControls
            workspaceId={activeWorkspaceId}
            canPersist={canPersistSchedule}
            defaultEmail={user?.email ?? ''}
            currentReportType={reportType}
          />
        </div>
      </Card>

      {loading && (
        <Card className="flex items-center justify-center gap-3 p-10 text-[var(--text-secondary)] print:hidden">
          <Loader2 size={18} className="animate-spin" />
          Analyzing workspace data…
        </Card>
      )}

      {report && !loading && (
        <div className="flex flex-col gap-4 print:hidden">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={handleCopy} className={ACTION_BTN}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy to clipboard'}
            </button>
            <button onClick={handleViewReport} className={ACTION_BTN}>
              <ExternalLink size={16} /> View report
            </button>
            <button onClick={() => triggerPrint(report)} className={ACTION_BTN}>
              <Printer size={16} /> Download PDF
            </button>
            <button onClick={() => setShareOpen(true)} className={ACTION_BTN}>
              <Share2 size={16} /> Share report
            </button>
            <button onClick={handleGenerate} className={ACTION_BTN}>
              <RotateCw size={16} /> Regenerate
            </button>
          </div>

          {report.model.unified && <UnifiedOverviewCard unified={report.model.unified} />}

          <ReportPreview data={report} />
        </div>
      )}

      <ReportHistoryTable
        entries={history}
        onView={handleHistoryView}
        onDownloadPdf={handleHistoryDownloadPdf}
        contacts={contacts}
      />

      <ShareReportModal open={shareOpen} onClose={() => setShareOpen(false)} data={report} />

      <PrintableReport data={printData} />
    </div>
  )
}

/**
 * Cross-platform "Unified overview" card — the discovery headline made concrete:
 * one panel that sums every connected platform. Renders ONLY from the real
 * `model.unified` rollup (built in reportModel from actual Supabase rows); the
 * total is honestly labelled as subscriptions, not unique users.
 */
function UnifiedOverviewCard({ unified }: { unified: UnifiedOverview }) {
  const maxMembers = Math.max(...unified.platforms.map((p) => p.members), 1)
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--accent-cyan)]/30 bg-gradient-to-br from-[var(--accent-cyan)]/[0.06] via-[var(--bg-card)] to-[var(--bg-card)]">
      <div className="flex flex-col gap-1 border-b border-[var(--border-card)] px-6 py-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-cyan)]">Unified overview</span>
        <h3 className="text-base font-bold text-white">One dashboard across {unified.platformCount} connected platforms</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-[minmax(0,1fr)_auto]">
        {/* Hero total */}
        <div className="rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Total subscriptions</div>
          <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-white">{formatCount(unified.totalMembers)}</div>
          <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{unified.totalMembersNote}</div>
        </div>

        {/* Combined message volume, only when a platform tracks it */}
        {unified.combinedMessages !== undefined && (
          <div className="rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-5 sm:min-w-[11rem]">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Combined messages</div>
            <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-white">{formatCount(unified.combinedMessages)}</div>
            <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{unified.messagesNote}</div>
          </div>
        )}
      </div>

      {/* Per-platform breakdown — bars sized by share of total subscriptions */}
      <div className="flex flex-col gap-2.5 px-6 pb-6">
        {unified.platforms.map((p) => {
          const share = unified.totalMembers > 0 ? Math.round((p.members / unified.totalMembers) * 100) : 0
          const width = Math.max(4, Math.round((p.members / maxMembers) * 100))
          return (
            <div key={p.platform} className="rounded-xl border border-[var(--border-card)] bg-white/[0.015] px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="truncate text-sm font-semibold text-white">{p.label}</span>
                  <span className="shrink-0 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">{p.memberLabel}</span>
                </div>
                <div className="flex shrink-0 items-baseline gap-2">
                  <span className="font-mono text-sm font-bold tabular-nums text-white">{formatCount(p.members)}</span>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">{share}%</span>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
                <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: p.color }} />
              </div>
              {p.keyMetric && (
                <div className="mt-1.5 text-[11px] text-[var(--text-secondary)]">
                  {p.keyMetric.label}: <span className="font-mono tabular-nums text-slate-300">{formatCount(p.keyMetric.value)}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
