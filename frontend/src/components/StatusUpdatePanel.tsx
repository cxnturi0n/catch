import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react'
import { CatchMark } from './brand/CatchMark'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useLang } from '../i18n/LanguageContext'
import { buildRecap, type RecapData } from '../lib/recapData'
import { fetchModerators } from '../lib/db'
import {
  buildSnapshot,
  connectedRecapPlatforms,
  summariseCoverage,
  writeStatusUpdate,
  type StatusUpdate,
} from '../lib/statusUpdate'
import { formatCompactNumber } from '../lib/format'
import type { Moderator } from '../types'

const pad = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`

function pct(v: number | null): string {
  if (v === null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

/**
 * The at-a-glance briefing behind the topbar button: real numbers per platform,
 * today's coverage, and a written summary. Every press re-reads the data and
 * re-writes the summary, so it reflects the moment it was opened.
 */
export function StatusUpdatePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { activeWorkspaceId, workspaces, getWorkspaceIntegrations } = useWorkspace()
  const { lang } = useLang()

  const [loading, setLoading] = useState(false)
  const [recap, setRecap] = useState<RecapData | null>(null)
  const [moderators, setModerators] = useState<Moderator[]>([])
  const [update, setUpdate] = useState<StatusUpdate | null>(null)

  const workspaceName = workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? 'this workspace'

  const refresh = useCallback(async () => {
    if (!user || !activeWorkspaceId) return
    setLoading(true)
    try {
      const integrations = getWorkspaceIntegrations(activeWorkspaceId)
      const connected = connectedRecapPlatforms(integrations)
      const [data, mods] = await Promise.all([
        buildRecap(activeWorkspaceId, connected),
        fetchModerators(activeWorkspaceId).catch(() => [] as Moderator[]),
      ])
      setRecap(data)
      setModerators(mods)
      const snapshot = buildSnapshot(workspaceName, data, integrations, mods)
      setUpdate(await writeStatusUpdate(snapshot, data, lang))
    } finally {
      setLoading(false)
    }
  }, [user, activeWorkspaceId, getWorkspaceIntegrations, workspaceName, lang])

  // Every open is a fresh read — a stale briefing is worse than none.
  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!open) return null

  const coverage = recap ? moderators : []
  const onShift = coverage.length

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 print:hidden" onClick={onClose} />
      <div className="fixed inset-x-0 top-16 z-50 mx-auto flex max-h-[calc(100vh-6rem)] w-[min(920px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] print:hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[var(--border-card)] px-5 py-3.5">
          <CatchMark size={24} variant="gold" play={false} />
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-[var(--text-primary)]">Status Update</div>
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(230,184,77,0.7)]">
              {workspaceName}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh"
              className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && !update ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-secondary)]">
              <Loader2 size={18} className="animate-spin" /> Reading your community…
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {/* The written briefing */}
              {update && (
                <div className="rounded-2xl border border-[color:rgba(230,184,77,0.28)] bg-[color:rgba(230,184,77,0.06)] p-4">
                  <h2 className="text-[17px] font-bold text-[var(--text-primary)]">{update.headline}</h2>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{update.body}</p>
                  {update.watch.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {update.watch.map((w) => (
                        <li key={w} className="flex items-start gap-2 text-[12.5px] text-[var(--text-secondary)]">
                          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[color:rgba(230,184,77,0.9)]" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    {update.fromAI ? `written by Catch Intelligence · ${update.model ?? 'ai'}` : 'computed from your data'}
                  </div>
                </div>
              )}

              {/* Per-platform real metrics */}
              {recap && recap.sections.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {recap.sections.map((s) => (
                    <div key={s.platform} className="glass sf-card p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--text-secondary)]">{s.label}</span>
                        {s.headlinePct !== null && (
                          <span
                            className={`sf-pill ${s.headlinePct >= 0 ? 'sf-pill-pos' : 'sf-pill-neg'}`}
                          >
                            {pct(s.headlinePct)}
                          </span>
                        )}
                      </div>
                      <div className="sf-value mt-2 text-[var(--text-primary)]">
                        {s.headline ? formatCompactNumber(s.headline.value) : '—'}
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                        {s.headline?.label ?? 'no headline metric'}
                      </div>
                      {s.metrics.length > 0 && (
                        <div className="mt-3 flex flex-col gap-1 border-t border-[var(--border-card)] pt-2">
                          {s.metrics.map((m) => (
                            <div key={m.label} className="flex items-center justify-between text-[11.5px]">
                              <span className="text-[var(--text-muted)]">{m.label}</span>
                              <span className="font-mono text-[var(--text-secondary)]">{formatCompactNumber(m.value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--border-card)] p-6 text-center text-[13px] text-[var(--text-secondary)]">
                  No platform is reporting data yet.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      navigate('/dashboard/integrations')
                    }}
                    className="font-semibold text-[var(--accent-emerald-bright)] hover:underline"
                  >
                    Connect one
                  </button>
                </div>
              )}

              {/* Coverage — the ops half of the briefing */}
              {onShift > 0 && (
                <CoverageStrip moderators={moderators} onOpen={() => { onClose(); navigate('/dashboard/moderators') }} />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function CoverageStrip({ moderators, onOpen }: { moderators: Moderator[]; onOpen: () => void }) {
  // Recomputed from the same helper the AI snapshot uses, so the strip can
  // never disagree with the briefing above it.
  const c = summariseCoverage(moderators)
  return (
    <div className="glass sf-card flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">On shift now</div>
        <div className="text-[15px] font-semibold text-[var(--text-primary)]">
          {c.onShiftNow} of {c.moderators}
        </div>
      </div>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Coverage</div>
        <div className="text-[15px] font-semibold text-[var(--text-primary)]">{c.hoursCovered}h / 24</div>
      </div>
      {c.gap && c.gap.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Uncovered</div>
          <div className="font-mono text-[15px] font-semibold text-[#ff8f7f]">
            {pad(c.gap.start)}–{pad(c.gap.end)} UTC
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="ml-auto text-[12.5px] font-semibold text-[var(--accent-emerald-bright)] hover:underline"
      >
        Open Moderators →
      </button>
    </div>
  )
}
