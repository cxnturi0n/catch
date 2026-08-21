import { useEffect, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, Clock, Video } from 'lucide-react'
import type { CatchTask, Meeting } from '../../../types'
import { isOverdue } from '../../../lib/format'
import { useTimezone } from '../../../context/TimezoneContext'
import { dateKeyInTz, formatTimeInTz, wallMinutesInTz } from '../../../lib/formatTime'
import { zoneShortOffset } from '../../../lib/timezones'
import { PRIORITY_CHIP, toDateKey, todayKey } from './taskUtils'

export type CalendarFilter = 'all' | 'tasks' | 'meetings'

const SLOT_H = 28 // px per 30-min slot
const SLOTS = 48 // 24h × 2

interface Props {
  day: Date
  onDayChange: (d: Date) => void
  tasks: CatchTask[]
  meetings: Meeting[]
  filter: CalendarFilter
  onEditTask: (task: CatchTask) => void
  onAddTask: (dateKey: string) => void
  onMeetingClick: (meeting: Meeting) => void
}

export function TaskTimeCalendar({
  day,
  onDayChange,
  tasks,
  meetings,
  filter,
  onEditTask,
  onAddTask,
  onMeetingClick,
}: Props) {
  const { timezone } = useTimezone()
  const scrollRef = useRef<HTMLDivElement>(null)
  const dayKey = toDateKey(day)
  const isToday = dayKey === todayKey()

  // Scroll to ~7am on first mount / day change so the working hours are visible.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * 2 * SLOT_H
  }, [dayKey])

  const dayTasks = useMemo(
    () => (filter === 'meetings' ? [] : tasks.filter((t) => t.dueDate === dayKey)),
    [tasks, dayKey, filter],
  )

  const dayMeetings = useMemo(() => {
    if (filter === 'tasks') return []
    // Position + filter by the wall clock in the ACCOUNT timezone, so the grid
    // reads in the CM's chosen zone rather than the browser's local time.
    return meetings
      .filter((m) => dateKeyInTz(m.startsAt, timezone) === dayKey)
      .map((m) => {
        const start = Math.max(0, wallMinutesInTz(m.startsAt, timezone))
        // A meeting ending on the next day (in this zone) clamps to end-of-day.
        const end = dateKeyInTz(m.endsAt, timezone) === dayKey ? wallMinutesInTz(m.endsAt, timezone) : 24 * 60
        return { meeting: m, top: (start / 30) * SLOT_H, height: Math.max(((end - start) / 30) * SLOT_H, 20) }
      })
  }, [meetings, dayKey, timezone, filter])

  const label = day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })

  function shiftDay(delta: number) {
    onDayChange(new Date(day.getFullYear(), day.getMonth(), day.getDate() + delta))
  }

  return (
    <div className="glass flex h-full flex-col rounded-2xl p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{label}</div>
          <div className="text-[11px] text-[var(--text-secondary)]">30-minute slots · times in {zoneShortOffset(timezone)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onDayChange(new Date())}
            className="rounded-lg border border-[var(--border-card)] px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            Today
          </button>
          <button onClick={() => shiftDay(-1)} aria-label="Previous day" className="rounded-lg border border-[var(--border-card)] p-1.5 text-slate-300 hover:bg-white/5 hover:text-white">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => shiftDay(1)} aria-label="Next day" className="rounded-lg border border-[var(--border-card)] p-1.5 text-slate-300 hover:bg-white/5 hover:text-white">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* All-day tasks strip (tasks carry a date, not a time) */}
      {filter !== 'meetings' && (
        <button
          onClick={() => onAddTask(dayKey)}
          className="mb-2 flex min-h-[40px] w-full flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-[var(--border-card)] p-1.5 text-left transition-colors hover:border-[var(--accent-emerald)]/40"
        >
          {dayTasks.length === 0 ? (
            <span className="px-1 text-[11px] text-[var(--text-secondary)]">
              {isToday ? 'Today' : 'Day'} · click to add a task
            </span>
          ) : (
            dayTasks.map((task) => {
              const overdue = task.status !== 'Done' && isOverdue(task.dueDate)
              return (
                <span
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditTask(task)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                      onEditTask(task)
                    }
                  }}
                  className={`flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-1 text-[11px] font-medium ${PRIORITY_CHIP[task.priority]} ${
                    task.status === 'Done' ? 'opacity-60 line-through' : ''
                  }`}
                >
                  {overdue && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />}
                  <span className="truncate">{task.title}</span>
                </span>
              )
            })
          )}
        </button>
      )}

      {/* Hour grid with 30-min rows */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto rounded-xl border border-[var(--border-card)]">
        <div className="relative" style={{ height: SLOTS * SLOT_H }}>
          {/* Hour rows + labels */}
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="absolute left-0 right-0 flex" style={{ top: h * 2 * SLOT_H, height: 2 * SLOT_H }}>
              <div className="w-12 shrink-0 border-r border-[var(--border-card)] pr-1 pt-0.5 text-right text-[10px] text-[var(--text-secondary)]">
                {String(h).padStart(2, '0')}:00
              </div>
              <div className="flex-1">
                <div className="h-[28px] border-b border-[var(--border-card)]/40" />
                <div className="h-[28px] border-b border-[var(--border-card)]" />
              </div>
            </div>
          ))}

          {/* Meeting blocks */}
          {dayMeetings.map(({ meeting, top, height }) => (
            <button
              key={meeting.id}
              onClick={() => onMeetingClick(meeting)}
              style={{ top, height, left: '3.25rem' }}
              className="absolute right-1 flex flex-col gap-0.5 overflow-hidden rounded-md border border-[#38bdf8]/50 bg-gradient-to-r from-[#38bdf8]/20 to-[#2dd4bf]/20 px-2 py-1 text-left text-[11px] text-[#bae6fd] transition-colors hover:border-[#38bdf8]"
            >
              <span className="flex items-center gap-1 font-semibold text-white">
                <Video size={11} className="shrink-0" />
                <span className="truncate">{meeting.title}</span>
              </span>
              <span className="flex items-center gap-1 text-[10px] text-[#bae6fd]/80">
                <Clock size={9} /> {formatTimeInTz(meeting.startsAt, timezone)}–{formatTimeInTz(meeting.endsAt, timezone)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
