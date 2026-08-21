import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil } from 'lucide-react'
import type { CatchTask, TaskStatus } from '../../../types'
import { taskStatuses } from '../../../data/mockData'
import { isOverdue } from '../../../lib/format'
import type { TaskMetaMap } from './taskLocalMeta'

type SortKey = 'area' | 'title' | 'status' | 'assignee' | 'start' | 'due'
type SortDir = 'asc' | 'desc'

const STATUS_ORDER: Record<TaskStatus, number> = { 'To Do': 0, 'In Progress': 1, Done: 2 }

const STATUS_TONE: Record<TaskStatus, string> = {
  'To Do': 'text-slate-300 border-slate-500/40 bg-white/[0.03]',
  'In Progress': 'text-sky-200 border-sky-500/40 bg-sky-500/10',
  Done: 'text-emerald-200 border-emerald-500/40 bg-emerald-500/10',
}

const cellInput =
  'w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-slate-200 outline-none transition-colors hover:border-white/15 focus:border-[var(--accent-emerald)]/60 focus:bg-[var(--bg-primary)]'

interface Props {
  tasks: CatchTask[]
  meta: TaskMetaMap
  assigneeSuggestions: string[]
  onEdit: (task: CatchTask) => void
  onMetaChange: (id: string, patch: { area?: string; start?: string }) => void
  onStatusChange: (id: string, status: TaskStatus) => void
  onAssigneeChange: (id: string, assignee: string) => void
  onDueChange: (id: string, due: string) => void
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'area', label: 'Area' },
  { key: 'title', label: 'To do' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'start', label: 'Start date' },
  { key: 'due', label: 'Due date' },
]

export function TaskTable({
  tasks,
  meta,
  assigneeSuggestions,
  onEdit,
  onMetaChange,
  onStatusChange,
  onAssigneeChange,
  onDueChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('due')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    const val = (t: CatchTask): string | number => {
      switch (sortKey) {
        case 'area':
          return (meta[t.id]?.area ?? '').toLowerCase()
        case 'title':
          return t.title.toLowerCase()
        case 'status':
          return STATUS_ORDER[t.status]
        case 'assignee':
          return t.assignee.toLowerCase()
        case 'start':
          return meta[t.id]?.start ?? ''
        case 'due':
          return t.dueDate
      }
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...tasks].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [tasks, meta, sortKey, sortDir])

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--border-card)] bg-white/[0.02]">
              {COLUMNS.map((col) => {
                const active = sortKey === col.key
                return (
                  <th key={col.key} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                    <button
                      onClick={() => toggleSort(col.key)}
                      className={`flex items-center gap-1.5 transition-colors hover:text-white ${active ? 'text-white' : ''}`}
                    >
                      {col.label}
                      {active ? (
                        sortDir === 'asc' ? (
                          <ArrowUp size={13} className="text-[var(--accent-emerald)]" />
                        ) : (
                          <ArrowDown size={13} className="text-[var(--accent-emerald)]" />
                        )
                      ) : (
                        <ArrowUpDown size={13} className="opacity-40" />
                      )}
                    </button>
                  </th>
                )
              })}
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((task) => {
              const m = meta[task.id] ?? {}
              const overdue = task.status !== 'Done' && isOverdue(task.dueDate)
              return (
                <tr key={task.id} className="group border-b border-[var(--border-card)]/60 last:border-0 hover:bg-white/[0.02]">
                  {/* Area — client-side free text */}
                  <td className="px-2 py-1.5 align-middle">
                    <input
                      className={cellInput}
                      value={m.area ?? ''}
                      placeholder="—"
                      onChange={(e) => onMetaChange(task.id, { area: e.target.value })}
                    />
                  </td>

                  {/* To do — task title, opens edit modal */}
                  <td className="px-2 py-1.5 align-middle">
                    <button
                      onClick={() => onEdit(task)}
                      className="max-w-[280px] truncate text-left text-sm font-semibold text-white transition-colors hover:text-[var(--accent-emerald-bright)]"
                      title={task.title}
                    >
                      {task.title}
                    </button>
                  </td>

                  {/* Status — inline select */}
                  <td className="px-2 py-1.5 align-middle">
                    <select
                      value={task.status}
                      onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
                      className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium outline-none ${STATUS_TONE[task.status]}`}
                    >
                      {taskStatuses.map((s) => (
                        <option key={s} value={s} className="bg-[var(--bg-primary)] text-white">
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Assignee — free text + suggestions (Me / moderators) */}
                  <td className="px-2 py-1.5 align-middle">
                    <input
                      className={cellInput}
                      list="task-assignee-suggestions"
                      defaultValue={task.assignee}
                      placeholder="Unassigned"
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v !== task.assignee) onAssigneeChange(task.id, v)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      }}
                    />
                  </td>

                  {/* Start date — client-side */}
                  <td className="px-2 py-1.5 align-middle">
                    <input
                      type="date"
                      lang="en-US"
                      className={`${cellInput} [color-scheme:dark]`}
                      value={m.start ?? ''}
                      onChange={(e) => onMetaChange(task.id, { start: e.target.value })}
                    />
                  </td>

                  {/* Due date — persisted */}
                  <td className="px-2 py-1.5 align-middle">
                    <input
                      type="date"
                      lang="en-US"
                      className={`${cellInput} [color-scheme:dark] ${overdue ? 'text-red-300' : ''}`}
                      value={task.dueDate}
                      onChange={(e) => e.target.value && onDueChange(task.id, e.target.value)}
                    />
                  </td>

                  <td className="px-2 py-1.5 text-right align-middle">
                    <button
                      onClick={() => onEdit(task)}
                      aria-label="Edit task"
                      className="rounded-md p-1.5 text-slate-500 opacity-0 transition-opacity hover:bg-white/5 hover:text-white group-hover:opacity-100"
                    >
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-sm text-[var(--text-secondary)]">
                  No tasks yet. Use “Add Task” to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Shared suggestion list for every assignee cell */}
      <datalist id="task-assignee-suggestions">
        {assigneeSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  )
}
