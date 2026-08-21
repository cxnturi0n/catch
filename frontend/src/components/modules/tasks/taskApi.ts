import { updateTask } from '../../../lib/api/operations'
import type { TaskPriority, TaskStatus, WorkspaceId } from '../../../types'

// Small write helpers used by the calendar (drag-and-drop) and the table
// (inline edits). All go through the workspace-scoped tasks API.

export interface TaskFields {
  title: string
  assignee: string
  priority: TaskPriority
  dueDate: string
  status: TaskStatus
}

export async function updateTaskDueDate(workspaceId: WorkspaceId, id: string, dueDate: string): Promise<void> {
  await updateTask(workspaceId, id, { dueDate })
}

export async function updateTaskAssignee(workspaceId: WorkspaceId, id: string, assignee: string): Promise<void> {
  await updateTask(workspaceId, id, { assignee: assignee || null })
}

export async function updateTaskFields(workspaceId: WorkspaceId, id: string, data: TaskFields): Promise<void> {
  await updateTask(workspaceId, id, { title: data.title, assignee: data.assignee || null, priority: data.priority, status: data.status, dueDate: data.dueDate || null })
}
