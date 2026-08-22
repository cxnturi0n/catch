import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, ExternalLink, FileText, Loader2, Printer, RotateCw, Share2, Sparkles } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'
import { reportDataToHtml, reportDataToPlainText, type ReportData } from '../../lib/reportBuilder'
import type { IntegrationKey, Moderator } from '../../types'
import { fetchModerators } from '../../lib/db'
import { useReportHistory, type ReportHistoryEntry } from '../../hooks/useReportHistory'
import { PrintableReport } from './report/PrintableReport'
import { ShareReportModal } from './report/ShareReportModal'
import { ReportHistoryTable, type ReportContact } from './report/ReportHistoryTable'
import { ReportView } from './report/ReportView'
import { generateIntelligenceReport, type IntelligenceReportDoc } from '../../lib/api/misc'
import { toReportData } from '../../lib/intelligenceReport'
import { ReportScheduleControls } from './report/ReportScheduleControls'
import { platformLabel, type UiReportKind } from './report/reportMeta'
import type { ReportType } from '../../lib/reportModel'

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

/** Local YYYY-MM-DD for a date offset (used by the range inputs). */
function isoDay(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const ACTION_BTN =
  'flex items-center gap-2 rounded-xl border border-[var(--accent-emerald)]/45 bg-[var(--accent-emerald)]/[0.10] px-4 py-2.5 text-sm font-semibold text-[var(--accent-emerald-bright)] transition-all hover:bg-[var(--accent-emerald)]/20 hover:border-[var(--accent-emerald)]/70 hover:text-white'

const LIVE_PLATFORMS: IntegrationKey[] = ['discord', 'telegram', 'galxe', 'zealy']

export function Report() {
  const { workspaces, activeWorkspaceId, getWorkspaceIntegrations } = useWorkspace()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<ReportData | null>(null)
  const [doc, setDoc] = useState<IntelligenceReportDoc | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [printData, setPrintData] = useState<ReportData | null>(null)
  const [copied, setCopied] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [uiKind, setUiKind] = useState<UiReportKind>('overview')
  const [singlePlatform, setSinglePlatform] = useState<IntegrationKey | ''>('')
  const [rangeStart, setRangeStart] = useState(() => isoDay(-7))
  const [rangeEnd, setRangeEnd] = useState(() => isoDay(0))
  const [contacts, setContacts] = useState<ReportContact[]>([])
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
    setLoading(false)
    setReport(null)
    setDoc(null)
    setGenError(null)
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
    // Guard against an inverted range (swap so start <= end).
    const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd
    const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart
    setLoading(true)
    setCopied(false)
    setGenError(null)

    // The server builds the whole document (fixed structure, SQL-computed
    // numbers, rule insights); the client only lays it out. Platform filter
    // applies to the platforms the backend tracks activity for.
    const serverPlatform = platform === 'discord' || platform === 'telegram' ? platform : null
    void generateIntelligenceReport(workspace.id, { period: 'custom', start, end, scope: kind === 'moderation' ? 'moderation' : 'overview', platform: serverPlatform })
      .then(({ id, report: serverDoc }) => {
        // Guard against a workspace switch mid-generation.
        if (activeWorkspaceIdRef.current !== workspace.id) return
        setDoc(serverDoc)
        setReport(toReportData(serverDoc))
        addEntry(id, serverDoc)
      })
      .catch((e: unknown) => {
        if (activeWorkspaceIdRef.current !== workspace.id) return
        setGenError(e instanceof Error ? e.message : 'Could not generate the report')
      })
      .finally(() => {
        if (activeWorkspaceIdRef.current === workspace.id) setLoading(false)
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


          {doc ? <ReportView doc={doc} /> : null}
        </div>
      )}

      <ReportHistoryTable
        entries={history}
        onView={handleHistoryView}
        onDownloadPdf={handleHistoryDownloadPdf}
        contacts={contacts}
      />

      {genError && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{genError}</div>}
      <ShareReportModal open={shareOpen} onClose={() => setShareOpen(false)} data={report} />

      <PrintableReport data={printData} />
    </div>
  )
}

