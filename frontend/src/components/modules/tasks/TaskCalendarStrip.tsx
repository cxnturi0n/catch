import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import type { CatchTask, ContentScheduleItem } from '../../../types'
import { PRIORITY_CHIP, toDateKey, todayKey } from './taskUtils'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAYS_BEFORE = 5 // start a few days in the past so context is visible
const TOTAL_DAYS = 120 // rolling window the user can scroll through
const COL_WIDTH = 148 // px per day column (used for arrow paging)

/**
 * Compact calendar for the SIDE column of the split view: a full-height vertical
 * panel whose days run horizontally. The user scrolls left/right through the
 * days with the mouse wheel (translated to horizontal) and with the ‹ › arrows.
 * Tasks can be dragged from one day to another to reschedule.
 */
export function TaskCalendarStrip({
  tasks,
  onDayClick,
  onEditTask,
  onReschedule,
  contentItems = [],
  onEditContent,
}: {
  tasks: CatchTask[]
  onDayClick: (dateKey: string) => void
  onEditTask: (task: CatchTask) => void
  onReschedule: (id: string, dateKey: string) => void
  contentItems?: ContentScheduleItem[]
  onEditContent?: (item: ContentScheduleItem) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const today = todayKey()

  const days = useMemo(() => {
    const start = new Date()
    start.setDate(start.getDate() - DAYS_BEFORE)
    return Array.from({ length: TOTAL_DAYS }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      return { key: toDateKey(d), date: d }
    })
  }, [])

  const byDay = useMemo(() => {
    const map = new Map<string, CatchTask[]>()
    for (const t of tasks) {
      if (!t.dueDate) continue
      const list = map.get(t.dueDate) ?? []
      list.push(t)
      map.set(t.dueDate, list)
    }
    return map
  }, [tasks])

  const contentByDay = useMemo(() => {
    const map = new Map<string, ContentScheduleItem[]>()
    for (const c of contentItems) {
      const key = toDateKey(new Date(c.scheduledAt))
      const list = map.get(key) ?? []
      list.push(c)
      map.set(key, list)
    }
    return map
  }, [contentItems])

  // Wheel → horizontal scroll (non-passive so we can prevent the page from scrolling).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Start scrolled to "today" on mount.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = DAYS_BEFORE * COL_WIDTH - COL_WIDTH
  }, [])

  function page(dir: -1 | 1) {
    scrollRef.current?.scrollBy({ left: dir * COL_WIDTH * 2, behavior: 'smooth' })
  }
  function goToday() {
    if (scrollRef.current) scrollRef.current.scrollTo({ left: DAYS_BEFORE * COL_WIDTH - COL_WIDTH, behavior: 'smooth' })
  }

  return (
    <div className="glass flex h-full flex-col overflow-hidden rounded-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-card)] px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={16} className="text-[var(--accent-emerald)]" />
          <h3 className="text-sm font-semibold text-white">Calendar</h3>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={goToday} className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-white/5 hover:text-white">
            Today
          </button>
          <button onClick={() => page(-1)} aria-label="Previous days" className="rounded-lg p-1.5 text-slate-300 hover:bg-white/5 hover:text-white">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => page(1)} aria-label="Next days" className="rounded-lg p-1.5 text-slate-300 hover:bg-white/5 hover:text-white">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Horizontal day strip */}
      <div ref={scrollRef} className="flex flex-1 overflow-x-auto overflow-y-hidden">
        {days.map(({ key, date }) => {
          const dayTasks = byDay.get(key) ?? []
          const dayContent = contentByDay.get(key) ?? []
          const isToday = key === today
          const isDragTarget = dragOver === key
          return (
            <div
              key={key}
              style={{ width: COL_WIDTH }}
              className={`flex shrink-0 flex-col border-r border-[var(--border-card)] transition-colors ${
                isDragTarget ? 'bg-[var(--accent-emerald)]/[0.08]' : ''
              }`}
              onDragOver={(e: DragEvent) => {
                e.preventDefault()
                setDragOver(key)
              }}
              onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
              onDrop={(e: DragEvent) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/task-id')
                setDragOver(null)
                if (id) onReschedule(id, key)
              }}
            >
              {/* Day header (click empty to add) */}
              <button
                onClick={() => onDayClick(key)}
                className="flex items-baseline justify-between border-b border-[var(--border-card)] px-3 py-2 text-left hover:bg-white/[0.03]"
              >
                <span className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{WEEKDAYS[(date.getDay() + 6) % 7]}</span>
                <span
                  className={`text-sm font-semibold ${
                    isToday ? 'flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-emerald)] text-white' : 'text-white'
                  }`}
                >
                  {date.getDate()}
                </span>
              </button>

              {/* Tasks */}
              <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2" onClick={() => onDayClick(key)}>
                {dayTasks.map((t) => (
                  <button
                    key={t.id}
                    draggable
                    onDragStart={(e: DragEvent) => e.dataTransfer.setData('text/task-id', t.id)}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditTask(t)
                    }}
                    className={`w-full cursor-grab truncate rounded-lg border px-2 py-1.5 text-left text-[11px] font-medium transition-colors active:cursor-grabbing ${PRIORITY_CHIP[t.priority]}`}
                    title={t.title}
                  >
                    {t.title}
                  </button>
                ))}
                {dayContent.map((c) => (
                  <button
                    key={c.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditContent?.(c)
                    }}
                    className="flex w-full items-center gap-1 truncate rounded-lg border border-[#2dd4bf]/40 bg-gradient-to-r from-[#2dd4bf]/15 to-[#38bdf8]/15 px-2 py-1.5 text-left text-[11px] font-medium text-[#5eead4] transition-colors hover:border-[#5eead4]/70"
                    title={`${c.title}${c.platform ? ` · ${c.platform}` : ''}`}
                  >
                    <Sparkles size={10} className="shrink-0" />
                    <span className="truncate">{c.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
