import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ChevronUp, PanelRightClose, PanelRightOpen, Minus, X } from 'lucide-react'
import type { CatchTask } from '../../../types'
import { PRIORITY_DOT, isWithinDays, startOfWeek, todayKey } from './taskUtils'

type Mode = 'panel' | 'pill' | 'dock'

interface SummaryStats {
  todayTotal: number
  todayDone: number
  weekTotal: number
  weekDone: number
  todayTasks: CatchTask[]
  weekTasks: CatchTask[]
}

function useSummary(tasks: CatchTask[]): SummaryStats {
  return useMemo(() => {
    const today = todayKey()
    const now = new Date()
    const weekStart = startOfWeek(now)
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)

    const todayTasks = tasks.filter((t) => t.dueDate === today)
    const weekTasks = tasks
      .filter((t) => isWithinDays(t.dueDate, weekStart, weekEnd))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

    return {
      todayTotal: todayTasks.length,
      todayDone: todayTasks.filter((t) => t.status === 'Done').length,
      weekTotal: weekTasks.length,
      weekDone: weekTasks.filter((t) => t.status === 'Done').length,
      todayTasks,
      weekTasks,
    }
  }, [tasks])
}

function TaskLine({ task, onClick }: { task: CatchTask; onClick: (t: CatchTask) => void }) {
  const done = task.status === 'Done'
  return (
    <button
      onClick={() => onClick(task)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
    >
      {done ? (
        <CheckCircle2 size={14} className="shrink-0 text-[var(--accent-emerald)]" />
      ) : (
        <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} />
      )}
      <span className={`flex-1 truncate text-xs ${done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
        {task.title}
      </span>
      <span className="shrink-0 text-[10px] text-[var(--text-secondary)]">{task.assignee}</span>
    </button>
  )
}

function StatBlock({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex-1 rounded-xl border border-[var(--border-card)] bg-[var(--bg-primary)]/50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1 text-lg font-bold text-white">
        {total} <span className="text-xs font-medium text-[var(--text-secondary)]">task{total === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-1 text-xs text-[var(--accent-emerald-bright)]">{done} done · {pct}%</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full gradient-bar-emerald" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function TaskSummaryPopup({
  tasks,
  onClose,
  onTaskClick,
}: {
  tasks: CatchTask[]
  onClose: () => void
  onTaskClick: (task: CatchTask) => void
}) {
  const [mode, setMode] = useState<Mode>('panel')
  const s = useSummary(tasks)

  const list = s.todayTasks.length > 0 ? s.todayTasks : s.weekTasks
  const listLabel = s.todayTasks.length > 0 ? 'Today' : 'This week'

  // Minimized: a small pill fixed at the bottom that re-expands on click.
  if (mode === 'pill') {
    return (
      <motion.button
        onClick={() => setMode('panel')}
        initial={{ y: 12 }}
        animate={{ y: 0 }}
        className="glass-panel glow fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg"
      >
        <span className="flex h-2 w-2 rounded-full bg-[var(--accent-emerald)]" />
        Today {s.todayDone}/{s.todayTotal}
        <ChevronUp size={15} className="text-[var(--text-secondary)]" />
      </motion.button>
    )
  }

  const docked = mode === 'dock'

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={mode}
        initial={docked ? { x: 24 } : { y: 24 }}
        animate={docked ? { x: 0 } : { y: 0 }}
        exit={docked ? { x: 24 } : { y: 24 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className={
          docked
            ? 'glass-panel glow fixed right-4 top-1/2 z-40 flex max-h-[80vh] w-80 -translate-y-1/2 flex-col rounded-2xl'
            : 'glass-panel glow fixed bottom-5 left-1/2 z-40 flex max-h-[72vh] w-[min(92vw,460px)] -translate-x-1/2 flex-col rounded-2xl'
        }
      >
        <div className="flex items-center justify-between border-b border-[var(--border-card)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Task Summary</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setMode(docked ? 'panel' : 'dock')}
              aria-label={docked ? 'Undock to center' : 'Dock to side'}
              title={docked ? 'Undock to center' : 'Dock to side'}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              {docked ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            </button>
            <button
              onClick={() => setMode('pill')}
              aria-label="Minimize"
              title="Minimize"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Minus size={16} />
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              title="Close"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          <div className="flex gap-3">
            <StatBlock label="Today" done={s.todayDone} total={s.todayTotal} />
            <StatBlock label="This week" done={s.weekDone} total={s.weekTotal} />
          </div>

          <div className="mt-1">
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              {listLabel}
            </div>
            <div className="flex flex-col">
              {list.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border-card)] py-4 text-center text-xs text-[var(--text-secondary)]">
                  Nothing scheduled — enjoy the calm.
                </div>
              ) : (
                list.map((task) => <TaskLine key={task.id} task={task} onClick={onTaskClick} />)
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
