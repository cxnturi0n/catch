import { useMemo, useState, type DragEvent } from 'react'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import type { CatchTask, ContentScheduleItem } from '../../../types'
import { isOverdue } from '../../../lib/format'
import { PRIORITY_CHIP, toDateKey, todayKey } from './taskUtils'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface TaskCalendarProps {
  tasks: CatchTask[]
  /** Clicking an empty day opens the create modal pre-filled with that date. */
  onDayClick: (dateKey: string) => void
  onEditTask: (task: CatchTask) => void
  /** Drop a task onto a day → reschedule its due date. */
  onReschedule: (id: string, dateKey: string) => void
  contentItems?: ContentScheduleItem[]
  onEditContent?: (item: ContentScheduleItem) => void
}

interface DayCell {
  date: Date
  key: string
  inMonth: boolean
}

export function TaskCalendar({ tasks, onDayClick, onEditTask, onReschedule, contentItems = [], onEditContent }: TaskCalendarProps) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  const today = todayKey()

  const tasksByDay = useMemo(() => {
    const map = new Map<string, CatchTask[]>()
    for (const t of tasks) {
      const list = map.get(t.dueDate)
      if (list) list.push(t)
      else map.set(t.dueDate, [t])
    }
    return map
  }, [tasks])

  const contentByDay = useMemo(() => {
    const map = new Map<string, ContentScheduleItem[]>()
    for (const c of contentItems) {
      const key = toDateKey(new Date(c.scheduledAt))
      const list = map.get(key)
      if (list) list.push(c)
      else map.set(key, [c])
    }
    return map
  }, [contentItems])

  const cells = useMemo<DayCell[]>(() => {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const first = new Date(year, month, 1)
    const startWeekday = (first.getDay() + 6) % 7 // Mon=0 … Sun=6
    const gridStart = new Date(year, month, 1 - startWeekday)
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
      return { date, key: toDateKey(date), inMonth: date.getMonth() === month }
    })
  }, [cursor])

  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  function handleDrop(e: DragEvent<HTMLDivElement>, key: string) {
    e.preventDefault()
    setDragOverKey(null)
    const id = e.dataTransfer.getData('text/plain')
    if (id) onReschedule(id, key)
  }

  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">{monthLabel}</h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCursor(new Date())}
            className="rounded-lg border border-[var(--border-card)] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            Today
          </button>
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            aria-label="Previous month"
            className="rounded-lg border border-[var(--border-card)] p-1.5 text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            aria-label="Next month"
            className="rounded-lg border border-[var(--border-card)] p-1.5 text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            {d}
          </div>
        ))}

        {cells.map((cell) => {
          const dayTasks = tasksByDay.get(cell.key) ?? []
          const dayContent = contentByDay.get(cell.key) ?? []
          const isToday = cell.key === today
          const isDragOver = dragOverKey === cell.key
          return (
            <div
              key={cell.key}
              onClick={() => onDayClick(cell.key)}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverKey(cell.key)
              }}
              onDragLeave={() => setDragOverKey((k) => (k === cell.key ? null : k))}
              onDrop={(e) => handleDrop(e, cell.key)}
              className={`flex min-h-[92px] cursor-pointer flex-col gap-1 rounded-xl border p-1.5 transition-colors ${
                cell.inMonth ? 'bg-[var(--bg-primary)]/60' : 'bg-transparent'
              } ${
                isDragOver
                  ? 'border-[var(--accent-emerald)] bg-[var(--accent-emerald)]/10'
                  : isToday
                    ? 'border-[var(--accent-emerald)]/60'
                    : 'border-[var(--border-card)] hover:border-[var(--accent-emerald)]/30'
              }`}
            >
              <div className="flex items-center justify-between px-0.5">
                <span
                  className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${
                    isToday
                      ? 'bg-[var(--accent-emerald)] text-white'
                      : cell.inMonth
                        ? 'text-slate-300'
                        : 'text-slate-600'
                  }`}
                >
                  {cell.date.getDate()}
                </span>
                {dayTasks.length > 2 && (
                  <span className="text-[10px] text-[var(--text-secondary)]">{dayTasks.length}</span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                {dayTasks.slice(0, 3).map((task) => {
                  const overdue = task.status !== 'Done' && isOverdue(task.dueDate)
                  return (
                    <button
                      key={task.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', task.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditTask(task)
                      }}
                      title={`${task.title} — ${task.assignee} (${task.priority})`}
                      className={`flex items-center gap-1 truncate rounded-md border px-1.5 py-1 text-left text-[11px] font-medium transition-colors ${PRIORITY_CHIP[task.priority]} ${
                        task.status === 'Done' ? 'opacity-60 line-through' : ''
                      }`}
                    >
                      {overdue && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />}
                      <span className="truncate">{task.title}</span>
                    </button>
                  )
                })}
                {dayTasks.length > 3 && (
                  <span className="px-1 text-[10px] text-[var(--text-secondary)]">+{dayTasks.length - 3} more</span>
                )}
                {dayContent.slice(0, 2).map((item) => (
                  <button
                    key={item.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditContent?.(item)
                    }}
                    title={`${item.title}${item.platform ? ` · ${item.platform}` : ''}`}
                    className="flex items-center gap-1 truncate rounded-md border border-[#2dd4bf]/40 bg-gradient-to-r from-[#2dd4bf]/15 to-[#38bdf8]/15 px-1.5 py-1 text-left text-[11px] font-medium text-[#5eead4] transition-colors hover:border-[#5eead4]/70"
                  >
                    <Sparkles size={10} className="shrink-0" />
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
                {dayContent.length > 2 && (
                  <span className="px-1 text-[10px] text-[#5eead4]">+{dayContent.length - 2} content</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-center text-[11px] text-[var(--text-secondary)]">
        Click a day to add a task · drag a task chip to reschedule
      </p>
    </div>
  )
}
