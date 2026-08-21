import { useMemo } from 'react'
import { ArrowRight, Pencil } from 'lucide-react'
import type { CatchTask, TaskStatus } from '../../../types'
import { Badge } from '../../ui/Badge'
import { Card } from '../../ui/Card'
import { formatDay, isOverdue } from '../../../lib/format'
import { PRIORITY_TONE, initialsOf } from './taskUtils'

const STATUS_COLUMNS: TaskStatus[] = ['To Do', 'In Progress', 'Done']

const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  'To Do': 'In Progress',
  'In Progress': 'Done',
  Done: null,
}

function BoardCard({
  task,
  onAdvance,
  onEdit,
}: {
  task: CatchTask
  onAdvance: (id: string) => void
  onEdit: (task: CatchTask) => void
}) {
  const overdue = task.status !== 'Done' && isOverdue(task.dueDate)
  const next = NEXT_STATUS[task.status]

  return (
    <div className="group rounded-xl border border-[var(--border-card)] bg-[var(--bg-primary)] p-4 transition-colors hover:border-[var(--accent-emerald)]/40">
      <div className="mb-2 flex items-start justify-between gap-2">
        <button
          onClick={() => onEdit(task)}
          className="text-left text-sm font-bold text-white hover:text-[var(--accent-emerald-bright)] transition-colors"
        >
          {task.title}
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
          <button
            onClick={() => onEdit(task)}
            aria-label="Edit task"
            className="rounded-md p-1 text-slate-500 opacity-0 transition-opacity hover:bg-white/5 hover:text-white group-hover:opacity-100"
          >
            <Pencil size={13} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-emerald)] text-[10px] font-bold text-white">
          {initialsOf(task.assignee)}
        </span>
        {task.assignee}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={overdue ? 'font-semibold text-red-400' : 'text-[var(--text-secondary)]'}>
          Due {formatDay(task.dueDate)}
        </span>
        {overdue && (
          <span className="rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
            Overdue
          </span>
        )}
      </div>
      {next && (
        <button
          onClick={() => onAdvance(task.id)}
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          Move to {next} <ArrowRight size={12} />
        </button>
      )}
    </div>
  )
}

export function TaskBoard({
  tasks,
  onAdvance,
  onEdit,
}: {
  tasks: CatchTask[]
  onAdvance: (id: string) => void
  onEdit: (task: CatchTask) => void
}) {
  const grouped = useMemo(() => {
    const map: Record<TaskStatus, CatchTask[]> = { 'To Do': [], 'In Progress': [], Done: [] }
    for (const t of tasks) map[t.status].push(t)
    return map
  }, [tasks])

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {STATUS_COLUMNS.map((status) => (
        <Card key={status} className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{status}</h3>
            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
              {grouped[status].length}
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {grouped[status].map((task) => (
              <BoardCard key={task.id} task={task} onAdvance={onAdvance} onEdit={onEdit} />
            ))}
            {grouped[status].length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--border-card)] py-6 text-center text-xs text-[var(--text-secondary)]">
                No tasks here
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}
