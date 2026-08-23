import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Moderator, ModeratorShift } from '../../../types'
import { useNow } from '../../../hooks/useNow'
import { Card } from '../../ui/Card'
import { Modal } from '../../ui/Modal'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SHIFT_ROWS: ModeratorShift[] = ['Morning (06-14)', 'Afternoon (14-22)', 'Night (22-06)']

function shiftRowIndex(shift: ModeratorShift): number {
  return SHIFT_ROWS.indexOf(shift)
}

function currentShiftRowIndex(hour: number): number {
  if (hour >= 6 && hour < 14) return 0
  if (hour >= 14 && hour < 22) return 1
  return 2
}

function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7 // Mon=0..Sun=6
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}

function buildDefaultGrid(moderators: Moderator[]): Record<string, string[]> {
  const grid: Record<string, string[]> = {}
  for (let day = 0; day < 7; day++) {
    for (let row = 0; row < 3; row++) {
      grid[`${day}-${row}`] = []
    }
  }
  for (const m of moderators) {
    const row = shiftRowIndex(m.shift)
    if (row === -1) continue
    for (let day = 0; day < 7; day++) {
      grid[`${day}-${row}`].push(m.id)
    }
  }
  return grid
}

export function ScheduleTab({ moderators }: { moderators: Moderator[] }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [grid, setGrid] = useState<Record<string, string[]>>(() => buildDefaultGrid(moderators))
  const [editingCell, setEditingCell] = useState<{ day: number; row: number } | null>(null)

  // Workspace switched (moderators list identity changes), rebuild default assignments.
  useEffect(() => {
    setGrid(buildDefaultGrid(moderators))
  }, [moderators])

  // Ticking, the today column and the highlighted shift row must not freeze.
  const now = useNow()
  const todayMonday = mondayOf(now)
  const weekStart = new Date(todayMonday)
  weekStart.setDate(weekStart.getDate() + weekOffset * 7)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const isCurrentWeek = weekOffset === 0
  const todayColumnIndex = (now.getDay() + 6) % 7
  const activeShiftRow = currentShiftRowIndex(now.getHours())

  const rangeLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  const moderatorById = useMemo(() => new Map(moderators.map((m) => [m.id, m])), [moderators])

  function toggleAssignment(day: number, row: number, moderatorId: string) {
    const key = `${day}-${row}`
    setGrid((prev) => {
      const current = prev[key] ?? []
      const next = current.includes(moderatorId) ? current.filter((id) => id !== moderatorId) : [...current, moderatorId]
      return { ...prev, [key]: next }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setWeekOffset((w) => w - 1)}
          className="flex items-center gap-1 rounded-lg border border-[var(--border-card)] px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-white/[0.04] transition-colors"
        >
          <ChevronLeft size={14} /> Previous Week
        </button>
        <div className="text-sm font-medium text-white">{rangeLabel}</div>
        <button
          onClick={() => setWeekOffset((w) => w + 1)}
          className="flex items-center gap-1 rounded-lg border border-[var(--border-card)] px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-white/[0.04] transition-colors"
        >
          Next Week <ChevronRight size={14} />
        </button>
      </div>

      <Card className="overflow-x-auto p-4">
        <div className="grid min-w-[800px] grid-cols-[100px_repeat(7,1fr)] gap-2">
          <div />
          {DAYS.map((d, i) => (
            <div
              key={d}
              className={`rounded-lg px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] ${
                isCurrentWeek && i === todayColumnIndex ? 'bg-blue-500/10 text-blue-300' : ''
              }`}
            >
              {d}
            </div>
          ))}

          {SHIFT_ROWS.map((shift, row) => (
            <Fragment key={row}>
              <div className="flex items-center px-2 text-xs font-medium text-[var(--text-secondary)]">{shift}</div>
              {DAYS.map((_, day) => {
                const key = `${day}-${row}`
                const assigned = grid[key] ?? []
                const isActive = isCurrentWeek && day === todayColumnIndex && row === activeShiftRow
                return (
                  <button
                    key={key}
                    onClick={() => setEditingCell({ day, row })}
                    className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-lg border p-1.5 transition-colors ${
                      isActive
                        ? 'border-blue-400 shadow-[var(--glow-emerald)]'
                        : 'border-[var(--border-card)] hover:bg-white/[0.03]'
                    } ${isCurrentWeek && day === todayColumnIndex ? 'bg-blue-500/[0.04]' : ''}`}
                  >
                    {assigned.length === 0 && <span className="text-[10px] text-slate-600">Unassigned</span>}
                    {assigned.map((id) => {
                      const mod = moderatorById.get(id)
                      if (!mod) return null
                      return (
                        <span key={id} className="flex items-center gap-1 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-emerald)] text-[8px] font-bold">
                            {mod.avatarInitials}
                          </span>
                          {mod.timezone}
                        </span>
                      )
                    })}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </Card>

      <Modal
        open={editingCell !== null}
        onClose={() => setEditingCell(null)}
        title={editingCell ? `Assign, ${DAYS[editingCell.day]} · ${SHIFT_ROWS[editingCell.row]}` : 'Assign'}
      >
        {editingCell && (
          <div className="flex flex-col gap-2">
            {moderators.length === 0 && <p className="text-sm text-[var(--text-secondary)]">No moderators to assign yet.</p>}
            {moderators.map((m) => {
              const key = `${editingCell.day}-${editingCell.row}`
              const assigned = (grid[key] ?? []).includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => toggleAssignment(editingCell.day, editingCell.row, m.id)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                    assigned
                      ? 'border-blue-500/50 bg-blue-500/10 text-white'
                      : 'border-[var(--border-card)] text-slate-300 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-emerald)] text-[10px] font-bold text-white">
                      {m.avatarInitials}
                    </span>
                    {m.fullName}
                  </span>
                  <span className="text-xs">{assigned ? 'Assigned, click to remove' : 'Click to assign'}</span>
                </button>
              )
            })}
          </div>
        )}
      </Modal>
    </div>
  )
}
