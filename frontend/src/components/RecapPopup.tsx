import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { toBlob } from 'html-to-image'
import { AlertTriangle, ArrowRight, Camera, CheckCircle2, PlugZap, ShieldAlert, Sparkles, TrendingDown, TrendingUp, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToast } from '../context/ToastContext'
import {
  buildRecap,
  buildRecapInsights,
  formatDelta,
  formatNumber,
  RECAP_PLATFORMS,
  type RecapAlert,
  type RecapData,
  type RecapInsights,
  type RecapSection,
} from '../lib/recapData'

const RECAP_KEY = 'catch:recap:lastShown'
const TWO_HOURS_MS = 7_200_000

function readLastShown(): number {
  try {
    const raw = localStorage.getItem(RECAP_KEY)
    return raw ? Number(raw) || 0 : 0
  } catch {
    return 0
  }
}

function writeLastShown(ts: number) {
  try {
    localStorage.setItem(RECAP_KEY, String(ts))
  } catch {
    // localStorage unavailable — the recap will simply show again next mount.
  }
}

/** Small delta pill — green up / red down / neutral. */
function DeltaPill({ delta, pct }: { delta: number | null; pct: number | null }) {
  if (delta === null || delta === 0) return null
  const up = delta > 0
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
        up ? 'border-[#34d399]/30 bg-[#34d399]/12 text-[#5eead4]' : 'border-[#f87171]/30 bg-[#f87171]/12 text-[#fca5a5]'
      }`}
    >
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {formatDelta(delta)}
      {pct !== null && <span className="opacity-70">({up ? '+' : ''}{pct.toFixed(pct >= 100 || pct <= -100 ? 0 : 1)}%)</span>}
    </span>
  )
}

function PlatformSection({ section }: { section: RecapSection }) {
  return (
    <div className="rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white">{section.label}</span>
        <DeltaPill delta={section.headlineDelta} pct={section.headlinePct} />
      </div>
      {section.headline ? (
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-white">{formatNumber(section.headline.value)}</span>
          <span className="text-xs text-[var(--text-secondary)]">{section.headline.label}</span>
        </div>
      ) : (
        <div className="text-sm text-[var(--text-secondary)]">No headline metric reported</div>
      )}
      {section.metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {section.metrics.map((m) => (
            <div key={m.label} className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold text-[var(--accent-emerald-bright)]">{formatNumber(m.value)}</span>
              <span className="text-xs text-[var(--text-secondary)]">{m.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const ALERT_STYLE: Record<RecapAlert['level'], { ring: string; icon: typeof AlertTriangle; tint: string }> = {
  critical: { ring: 'border-[#f87171]/30 bg-[#f87171]/[0.08]', icon: ShieldAlert, tint: 'text-[#fca5a5]' },
  warning: { ring: 'border-[#fbbf24]/30 bg-[#fbbf24]/[0.08]', icon: AlertTriangle, tint: 'text-[#fcd34d]' },
  positive: { ring: 'border-[#34d399]/30 bg-[#34d399]/[0.08]', icon: CheckCircle2, tint: 'text-[#5eead4]' },
}

function AlertRow({ alert }: { alert: RecapAlert }) {
  const s = ALERT_STYLE[alert.level]
  const Icon = s.icon
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 ${s.ring}`}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${s.tint}`} />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{alert.title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{alert.detail}</div>
      </div>
    </div>
  )
}

export function RecapPopup() {
  const { user } = useAuth()
  const { activeWorkspaceId, getWorkspaceIntegrations } = useWorkspace()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<RecapData | null>(null)

  const cardRef = useRef<HTMLDivElement>(null)
  // Mirror `open` in a ref so the (stable) visibility handlers read the latest
  // value without re-subscribing every render.
  const openRef = useRef(open)
  openRef.current = open

  // ── Timing: show at most once every 2h, only on RETURN to the app ──────────
  // Runs on mount AND whenever the tab regains visibility/focus. Reads and
  // writes the timestamp synchronously so overlapping events can't double-fire.
  // No setInterval/timer — staying continuously in the app never triggers it.
  const maybeShow = useCallback(() => {
    if (openRef.current) return
    const last = readLastShown()
    if (Date.now() - last >= TWO_HOURS_MS) {
      writeLastShown(Date.now())
      openRef.current = true
      setOpen(true)
    }
  }, [])

  useEffect(() => {
    maybeShow() // first mount (incl. first-ever visit: no stored value → shows)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') maybeShow()
    }
    const onFocus = () => maybeShow()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [maybeShow])

  // ── Load real data whenever the popup opens (guest-safe: no API call
  // when there's no signed-in user). ────────────────────────────────────────
  const integrations = user && activeWorkspaceId ? getWorkspaceIntegrations(activeWorkspaceId) : null
  const connectedKey = integrations
    ? RECAP_PLATFORMS.filter((k) => integrations[k]?.status === 'Connected').join(',')
    : ''

  useEffect(() => {
    if (!open) return
    if (!user || !activeWorkspaceId) {
      setData(null)
      setLoading(false)
      return
    }
    const connectedSet = new Set(connectedKey ? connectedKey.split(',') : [])
    const connected = RECAP_PLATFORMS.filter((k) => connectedSet.has(k))
    if (connected.length === 0) {
      setData(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    buildRecap(activeWorkspaceId, connected)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, user, activeWorkspaceId, connectedKey])

  // Escape-to-close + scroll lock while open.
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const close = useCallback(() => setOpen(false), [])

  const copyImage = useCallback(async () => {
    const node = cardRef.current
    if (!node) return
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      showToast('Copy to clipboard is not supported in this browser', 'error')
      return
    }
    try {
      const blob = await toBlob(node, {
        pixelRatio: 2,
        backgroundColor: '#0b1018',
        cacheBust: true,
        // Exclude the header controls (close / copy buttons) from the capture.
        filter: (el) => !(el instanceof HTMLElement && el.dataset.recapNoexport === 'true'),
      })
      if (!blob) throw new Error('Capture failed')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      showToast('Recap copied to clipboard', 'success')
    } catch {
      showToast('Could not copy the recap image', 'error')
    }
  }, [showToast])

  const hasRecap = Boolean(data?.hasData)
  const insights: RecapInsights | null = useMemo(() => (data ? buildRecapInsights(data) : null), [data])

  const goTo = useCallback(
    (to: string) => {
      close()
      navigate(to)
    },
    [close, navigate],
  )

  return (
    <AnimatePresence>
      {open && (
        // Solid tint backdrop (no backdrop-filter — this can mount inside an
        // overflow-hidden layout ancestor, which turns filters black). Fully
        // opaque on mount; only the card animates, and via transform only.
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 print:hidden"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            ref={cardRef}
            role="dialog"
            aria-modal="true"
            aria-label="Community recap"
            className="glow-emerald relative flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[rgba(120,170,255,0.18)] bg-[#0b1018] shadow-2xl"
            initial={reduceMotion ? false : { scale: 0.96, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { scale: 0.96, y: 14, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top accent bar */}
            <div aria-hidden className="gradient-bar-emerald h-1 w-full shrink-0" />

            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-emerald)] shadow-[var(--glow-emerald)]">
                    <Sparkles size={14} className="text-white" />
                  </span>
                  <h2 className="text-lg font-semibold text-white">Catch AI</h2>
                  <span className="rounded-full border border-[rgba(120,170,255,0.25)] bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                    Community overview
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  {hasRecap
                    ? `Across ${data!.activePlatforms} platform${data!.activePlatforms === 1 ? '' : 's'}${
                        data!.windowDays > 0 ? ` · last ${data!.windowDays} day${data!.windowDays === 1 ? '' : 's'}` : ''
                      }`
                    : 'Where your communities stand right now'}
                </p>
              </div>
              <div data-recap-noexport="true" className="flex shrink-0 items-center gap-1">
                <button
                  onClick={copyImage}
                  aria-label="Copy recap as image"
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-white/[0.08] hover:text-white"
                >
                  <Camera size={15} />
                  Copy image
                </button>
                <button
                  onClick={close}
                  aria-label="Close recap"
                  className="focus-ring rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {loading ? (
                <div className="flex flex-col gap-3">
                  <div className="skeleton h-24 rounded-xl" />
                  <div className="skeleton h-20 rounded-xl" />
                  <div className="skeleton h-20 rounded-xl" />
                </div>
              ) : hasRecap ? (
                <div className="flex flex-col gap-4">
                  {/* Catch AI narrative — the "message" from the assistant */}
                  {insights && (
                    <div className="relative overflow-hidden rounded-xl border border-[rgba(120,170,255,0.22)] bg-gradient-to-br from-[rgba(47,124,246,0.10)] to-[rgba(52,211,153,0.05)] p-4">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-emerald)]">
                          <Sparkles size={12} className="text-white" />
                        </span>
                        <span className="text-sm font-semibold text-white">{insights.narrative.headline}</span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{insights.narrative.body}</p>
                    </div>
                  )}

                  {/* Aggregated top line */}
                  <div className="relative overflow-hidden rounded-xl border border-[rgba(120,170,255,0.20)] bg-gradient-to-br from-[rgba(47,124,246,0.12)] to-[rgba(77,159,255,0.04)] p-5">
                    <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                      Total members · all platforms
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-3">
                      <span className="text-shine text-4xl font-bold">{formatNumber(data!.totalMembers)}</span>
                      <DeltaPill delta={data!.totalGrowth} pct={data!.totalGrowthPct} />
                    </div>
                  </div>

                  {/* Per-platform sections */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {data!.sections.map((section) => (
                      <PlatformSection key={section.platform} section={section} />
                    ))}
                  </div>

                  {/* Alerts */}
                  {insights && insights.alerts.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                        <AlertTriangle size={13} className="text-[#fcd34d]" />
                        Alerts
                      </div>
                      {insights.alerts.map((alert, i) => (
                        <AlertRow key={`${alert.title}-${i}`} alert={alert} />
                      ))}
                    </div>
                  )}

                  {/* Suggested corrective actions */}
                  {insights && insights.actions.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                        <Sparkles size={13} className="text-[var(--accent-emerald)]" />
                        Suggested actions
                      </div>
                      {insights.actions.map((action) => (
                        <button
                          key={action.to + action.label}
                          data-recap-noexport="true"
                          onClick={() => goTo(action.to)}
                          className="focus-ring group flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-3 text-left transition-colors hover:border-[rgba(120,170,255,0.35)] hover:bg-white/[0.05]"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-white">{action.label}</span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-secondary)]">{action.detail}</span>
                          </span>
                          <ArrowRight size={16} className="shrink-0 text-[var(--text-secondary)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent-emerald-bright)]" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                // Guest / no-data — gentle connect state (never fake numbers).
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-card)] bg-white/[0.015] px-6 py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--accent-emerald)]">
                    <PlugZap size={22} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">No connected platforms yet</div>
                    <p className="mt-1 max-w-xs text-sm text-[var(--text-secondary)]">
                      Connect a platform to see your community recap across Discord, Telegram, Galxe and more.
                    </p>
                  </div>
                  <button
                    data-recap-noexport="true"
                    onClick={() => {
                      close()
                      navigate('/dashboard/integrations')
                    }}
                    className="focus-ring sheen mt-1 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)] px-4 py-2 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:brightness-110"
                  >
                    <PlugZap size={16} />
                    Connect a platform
                  </button>
                </div>
              )}
            </div>

            {/* Bottom accent bar */}
            <div aria-hidden className="gradient-bar-emerald h-1 w-full shrink-0 opacity-60" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
