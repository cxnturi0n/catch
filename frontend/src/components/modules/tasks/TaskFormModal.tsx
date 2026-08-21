import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { taskPriorities, taskStatuses } from '../../../data/mockData'
import { addTask } from '../../../lib/db'
import type { CatchTask, TaskPriority, TaskStatus, WorkspaceId } from '../../../types'
import { Button } from '../../ui/Button'
import { Modal } from '../../ui/Modal'
import { FormField, inputClass } from '../../ui/FormControls'
import { updateTaskFields } from './taskApi'
import { todayKey } from './taskUtils'

const CUSTOM_ASSIGNEE = '__custom__'

interface TaskFormModalProps {
  open: boolean
  onClose: () => void
  workspaceId: WorkspaceId
  /** Task being edited, or null when creating a new one. */
  editingTask: CatchTask | null
  /** Pre-filled due date (e.g. the day clicked in the calendar) for new tasks. */
  prefillDate?: string
  /** Moderator names + known assignees to seed the assignee picker. */
  assigneeSuggestions: string[]
  /** The signed-in user's display name, offered as a "Me" quick-pick. */
  currentUserName?: string
  onCreated: (task: CatchTask) => void
  onUpdated: (task: CatchTask) => void
}

export function TaskFormModal({
  open,
  onClose,
  workspaceId,
  editingTask,
  prefillDate,
  assigneeSuggestions,
  currentUserName,
  onCreated,
  onUpdated,
}: TaskFormModalProps) {
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [customAssignee, setCustomAssignee] = useState(false)
  const [priority, setPriority] = useState<TaskPriority>('Medium')
  const [status, setStatus] = useState<TaskStatus>('To Do')
  const [dueDate, setDueDate] = useState(todayKey())
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ title?: string; assignee?: string; form?: string }>({})

  // Reset the form each time the modal opens, from either the edited task or the
  // create defaults (honoring a calendar-clicked prefill date).
  useEffect(() => {
    if (!open) return
    setErrors({})
    setSubmitting(false)
    if (editingTask) {
      setTitle(editingTask.title)
      setAssignee(editingTask.assignee)
      setPriority(editingTask.priority)
      setStatus(editingTask.status)
      setDueDate(editingTask.dueDate)
      setCustomAssignee(editingTask.assignee !== '' && !assigneeSuggestions.includes(editingTask.assignee))
    } else {
      setTitle('')
      setAssignee('')
      setPriority('Medium')
      setStatus('To Do')
      setDueDate(prefillDate ?? todayKey())
      setCustomAssignee(false)
    }
    // assigneeSuggestions is derived; only re-seed when the modal (re)opens for a task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingTask, prefillDate])

  const options = useMemo(() => {
    const set = new Set(assigneeSuggestions.filter(Boolean))
    if (currentUserName) set.add(currentUserName)
    if (editingTask?.assignee) set.add(editingTask.assignee)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [assigneeSuggestions, currentUserName, editingTask])

  function handleAssigneeSelect(value: string) {
    if (value === CUSTOM_ASSIGNEE) {
      setCustomAssignee(true)
      setAssignee('')
    } else {
      setAssignee(value)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (!title.trim()) nextErrors.title = 'Title is required.'
    if (!assignee.trim()) nextErrors.assignee = 'Assignee is required.'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSubmitting(true)
    const payload = {
      title: title.trim(),
      assignee: assignee.trim(),
      priority,
      dueDate,
      status,
    }
    try {
      if (editingTask) {
        await updateTaskFields(editingTask.id, payload)
        onUpdated({ ...editingTask, ...payload })
      } else {
        const created = await addTask(workspaceId, payload)
        onCreated(created)
      }
      onClose()
    } catch {
      setSubmitting(false)
      setErrors({ form: 'Failed to save task. Please try again.' })
    }
  }

  const showCustomInput = customAssignee || options.length === 0

  return (
    <Modal open={open} onClose={onClose} title={editingTask ? 'Edit Task' : 'Add Task'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField label="Title">
          <input
            className={`${inputClass} ${errors.title ? 'border-red-500' : ''}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Draft Q3 KOL campaign brief"
          />
          {errors.title && <span className="text-xs text-red-400">{errors.title}</span>}
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Assignee">
            {showCustomInput ? (
              <div className="flex flex-col gap-1.5">
                <input
                  className={`${inputClass} ${errors.assignee ? 'border-red-500' : ''}`}
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="e.g. Mia Chen"
                />
                {options.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomAssignee(false)
                      setAssignee('')
                    }}
                    className="self-start text-xs text-[var(--accent-emerald)] hover:underline"
                  >
                    Pick from moderators
                  </button>
                )}
              </div>
            ) : (
              <select
                className={`${inputClass} ${errors.assignee ? 'border-red-500' : ''}`}
                value={options.includes(assignee) ? assignee : ''}
                onChange={(e) => handleAssigneeSelect(e.target.value)}
              >
                <option value="" disabled>
                  Select moderator…
                </option>
                {options.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={CUSTOM_ASSIGNEE}>+ Custom name…</option>
              </select>
            )}
            {currentUserName && assignee !== currentUserName && (
              <button
                type="button"
                onClick={() => {
                  setCustomAssignee(false)
                  setAssignee(currentUserName)
                }}
                className="mt-1 self-start text-xs text-[var(--accent-emerald)] hover:underline"
              >
                Assign to me ({currentUserName})
              </button>
            )}
            {errors.assignee && <span className="text-xs text-red-400">{errors.assignee}</span>}
          </FormField>

          <FormField label="Priority">
            <select
              className={inputClass}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              {taskPriorities.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Due Date">
            <input
              type="date" lang="en-US"
              className={inputClass}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </FormField>
          <FormField label="Status">
            <select
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {taskStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {errors.form && <span className="text-xs text-red-400">{errors.form}</span>}

        <div className="mt-1 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editingTask ? 'Save Changes' : 'Add Task'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
