import { api } from './client'
import type { CatchTask, ContentScheduleItem, Meeting, TaskPriority, TaskStatus, WorkspaceId } from '../../types'

// ── Tasks ───────────────────────────────────────────────────────────────────

interface ApiTask {
  id: string
  title: string
  assignee: string | null
  area: string | null
  priority: string
  status: string
  startDate: string | null
  dueDate: string | null
}

const mapTask = (t: ApiTask): CatchTask => ({
  id: t.id,
  title: t.title,
  assignee: t.assignee ?? '',
  priority: t.priority as TaskPriority,
  status: t.status as TaskStatus,
  dueDate: t.dueDate ?? '',
  area: t.area ?? undefined,
  startDate: t.startDate ?? undefined,
})

const tasksBase = (ws: WorkspaceId) => `/workspaces/${ws}/tasks`

export async function fetchTasks(workspaceId: WorkspaceId): Promise<CatchTask[]> {
  return (await api<{ tasks: ApiTask[] }>(tasksBase(workspaceId))).tasks.map(mapTask)
}

export async function addTask(workspaceId: WorkspaceId, data: Omit<CatchTask, 'id'>): Promise<CatchTask> {
  const r = await api<{ task: ApiTask }>(tasksBase(workspaceId), {
    method: 'POST',
    body: { title: data.title, assignee: data.assignee || null, priority: data.priority, status: data.status, dueDate: data.dueDate || null, area: data.area ?? null, startDate: data.startDate ?? null },
  })
  return mapTask(r.task)
}

export type TaskPatch = Partial<{ title: string; assignee: string | null; area: string | null; priority: TaskPriority; status: TaskStatus; startDate: string | null; dueDate: string | null }>

export async function updateTask(workspaceId: WorkspaceId, id: string, patch: TaskPatch): Promise<CatchTask> {
  return mapTask((await api<{ task: ApiTask }>(`${tasksBase(workspaceId)}/${id}`, { method: 'PATCH', body: patch })).task)
}

export async function deleteTask(workspaceId: WorkspaceId, id: string): Promise<void> {
  await api(`${tasksBase(workspaceId)}/${id}`, { method: 'DELETE' })
}

export async function updateTaskStatus(workspaceId: WorkspaceId, id: string, status: TaskStatus): Promise<void> {
  await updateTask(workspaceId, id, { status })
}

export async function seedTasks(workspaceId: WorkspaceId, tasks: CatchTask[]): Promise<CatchTask[]> {
  const out: CatchTask[] = []
  for (const t of tasks) out.push(await addTask(workspaceId, t))
  return out
}

// ── Meetings ────────────────────────────────────────────────────────────────

const meetingsBase = (ws: WorkspaceId) => `/workspaces/${ws}/meetings`

export async function fetchMeetings(workspaceId: WorkspaceId, sinceDays = 30): Promise<Meeting[]> {
  return (await api<{ meetings: Meeting[] }>(`${meetingsBase(workspaceId)}?sinceDays=${sinceDays}`)).meetings
}

export interface NewMeetingInput {
  workspaceId: WorkspaceId
  title: string
  description?: string | null
  startsAt: string
  endsAt: string
  meetLink?: string | null
  attendeeEmails?: string[]
  attendeeModeratorIds?: string[]
  provider?: Meeting['provider']
  createdBy?: string | null
}

export async function insertMeeting(input: NewMeetingInput): Promise<Meeting> {
  const { workspaceId, createdBy: _ignored, ...body } = input
  return (await api<{ meeting: Meeting }>(meetingsBase(workspaceId), { method: 'POST', body: { ...body, meetLink: body.meetLink || null } })).meeting
}

export async function deleteMeeting(workspaceId: WorkspaceId, id: string): Promise<void> {
  await api(`${meetingsBase(workspaceId)}/${id}`, { method: 'DELETE' })
}

// ── Content schedule ────────────────────────────────────────────────────────

const contentBase = (ws: WorkspaceId) => `/workspaces/${ws}/content`

export async function fetchContentSchedule(workspaceId: WorkspaceId, sinceDays = 60): Promise<ContentScheduleItem[]> {
  return (await api<{ items: ContentScheduleItem[] }>(`${contentBase(workspaceId)}?sinceDays=${sinceDays}`)).items
}

export interface NewContentInput {
  workspaceId: WorkspaceId
  title: string
  description?: string | null
  platform?: ContentScheduleItem['platform']
  scheduledAt: string
  ownerUserId?: string | null
  assignedModeratorId?: string | null
  notes?: string | null
  attachments?: ContentScheduleItem['attachments']
}

export async function insertContentScheduleItem(input: NewContentInput): Promise<ContentScheduleItem> {
  const { workspaceId, ownerUserId: _ignored, ...body } = input
  return (await api<{ item: ContentScheduleItem }>(contentBase(workspaceId), { method: 'POST', body })).item
}

export async function updateContentScheduleItem(
  workspaceId: WorkspaceId,
  id: string,
  patch: Partial<Omit<ContentScheduleItem, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'ownerUserId'>>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return
  await api(`${contentBase(workspaceId)}/${id}`, { method: 'PATCH', body: patch })
}

export async function deleteContentScheduleItem(workspaceId: WorkspaceId, id: string): Promise<void> {
  await api(`${contentBase(workspaceId)}/${id}`, { method: 'DELETE' })
}
