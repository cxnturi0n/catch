import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Navigate } from 'react-router-dom'
import { AlertTriangle, Inbox, Lightbulb, Loader2, RefreshCw } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { OWNER_EMAIL } from '../../lib/adminAnalytics'
import {
  fetchAllDiscoveryResponses,
  type DiscoveryResponseRow,
} from '../../lib/discovery'
import {
  DISCOVERY_VARIANTS,
  NOTE_SUFFIX,
  PLATFORMS_SUFFIX,
  QUESTIONS_PER_VARIANT,
  VARIANT_KEY,
  getVariant,
  type DiscoveryQuestion,
  type DiscoveryVariant,
} from '../../data/discoveryQuestions'

// ── Helpers ───────────────────────────────────────────────────────────────────

function variantOf(row: DiscoveryResponseRow): DiscoveryVariant | null {
  const v = row.answers?.[VARIANT_KEY]
  return DISCOVERY_VARIANTS.some((d) => d.id === v) ? (v as DiscoveryVariant) : null
}

/** Count of the variant's base questions this response actually answered. */
function answeredCount(row: DiscoveryResponseRow, variant: DiscoveryVariant): number {
  return getVariant(variant).questions.filter((q) => (row.answers?.[q.id] ?? '').trim()).length
}

/** Full cell text for a question: main answer + platforms + note, merged. */
function cellText(row: DiscoveryResponseRow, q: DiscoveryQuestion): string {
  const parts: string[] = []
  const v = (row.answers?.[q.id] ?? '').trim()
  if (v) parts.push(v)
  const plats = (row.answers?.[q.id + PLATFORMS_SUFFIX] ?? '').trim()
  if (plats) parts.push(`[${plats}]`)
  const note = (row.answers?.[q.id + NOTE_SUFFIX] ?? '').trim()
  if (note) parts.push(note)
  return parts.join(' · ')
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// ── To-Do (insights → azione) ────────────────────────────────────────────────
// Turns the recurring discovery signals into a decision table: what to build,
// whether it already exists, how feasible it is, and its cost. €0 items are
// implementable now; costed ones are flagged. Seeded from the known themes, // refine as real responses accrue.
type TodoCost = 'free' | 'ai' | 'ext' | 'deploy'
type TodoStato = 'exists' | 'partial' | 'missing'
interface TodoItem { todo: string; insight: string; stato: TodoStato; feas: string; cost: TodoCost; costNote?: string }

const TODOS: TodoItem[] = [
  { todo: 'Automatic cross-platform KPIs', insight: '“stitched in sheets, wish it were automatic”', stato: 'exists', feas: 'Done, Analytics section', cost: 'free' },
  { todo: '24/7 shift coverage + handover', insight: '“cover the community 24/7 across time zones”', stato: 'exists', feas: 'Done, Coverage board', cost: 'free' },
  { todo: 'Unified multi-platform client report', insight: '“one dashboard that unifies every platform”', stato: 'partial', feas: 'Medium, aggregates connected sources', cost: 'free' },
  { todo: 'Retention per cohort (Discord)', insight: '“I wish I had retention per cohort”', stato: 'partial', feas: 'Medium, requires MEMBERS intent', cost: 'free', costNote: 'needs the privileged Discord intent' },
  { todo: 'Brand mention monitoring', insight: 'listening to mentions outside the community', stato: 'partial', feas: 'Medium, Bluesky already live', cost: 'ext', costNote: '€0 on open protocols · €€ on X' },
  { todo: 'Report delivery to Slack / Notion', insight: 'tools mentioned: Slack, Notion', stato: 'missing', feas: 'Easy, edge function', cost: 'deploy', costNote: 'requires Supabase deploy' },
  { todo: 'Auto-written report (narrative)', insight: '“auto-generated client reports”', stato: 'missing', feas: 'Easy, LLM on real data', cost: 'ai' },
  { todo: 'Assistant on SOPs / moderator onboarding', insight: '“training new moderators fast enough”', stato: 'missing', feas: 'Easy, RAG on Resources', cost: 'ai' },
  { todo: 'Sentiment / scam detection', insight: 'community protection & mood', stato: 'missing', feas: 'Medium, content + AI', cost: 'ai', costNote: '+ Supabase deploy' },
  { todo: 'Automatic KOL results tracking', insight: '“how do you follow their results?”', stato: 'partial', feas: 'Medium, manual today', cost: 'ext', costNote: 'social listening (X API)' },
]

const COST_META: Record<TodoCost, { label: string; cls: string }> = {
  free: { label: '€0', cls: 'text-[#3ee0a0] bg-[color:rgba(62,224,160,.12)]' },
  deploy: { label: '€0 + deploy', cls: 'text-[#a9c4ff] bg-[color:rgba(91,140,255,.14)]' },
  ai: { label: '€ AI', cls: 'text-[#ffd479] bg-[color:rgba(255,212,121,.12)]' },
  ext: { label: '€€ external', cls: 'text-[#ff8f7f] bg-[color:rgba(255,143,127,.12)]' },
}
const STATO_META: Record<TodoStato, { label: string; cls: string }> = {
  exists: { label: '✅ Exists', cls: 'text-[#3ee0a0]' },
  partial: { label: '◑ Partial', cls: 'text-[#ffd479]' },
  missing: { label: '○ Missing', cls: 'text-[var(--text-muted)]' },
}

function TodoPanel() {
  const order: Record<TodoCost, number> = { free: 0, deploy: 1, ai: 2, ext: 3 }
  const rows = [...TODOS].sort((a, b) => order[a.cost] - order[b.cost])
  const th = 'border-b border-[var(--border-card)] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider'
  const td = 'border-b border-[var(--border-card)] px-3 py-2.5'
  return (
    <div className="glass sf-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Lightbulb size={16} className="text-[var(--accent-emerald-bright)]" />
        <h2 className="text-[15px] font-bold text-[var(--text-primary)]">To Do, from insight to action</h2>
      </div>
      <p className="mb-4 font-mono text-[11px] text-[var(--text-muted)]">
        Discovery signals → features. Platform status · feasibility · cost. The €0 ones are shippable now. Seeded from known themes, refined by real responses.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className={th}>To Do</th>
              <th className={th}>Status</th>
              <th className={th}>Feasibility</th>
              <th className={th}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.todo} className="align-top">
                <td className={td}>
                  <div className="font-semibold text-[var(--text-primary)]">{r.todo}</div>
                  <div className="mt-0.5 text-[11.5px] italic text-[var(--text-muted)]">{r.insight}</div>
                </td>
                <td className={`${td} whitespace-nowrap font-medium ${STATO_META[r.stato].cls}`}>{STATO_META[r.stato].label}</td>
                <td className={`${td} text-[var(--text-secondary)]`}>{r.feas}</td>
                <td className={`${td} whitespace-nowrap`}>
                  <span className={`inline-block rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${COST_META[r.cost].cls}`} title={r.costNote}>{COST_META[r.cost].label}</span>
                  {r.costNote && <div className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">{r.costNote}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Hover tooltip (portaled so the table's overflow never clips it) ──────────
function HeaderCell({ n, question, subLabel }: { n: number; question: string; subLabel: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={() => {
          const r = ref.current?.getBoundingClientRect()
          if (r) setPos({ x: r.left, y: r.bottom + 6 })
        }}
        onMouseLeave={() => setPos(null)}
        onFocus={() => {
          const r = ref.current?.getBoundingClientRect()
          if (r) setPos({ x: r.left, y: r.bottom + 6 })
        }}
        onBlur={() => setPos(null)}
        className="flex flex-col items-start gap-0.5 text-left"
      >
        <span className="font-mono text-[11px] font-bold text-[var(--accent-emerald-bright)]">Q{n}</span>
        <span className="max-w-[160px] truncate text-[11px] font-medium text-[var(--text-secondary)]">{subLabel}</span>
      </button>
      {pos &&
        createPortal(
          <div
            style={{ position: 'fixed', left: Math.min(pos.x, window.innerWidth - 340), top: pos.y, maxWidth: 320, zIndex: 80 }}
            className="pointer-events-none rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3.5 py-2.5 text-[13px] leading-snug text-[var(--text-primary)] shadow-2xl"
          >
            <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--accent-emerald-bright)]">
              Domanda {n}
            </span>
            {question}
          </div>,
          document.body,
        )}
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function DiscoveryResponses() {
  const { user } = useAuth()
  // Dev-only preview with sample data (dead-code-eliminated in production).
  const demoMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1'
  const isOwner = demoMode || user?.email?.toLowerCase() === OWNER_EMAIL

  const [rows, setRows] = useState<DiscoveryResponseRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<DiscoveryVariant>('freelance')

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetchAllDiscoveryResponses()
    if (res.status === 'ok') setRows(res.rows)
    else setError(res.status === 'unconfigured' ? 'The API is not reachable on this deployment.' : res.error)
    setLoading(false)
  }

  useEffect(() => {
    if (demoMode) {
      setRows(SAMPLE_ROWS)
      setLoading(false)
      return
    }
    if (isOwner) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner])

  // ── Aggregates ── (all hooks run unconditionally; the owner gate is below)
  const stats = useMemo(() => {
    const list = rows ?? []
    const byVariant: Record<string, number> = {}
    let completionSum = 0
    let counted = 0
    let fullyComplete = 0
    let nearEmpty = 0
    let unknown = 0
    for (const r of list) {
      const v = variantOf(r)
      if (!v) {
        unknown++
        continue
      }
      byVariant[v] = (byVariant[v] ?? 0) + 1
      const a = answeredCount(r, v)
      completionSum += a / QUESTIONS_PER_VARIANT
      counted++
      if (a === QUESTIONS_PER_VARIANT) fullyComplete++
      if (a <= 2) nearEmpty++
    }
    const avgCompletion = counted ? Math.round((completionSum / counted) * 100) : 0
    return { total: list.length, byVariant, avgCompletion, fullyComplete, nearEmpty, unknown, counted }
  }, [rows])

  const tabRows = useMemo(() => (rows ?? []).filter((r) => variantOf(r) === tab), [rows, tab])
  const tabQuestions = getVariant(tab).questions

  // Per-question fill counts for this variant (drop-off signal).
  const fillCounts = useMemo(
    () => tabQuestions.map((q) => tabRows.filter((r) => (r.answers?.[q.id] ?? '').trim()).length),
    [tabQuestions, tabRows],
  )

  // Resizable table columns, width per column id ('respondent' + question ids).
  const [colW, setColW] = useState<Record<string, number>>({})
  const drag = useRef<{ id: string; startX: number; startW: number } | null>(null)
  const wOf = (id: string, def: number) => colW[id] ?? def
  function startResize(e: ReactMouseEvent, id: string, currentW: number) {
    drag.current = { id, startX: e.clientX, startW: currentW }
    function onMove(ev: MouseEvent) {
      if (!drag.current) return
      const w = Math.max(90, drag.current.startW + (ev.clientX - drag.current.startX))
      setColW((c) => ({ ...c, [drag.current!.id]: w }))
    }
    function onUp() {
      drag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault()
  }
  const ResizeHandle = ({ id, def }: { id: string; def: number }) => (
    <span
      onMouseDown={(e) => startResize(e, id, wOf(id, def))}
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none bg-transparent transition-colors hover:bg-[var(--accent-emerald)]/40"
      role="separator"
      aria-label="Ridimensiona colonna"
    />
  )

  // Non-owners never see this page. (Placed after all hooks so hook order is stable.)
  if (!isOwner) return <Navigate to="/dashboard/analytics" replace />

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[var(--text-primary)]">
            <Inbox size={20} className="text-[var(--accent-emerald-bright)]" /> Discovery Responses
          </h1>
          <p className="mt-0.5 font-mono text-[11.5px] text-[var(--text-muted)]">
            Founder inbox · every answer to the public discovery form
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--surface-2)] px-3.5 py-2 text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Dashboard */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total responses" value={String(stats.total)} hint={stats.unknown ? `${stats.unknown} without a type` : 'all forms'} />
        <StatTile label="Avg completion" value={`${stats.avgCompletion}%`} hint={`across ${stats.counted} typed responses`} accent />
        <StatTile label="Fully completed" value={String(stats.fullyComplete)} hint={stats.counted ? `${Math.round((stats.fullyComplete / stats.counted) * 100)}% of responses` : 'n/a'} />
        <StatTile label="Near-empty (≤2)" value={String(stats.nearEmpty)} hint="possible drop-offs" warn={stats.nearEmpty > 0} />
      </div>

      {/* Breakdown by type */}
      <div className="glass sf-card p-5">
        <div className="sf-eyebrow mb-3">Responses by form type</div>
        <div className="flex flex-col gap-2.5">
          {DISCOVERY_VARIANTS.map((v) => {
            const count = stats.byVariant[v.id] ?? 0
            const pct = stats.total ? Math.round((count / stats.total) * 100) : 0
            return (
              <div key={v.id} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate text-sm text-[var(--text-secondary)]">{v.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)]" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-[13px] text-[var(--text-primary)]">
                  {count} <span className="text-[var(--text-muted)]">· {pct}%</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* To-Do: discovery insights → actionable product changes */}
      <TodoPanel />

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {DISCOVERY_VARIANTS.map((v) => {
          const count = stats.byVariant[v.id] ?? 0
          const active = v.id === tab
          return (
            <button
              key={v.id}
              onClick={() => setTab(v.id)}
              className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                active
                  ? 'border-[var(--accent-emerald)]/60 bg-[var(--accent-emerald)]/[0.12] text-[var(--text-primary)]'
                  : 'border-[var(--border-card)] bg-[var(--surface-1)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {v.label} <span className="ml-1 font-mono text-[11px] opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Table */}
      {loading && !rows ? (
        <div className="glass sf-card flex items-center justify-center gap-2 p-10 text-sm text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Loading responses…
        </div>
      ) : tabRows.length === 0 ? (
        <div className="glass sf-card p-10 text-center text-sm text-[var(--text-muted)]">
          No responses of this type yet.
        </div>
      ) : (
        <div className="glass sf-card overflow-hidden p-0">
          <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
            <table className="border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  {/* Sticky corner: name column header */}
                  <th
                    className="sticky left-0 top-0 z-30 border-b border-r border-[var(--border-card)] bg-[var(--bg-card)] px-4 py-3 align-bottom"
                    style={{ width: wOf('respondent', 200), minWidth: wOf('respondent', 200), position: 'sticky' }}
                  >
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint,#5c6785)]">Respondent</span>
                    <ResizeHandle id="respondent" def={200} />
                  </th>
                  {tabQuestions.map((q, i) => (
                    <th
                      key={q.id}
                      className="sticky top-0 z-20 border-b border-[var(--border-card)] bg-[var(--bg-card)] px-4 py-3 align-bottom"
                      style={{ width: wOf(q.id, 190), minWidth: wOf(q.id, 190) }}
                    >
                      <HeaderCell n={i + 1} question={q.text} subLabel={`${fillCounts[i]}/${tabRows.length} answered`} />
                      <ResizeHandle id={q.id} def={190} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabRows.map((r) => {
                  const a = answeredCount(r, tab)
                  return (
                    <tr key={r.id} className="group">
                      {/* Sticky name column */}
                      <td className="sticky left-0 z-10 border-b border-r border-[var(--border-card)] bg-[var(--bg-card)] px-4 py-3 align-top" style={{ width: wOf('respondent', 200), minWidth: wOf('respondent', 200) }}>
                        <div className="text-[13.5px] font-semibold text-[var(--text-primary)]">{r.respondent_name || 'n/a'}</div>
                        {r.respondent_email && <div className="truncate text-[11.5px] text-[var(--text-muted)]" style={{ maxWidth: 180 }}>{r.respondent_email}</div>}
                        <div className="mt-1 flex items-center gap-2 font-mono text-[10.5px] text-[var(--text-faint,#5c6785)]">
                          <span>{fmtDate(r.submitted_at)}</span>
                          <span className={`rounded px-1.5 py-0.5 ${a === QUESTIONS_PER_VARIANT ? 'bg-[var(--sf-pos-bg)] text-[var(--sf-pos)]' : 'bg-[var(--surface-2)] text-[var(--text-muted)]'}`}>
                            {a}/{QUESTIONS_PER_VARIANT}
                          </span>
                        </div>
                      </td>
                      {tabQuestions.map((q) => {
                        const val = cellText(r, q)
                        return (
                          <td key={q.id} className="border-b border-[var(--border-card)] px-4 py-3 align-top" style={{ width: wOf(q.id, 190), minWidth: wOf(q.id, 190) }}>
                            {val ? (
                              <div className="line-clamp-4 text-[13px] leading-snug text-[var(--text-body,var(--text-secondary))]" title={val}>
                                {val}
                              </div>
                            ) : (
                              <span className="text-[var(--text-faint,#5c6785)]">, </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Dev-only sample data for ?demo=1 (never bundled into production).
const SAMPLE_ROWS: DiscoveryResponseRow[] = [
  {
    id: 's1', form_id: 'f', slug_snapshot: 'generic',
    respondent_name: 'Lena Ортега', respondent_email: 'lena@aurelia.xyz', respondent_role: 'CM',
    submitted_at: new Date(Date.now() - 3600e3).toISOString(), completion_ms: 720000,
    answers: {
      variant: 'freelance', fl_clients: '2 to 5', fl_clients__platforms: 'X, Telegram, Discord',
      fl_tools: 'Notion for tasks, Google Calendar, and a metrics spreadsheet.',
      fl_pain: 'Compiling weekly reports across three platforms by hand.',
      fl_switching: 'Time-boxing each client to fixed days of the week.',
      fl_reporting: 'Slides, ~2h each, the founder reads them.',
      fl_metrics: 'I pull them manually; I wish I had retention per cohort.',
      fl_bots: 'Yes', fl_bots__note: 'MEE6 and Collab.Land',
      fl_kol: 'No', fl_relationship: 'A shared Telegram channel with each lead.',
      fl_dream: 'One dashboard that unifies every platform automatically.',
    },
  },
  {
    id: 's2', form_id: 'f', slug_snapshot: 'generic',
    respondent_name: null, respondent_email: 'anon@x.com', respondent_role: null,
    submitted_at: new Date(Date.now() - 7200e3).toISOString(), completion_ms: 140000,
    answers: { variant: 'freelance', fl_clients: '10+', fl_clients__platforms: 'Discord', fl_tools: 'Just Discord and my head.' },
  },
  {
    id: 's3', form_id: 'f', slug_snapshot: 'generic',
    respondent_name: 'Marco Bianchi', respondent_email: 'marco@studio.gg', respondent_role: 'Agency lead',
    submitted_at: new Date(Date.now() - 1.8e6).toISOString(), completion_ms: 900000,
    answers: {
      variant: 'agency', ag_scale: '6 to 15', ag_scale__platforms: 'X, Telegram, Discord, Farcaster', ag_scale__note: 'Team of 8',
      ag_tools: 'Notion + Slack + a shared sheet per client.',
      ag_bottleneck: 'Onboarding and training new moderators fast enough.',
      ag_moderators: 'We recruit from client communities and run a 1-week shadowing.',
      ag_reporting: 'PDF monthly, ~half a day per client.',
      ag_metrics: 'Stitched together in sheets; wish it were automatic.',
      ag_bots: 'Yes', ag_bots__note: 'Custom + MEE6', ag_kol: 'No',
      ag_relationship: 'One main contact per client, weekly sync.',
      ag_dream: 'Auto-generated client reports.',
    },
  },
]

function StatTile({ label, value, hint, accent, warn }: { label: string; value: string; hint?: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="glass sf-card p-5">
      <div className="sf-eyebrow">{label}</div>
      <div className={`sf-value mt-2 ${accent ? 'text-[var(--accent-emerald-bright)]' : warn ? 'text-[var(--sf-warn,#ffd479)]' : 'text-[var(--text-primary)]'}`}>{value}</div>
      {hint && <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">{hint}</div>}
    </div>
  )
}
