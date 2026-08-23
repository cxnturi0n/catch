import { useMemo, useState } from 'react'
import {
  Download,
  Filter,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Rows3,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import type { Moderator, ModeratorShift, ModeratorStatus } from '../../../types'
import { useNow } from '../../../hooks/useNow'
import { Card } from '../../ui/Card'
import { Badge, type BadgeTone } from '../../ui/Badge'
import { ModeratorProfileDrawer } from './ModeratorProfileDrawer'

// ── shift / coverage helpers (all hours UTC, weekday 0=Sun..6=Sat) ────────────

const SHIFT_FALLBACK: Record<ModeratorShift, [number, number]> = {
  'Morning (06-14)': [6, 14],
  'Afternoon (14-22)': [14, 22],
  'Night (22-06)': [22, 6],
}

/** Resolve a moderator's shift window, preferring the precise UTC fields and
 *  falling back to the coarse shift enum so demo rows still render a band. */
function shiftWindow(m: Moderator): { start: number; end: number } | null {
  if (typeof m.shiftStartUtc === 'number' && typeof m.shiftEndUtc === 'number') {
    return { start: m.shiftStartUtc, end: m.shiftEndUtc }
  }
  const fb = SHIFT_FALLBACK[m.shift]
  return fb ? { start: fb[0], end: fb[1] } : null
}

function shiftDaysOf(m: Moderator): number[] {
  return m.shiftDays && m.shiftDays.length > 0 ? m.shiftDays : [1, 2, 3, 4, 5]
}

/** Coarse shift band label (Morning / Afternoon / Night) for grouping + filters. */
function shiftBand(m: Moderator): string {
  return m.shift.split(' ')[0]
}

/** Hours a window spans, handling midnight wrap (e.g. 22→06). */
function windowHours(start: number, end: number): number[] {
  const hours: number[] = []
  if (start === end) return hours
  let h = start
  for (let i = 0; i < 24; i++) {
    if (h === end) break
    hours.push(h)
    h = (h + 1) % 24
  }
  return hours
}

/** Is the moderator on shift at the given UTC hour + weekday? */
function onShiftNow(m: Moderator, nowHour: number, nowDay: number): boolean {
  const w = shiftWindow(m)
  if (!w) return false
  if (!shiftDaysOf(m).includes(nowDay)) return false
  return windowHours(w.start, w.end).includes(nowHour)
}

/** Left/width % segments for a 0→24h bar (two segments when the window wraps). */
function barSegments(start: number, end: number): { left: number; width: number }[] {
  if (start === end) return []
  if (start < end) return [{ left: (start / 24) * 100, width: ((end - start) / 24) * 100 }]
  return [
    { left: (start / 24) * 100, width: ((24 - start) / 24) * 100 },
    { left: 0, width: (end / 24) * 100 },
  ]
}

/** Largest contiguous block of UTC hours with zero shift coverage (circular). */
function largestUncoveredWindow(covered: Set<number>): { start: number; end: number; length: number } | null {
  if (covered.size >= 24) return null
  if (covered.size === 0) return { start: 0, end: 0, length: 24 }
  let best = { start: 0, len: 0 }
  let runStart = -1
  let runLen = 0
  for (let i = 0; i < 48; i++) {
    const h = i % 24
    if (!covered.has(h)) {
      if (runLen === 0) runStart = h
      runLen++
      if (runLen > best.len) best = { start: runStart, len: runLen }
    } else {
      runLen = 0
    }
  }
  const length = Math.min(best.len, 24)
  return { start: best.start, end: (best.start + length) % 24, length }
}

const pad = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function sinceLabel(startDate: string): string | null {
  if (!startDate) return null
  const d = new Date(startDate)
  if (Number.isNaN(d.getTime())) return null
  return `${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function compensationLabel(m: Moderator): { amount: string; muted: boolean } {
  if (m.monthlyRate && m.currency) return { amount: `${m.monthlyRate} ${m.currency}`, muted: false }
  if (m.contractType === 'Volunteer') return { amount: 'Volunteer', muted: true }
  if (m.contractType === 'Trial') return { amount: 'Trial', muted: true }
  return { amount: 'n/a', muted: true }
}

function roleLine(m: Moderator): string {
  const role = m.platforms[0] ?? 'moderator'
  return `${role} · ${m.timezone}`
}

interface PillInfo {
  label: string
  tone: BadgeTone
  dot: string
}
function pillFor(status: ModeratorStatus, onNow: boolean): PillInfo {
  if (status === 'On Leave') return { label: 'ON LEAVE', tone: 'yellow', dot: '#ffd479' }
  if (status === 'Inactive') return { label: 'INACTIVE', tone: 'red', dot: '#ff8f7f' }
  if (onNow) return { label: 'ON SHIFT', tone: 'green', dot: '#3ee0a0' }
  return { label: 'OFF', tone: 'gray', dot: '#64748b' }
}

// ── column filter popover ─────────────────────────────────────────────────────

/** A funnel-triggered multi-select checklist used in each table header. An empty
 *  selection means "all"; the funnel lights up sapphire when a filter is active. */
function ColumnFilter({
  title,
  options,
  selected,
  onToggle,
  onClear,
  align = 'left',
}: {
  title: string
  options: string[]
  selected: Set<string>
  onToggle: (value: string) => void
  onClear: () => void
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const active = selected.size > 0
  if (options.length === 0) return null
  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={`Filter by ${title}`}
        onClick={() => setOpen((v) => !v)}
        className={`focus-ring rounded p-1 transition-colors ${
          active ? 'text-[var(--accent-emerald-bright)]' : 'text-[var(--text-muted)] hover:text-white'
        }`}
      >
        <Filter size={12} className={active ? 'fill-current' : ''} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-40 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--border-card)] bg-[#0b1120] py-1 shadow-2xl ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <span>{title}</span>
              {active && (
                <button type="button" onClick={onClear} className="normal-case text-[var(--accent-emerald-bright)] hover:underline">
                  Clear
                </button>
              )}
            </div>
            <div className="max-h-56 overflow-y-auto">
              {options.map((o) => (
                <label
                  key={o}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] normal-case text-[var(--text-primary)] hover:bg-white/[0.05]"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(o)}
                    onChange={() => onToggle(o)}
                    className="h-3.5 w-3.5 accent-[var(--accent-emerald)]"
                  />
                  <span className="truncate">{o}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── small presentational pieces ──────────────────────────────────────────────

function Avatar({ m, onNow, size = 40 }: { m: Moderator; onNow: boolean; size?: number }) {
  const dot = pillFor(m.status, onNow).dot
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[#3F7BFF] to-[#2050E6] text-xs font-bold text-white"
        style={{ fontSize: size >= 40 ? 13 : 11 }}
      >
        {m.avatarInitials}
      </div>
      <span
        className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#060a18]"
        style={{ background: dot }}
      />
    </div>
  )
}

function CoverageBar({
  start,
  end,
  nowFrac,
  thin = false,
}: {
  start: number
  end: number
  nowFrac: number
  thin?: boolean
}) {
  const segs = barSegments(start, end)
  return (
    <div className="relative w-full">
      <div className={`relative w-full overflow-hidden rounded-full bg-white/[0.06] ${thin ? 'h-1.5' : 'h-2.5'}`}>
        {segs.map((s, i) => (
          <div
            key={i}
            className="absolute top-0 h-full rounded-full"
            style={{ left: `${s.left}%`, width: `${s.width}%`, background: 'linear-gradient(90deg,#3F7BFF,#5B8CFF)' }}
          />
        ))}
      </div>
      <div className="absolute -top-1 -bottom-1 w-px bg-white/70" style={{ left: `${(nowFrac / 24) * 100}%` }} />
    </div>
  )
}

// ── row overflow menu ────────────────────────────────────────────────────────

function RowMenu({
  moderator,
  onEdit,
  onAddWarning,
  onRemove,
}: {
  moderator: Moderator
  onEdit: (m: Moderator) => void
  onAddWarning: (m: Moderator) => void
  onRemove: (m: Moderator) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Actions"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-[var(--border-card)] bg-[#0b1120] py-1 shadow-2xl">
            <button
              type="button"
              onClick={() => { setOpen(false); onEdit(moderator) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-white/[0.05]"
            >
              <Pencil size={13} /> Edit
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); onAddWarning(moderator) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-white/[0.05]"
            >
              <ShieldAlert size={13} /> Add warning
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); onRemove(moderator) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#ff8f7f] hover:bg-red-500/10"
            >
              <Trash2 size={13} /> Remove
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── filter model ──────────────────────────────────────────────────────────────

type FilterKey = 'name' | 'status' | 'country' | 'shift' | 'contract'
const FILTER_KEYS: FilterKey[] = ['name', 'status', 'country', 'shift', 'contract']

/** The value a moderator contributes to each filterable column. */
function filterValue(m: Moderator, key: FilterKey, onNow: boolean): string {
  switch (key) {
    case 'name':
      return m.fullName
    case 'status':
      return pillFor(m.status, onNow).label
    case 'country':
      return m.country || 'n/a'
    case 'shift':
      return shiftBand(m)
    case 'contract':
      return m.contractType
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

type ViewMode = 'board' | 'cards'

export function RosterTab({
  moderators,
  onEdit,
  onAddWarning,
  onRemove,
  onInvite,
  onViewActivity,
}: {
  moderators: Moderator[]
  isAutoSynced: boolean
  lastSyncLabel: string | null
  onEdit: (m: Moderator) => void
  onAddWarning: (m: Moderator) => void
  onRemove: (m: Moderator) => void
  onInvite: () => void
  onViewActivity: () => void
}) {
  // Ticking UTC instant, drives "on shift now", the now-marker and coverage.
  const now = useNow()
  const [view, setView] = useState<ViewMode>('board')
  const [profileTarget, setProfileTarget] = useState<Moderator | null>(null)
  const [profileOverrides, setProfileOverrides] = useState<Record<string, Partial<Moderator>>>({})
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    name: new Set(),
    status: new Set(),
    country: new Set(),
    shift: new Set(),
    contract: new Set(),
  })

  const displayed = moderators.map((m) => ({ ...m, ...(profileOverrides[m.id] ?? {}) }))

  function mergeUpdate(id: string, patch: Partial<Moderator>) {
    setProfileOverrides((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }))
  }

  function toggleFilter(key: FilterKey, value: string) {
    setFilters((prev) => {
      const next = new Set(prev[key])
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return { ...prev, [key]: next }
    })
  }
  function clearFilter(key: FilterKey) {
    setFilters((prev) => ({ ...prev, [key]: new Set() }))
  }
  function clearAllFilters() {
    setFilters({ name: new Set(), status: new Set(), country: new Set(), shift: new Set(), contract: new Set() })
  }
  const anyFilterActive = FILTER_KEYS.some((k) => filters[k].size > 0)

  const nowHour = now.getUTCHours()
  const nowDay = now.getUTCDay()
  const nowFrac = nowHour + now.getUTCMinutes() / 60

  // Distinct filter options, derived from the (unfiltered) team. Computed BEFORE
  // the empty-roster early return: a hook after a conditional return would break
  // hook order the moment that branch renders anything else.
  const options = useMemo(() => {
    const out: Record<FilterKey, string[]> = { name: [], status: [], country: [], shift: [], contract: [] }
    for (const key of FILTER_KEYS) {
      const set = new Set<string>()
      for (const m of displayed) set.add(filterValue(m, key, onShiftNow(m, nowHour, nowDay)))
      out[key] = [...set].sort()
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderators, profileOverrides, nowHour, nowDay])

  if (moderators.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 p-16 text-center text-[var(--text-secondary)]">
        <Users size={28} className="text-slate-600" />
        No moderators added yet for this workspace
        <button
          type="button"
          onClick={onInvite}
          className="focus-ring mt-1 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#3F7BFF] to-[#2050E6] px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:brightness-110"
        >
          <UserPlus size={14} /> Invite
        </button>
      </Card>
    )
  }

  // Apply every active filter (AND across columns, OR within a column).
  const filtered = displayed.filter((m) => {
    const onNow = onShiftNow(m, nowHour, nowDay)
    return FILTER_KEYS.every((key) => filters[key].size === 0 || filters[key].has(filterValue(m, key, onNow)))
  })

  // Coverage stats reflect the whole team (an honest picture of the schedule).
  const coveredHours = new Set<number>()
  for (const m of displayed) {
    const w = shiftWindow(m)
    if (w) for (const h of windowHours(w.start, w.end)) coveredHours.add(h)
  }
  const coverageH = coveredHours.size
  const onNowCount = displayed.filter((m) => onShiftNow(m, nowHour, nowDay)).length
  const gap = largestUncoveredWindow(coveredHours)

  function handleExportCsv() {
    const header = ['Moderator', 'Status', 'Country', 'Shift UTC', 'Timezone', 'Compensation', 'Since']
    const rows = filtered.map((m) => {
      const w = shiftWindow(m)
      const pill = pillFor(m.status, onShiftNow(m, nowHour, nowDay))
      const comp = compensationLabel(m)
      return [
        m.fullName,
        pill.label,
        m.country || 'n/a',
        w ? `${pad(w.start)}-${pad(w.end)}` : 'n/a',
        m.timezone,
        comp.amount,
        sinceLabel(m.startDate) ?? 'n/a',
      ]
    })
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'moderation-team.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Moderation team</h2>
          <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
            {moderators.length} moderators · {onNowCount} on shift now · {coverageH}h of 24 covered
            {anyFilterActive && ` · showing ${filtered.length}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {anyFilterActive && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--text-secondary)] transition-colors hover:text-white"
            >
              <X size={13} /> Clear filters
            </button>
          )}
          {/* View toggle */}
          <div className="inline-flex rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] p-0.5">
            <button
              type="button"
              onClick={() => setView('board')}
              aria-pressed={view === 'board'}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                view === 'board' ? 'bg-white/[0.08] text-white' : 'text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <Rows3 size={14} /> Coverage
            </button>
            <button
              type="button"
              onClick={() => setView('cards')}
              aria-pressed={view === 'cards'}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                view === 'cards' ? 'bg-white/[0.08] text-white' : 'text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <LayoutGrid size={14} /> Cards
            </button>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] bg-white/[0.04] px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#5B8CFF]" /> UTC
          </span>

          <button
            type="button"
            onClick={handleExportCsv}
            className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <Download size={14} /> Export CSV
          </button>

          <button
            type="button"
            onClick={onInvite}
            className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#3F7BFF] to-[#2050E6] px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_8px_20px_-6px_rgba(47,107,255,0.55)] transition hover:brightness-110"
          >
            <UserPlus size={14} /> Invite
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:rgba(91,140,255,0.28)] bg-[color:rgba(47,107,255,0.08)] px-4 py-2.5">
        <span className="text-[12.5px] text-[#a9c4ff]">Activity metrics start from the next sync.</span>
        <button type="button" className="text-[12.5px] font-semibold text-[#5B8CFF] hover:underline">
          Sync now
        </button>
      </div>

      {view === 'board' ? (
        <Card className="p-0">
          <div className="overflow-x-auto overflow-y-visible">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border-card)] text-left align-bottom text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                  <th className="px-5 py-3 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Moderator
                      <ColumnFilter title="Moderator" options={options.name} selected={filters.name} onToggle={(v) => toggleFilter('name', v)} onClear={() => clearFilter('name')} />
                    </span>
                  </th>
                  <th className="px-5 py-3 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Status
                      <ColumnFilter title="Status" options={options.status} selected={filters.status} onToggle={(v) => toggleFilter('status', v)} onClear={() => clearFilter('status')} />
                    </span>
                  </th>
                  <th className="px-5 py-3 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Country
                      <ColumnFilter title="Country" options={options.country} selected={filters.country} onToggle={(v) => toggleFilter('country', v)} onClear={() => clearFilter('country')} />
                    </span>
                  </th>
                  <th className="px-5 py-3 font-medium">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1">
                        Coverage · UTC
                        <ColumnFilter title="Shift" options={options.shift} selected={filters.shift} onToggle={(v) => toggleFilter('shift', v)} onClear={() => clearFilter('shift')} />
                      </span>
                    </div>
                    {/* now-marker + hour ticks */}
                    <div className="relative mt-1.5 w-full">
                      <span
                        className="absolute -top-0 -translate-x-1/2 font-mono text-[9px] font-semibold text-white/80"
                        style={{ left: `${(nowFrac / 24) * 100}%` }}
                      >
                        NOW
                      </span>
                      <div className="mt-4 flex justify-between font-mono text-[9px] normal-case text-[var(--text-muted)]">
                        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
                      </div>
                    </div>
                  </th>
                  <th className="px-5 py-3 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <ColumnFilter title="Contract" options={options.contract} selected={filters.contract} onToggle={(v) => toggleFilter('contract', v)} onClear={() => clearFilter('contract')} align="right" />
                      Compensation
                    </span>
                  </th>
                  <th className="w-10 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const onNow = onShiftNow(m, nowHour, nowDay)
                  const pill = pillFor(m.status, onNow)
                  const w = shiftWindow(m)
                  const comp = compensationLabel(m)
                  const since = sinceLabel(m.startDate)
                  return (
                    <tr
                      key={m.id}
                      onClick={() => setProfileTarget(m)}
                      className="cursor-pointer border-b border-[var(--border-card)] last:border-0 hover:bg-white/[0.04]"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <Avatar m={m} onNow={onNow} />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-white">{m.fullName}</div>
                            <div className="truncate font-mono text-[11px] text-[var(--text-muted)]">{roleLine(m)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge tone={pill.tone}>{pill.label}</Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-[13px] text-[var(--text-primary)]">{m.country || 'n/a'}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {w ? (
                          <div className="min-w-[180px]">
                            <CoverageBar start={w.start} end={w.end} nowFrac={nowFrac} />
                            <div className="mt-1.5 font-mono text-[10px] text-[var(--text-muted)]">
                              {pad(w.start)}, {pad(w.end)} UTC
                            </div>
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] text-[var(--text-muted)]">shift not set</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className={`font-mono font-bold tabular-nums ${comp.muted ? 'text-[var(--text-muted)]' : 'text-white'}`}>
                          {comp.amount}
                        </div>
                        {since && <div className="font-mono text-[10px] text-[var(--text-muted)]">since {since}</div>}
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        <RowMenu moderator={m} onEdit={onEdit} onAddWarning={onAddWarning} onRemove={onRemove} />
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-[13px] text-[var(--text-secondary)]">
                      No moderators match the active filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m) => {
            const onNow = onShiftNow(m, nowHour, nowDay)
            const pill = pillFor(m.status, onNow)
            const w = shiftWindow(m)
            const comp = compensationLabel(m)
            return (
              <Card
                key={m.id}
                hover
                onClick={() => setProfileTarget(m)}
                className="group cursor-pointer p-4"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar m={m} onNow={onNow} />
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-white">{m.fullName}</div>
                      <div className="truncate font-mono text-[11px] text-[var(--text-muted)]">{roleLine(m)}</div>
                    </div>
                  </div>
                  <Badge tone={pill.tone}>{pill.label}</Badge>
                </div>

                <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-[var(--text-secondary)]">
                  <span>{w ? `${pad(w.start)}, ${pad(w.end)} UTC` : 'shift not set'}</span>
                  <span className="text-[var(--text-muted)]">{m.country || m.timezone}</span>
                </div>

                {w && <CoverageBar start={w.start} end={w.end} nowFrac={nowFrac} thin />}

                <div className="mt-4 flex items-center justify-between border-t border-[var(--border-card)] pt-3">
                  <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                    {m.platforms.length > 0 ? m.platforms.join(' · ') : 'n/a'}
                  </span>
                  <span className={`font-mono text-[13px] font-bold tabular-nums ${comp.muted ? 'text-[var(--text-muted)]' : 'text-white'}`}>
                    {comp.amount}
                  </span>
                </div>
              </Card>
            )
          })}
          {filtered.length === 0 && (
            <Card className="col-span-full p-10 text-center text-[13px] text-[var(--text-secondary)]">
              No moderators match the active filters.
            </Card>
          )}
        </div>
      )}

      {/* Uncovered-window banner */}
      {gap && gap.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:rgba(255,143,127,0.3)] bg-[color:rgba(255,143,127,0.08)] px-4 py-2.5">
          <span className="text-[12.5px] text-[#ffb3a6]">
            Uncovered {pad(gap.start)}, {pad(gap.end)} UTC · no moderator on shift for {gap.length}h.
          </span>
          <button type="button" className="text-[12.5px] font-semibold text-[#ff8f7f] hover:underline">
            Assign shift
          </button>
        </div>
      )}

      <ModeratorProfileDrawer
        open={profileTarget !== null}
        moderator={profileTarget}
        onClose={() => setProfileTarget(null)}
        onUpdated={(patch) => profileTarget && mergeUpdate(profileTarget.id, patch)}
        onRemove={(m) => { setProfileTarget(null); onRemove(m) }}
        onViewActivity={() => { setProfileTarget(null); onViewActivity() }}
      />
    </div>
  )
}
