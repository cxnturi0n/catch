import { supabase } from '../../../lib/supabase'
import type { TaskPriority, TaskStatus } from '../../../types'

// Small write helpers for task fields that db.ts does not expose. These update
// the `tasks` table directly via the shared Supabase client — file ownership
// rules keep us out of db.ts, so reschedule + edit persistence live here.

export interface TaskFields {
  title: string
  assignee: string
  priority: TaskPriority
  dueDate: string
  status: TaskStatus
}

/** Reschedule a task by writing a new due_date (used by calendar drag-and-drop). */
export async function updateTaskDueDate(id: string, dueDate: string): Promise<void> {
  const { error } = await supabase.from('tasks').update({ due_date: dueDate }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Persist just the assignee (used by inline table editing). */
export async function updateTaskAssignee(id: string, assignee: string): Promise<void> {
  const { error } = await supabase.from('tasks').update({ assignee }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Persist a full edit of an existing task. */
export async function updateTaskFields(id: string, data: TaskFields): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({
      title: data.title,
      assignee: data.assignee,
      priority: data.priority,
      status: data.status,
      due_date: data.dueDate,
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
