import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { CalendarClock, LayoutGrid, Loader2, Plus, Table2, Video } from 'lucide-react'
import { getTasks as getSeedTasks } from '../../data/mockData'
import { fetchModerators, fetchTasks, seedTasks, updateTaskStatus } from '../../lib/db'
import { deleteMeeting, fetchMeetings } from '../../lib/dbPlatformV2'
import type { CatchTask, Meeting, Moderator, TaskStatus } from '../../types'
import { Button } from '../ui/Button'
import { Select } from '../ui/FormControls'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useWorkspaceData } from '../../hooks/useWorkspaceData'
import { TaskBoard } from './tasks/TaskBoard'
import { TaskTable } from './tasks/TaskTable'
import { TaskTimeCalendar, type CalendarFilter } from './tasks/TaskTimeCalendar'
import { TaskFormModal } from './tasks/TaskFormModal'
import { updateTask } from '../../lib/api/operations'
import type { TaskMeta, TaskMetaMap } from './tasks/taskLocalMeta'
import { updateTaskAssignee, updateTaskDueDate } from './tasks/taskApi'
import { MeetingFormModal } from './meetings/MeetingFormModal'
import { MeetingDetailModal } from './meetings/MeetingDetailModal'

const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  'To Do': 'In Progress',
  'In Progress': 'Done',
  Done: null,
}

// Left-pane content mode. The Calendar always lives in the right pane; the
// Board/Calendar/Table controls drive both which left mode is shown and how the
// resizable split is collapsed.
type LeftMode = 'table' | 'board'

const CALENDAR_FILTERS = ['All', 'Tasks', 'Meetings']
const FILTER_MAP: Record<string, CalendarFilter> = { All: 'all', Tasks: 'tasks', Meetings: 'meetings' }

export function Tasks() {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data: tasks, setData: setTasks, loading } = useWorkspaceData(
    activeWorkspaceId,
    fetchTasks,
    seedTasks,
    getSeedTasks,
    !!user,
  )

  // Area and start date are task columns now; the table still consumes them
  // as a side map keyed by task id.
  const taskMeta = useMemo<TaskMetaMap>(
    () => Object.fromEntries(tasks.map((t) => [t.id, { ...(t.area && { area: t.area }), ...(t.startDate && { start: t.startDate }) }])),
    [tasks],
  )
  function updateTaskMeta(id: string, patch: Partial<TaskMeta>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...(patch.area !== undefined && { area: patch.area || undefined }), ...(patch.start !== undefined && { startDate: patch.start || undefined }) } : t)))
    void updateTask(activeWorkspaceId, id, { ...(patch.area !== undefined && { area: patch.area || null }), ...(patch.start !== undefined && { startDate: patch.start || null }) }).catch(() => undefined)
  }

  // Layout: leftMode + split percentage (left pane width). 100 = table/board
  // full width, 0 = calendar full width, anything between = split view.
  const [leftMode, setLeftMode] = useState<LeftMode>('table')
  // Default to the SPLIT view (table/board + calendar side by side) so the split
  // is discoverable — the client sees both panes without having to drag anything.
  const [splitPct, setSplitPct] = useState(60)
  const dragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const [calendarFilterLabel, setCalendarFilterLabel] = useState('All')
  const calendarFilter = FILTER_MAP[calendarFilterLabel] ?? 'all'
  const [calendarDay, setCalendarDay] = useState(() => new Date())

  const [moderators, setModerators] = useState<Moderator[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])

  // Task modal state — editingTask null = create; prefillDate seeds the due date.
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<CatchTask | null>(null)
  const [prefillDate, setPrefillDate] = useState<string | undefined>(undefined)

  // Meeting modals
  const [meetingFormOpen, setMeetingFormOpen] = useState(false)
  const [meetingDetail, setMeetingDetail] = useState<Meeting | null>(null)

  // Load moderators + meetings (best-effort; guests / RLS fall back to empty).
  useEffect(() => {
    if (!user || !activeWorkspaceId) {
      setModerators([])
      setMeetings([])
      return
    }
    let cancelled = false
    fetchModerators(activeWorkspaceId)
      .then((mods) => { if (!cancelled) setModerators(mods) })
      .catch(() => { if (!cancelled) setModerators([]) })
    fetchMeetings(activeWorkspaceId, 120)
      .then((m) => { if (!cancelled) setMeetings(m) })
      .catch(() => { if (!cancelled) setMeetings([]) })
    return () => { cancelled = true }
  }, [user, activeWorkspaceId])

  const assigneeSuggestions = useMemo(() => {
    const set = new Set<string>()
    if (user?.name) set.add(user.name)
    for (const m of moderators) if (m.fullName) set.add(m.fullName)
    for (const t of tasks) if (t.assignee) set.add(t.assignee)
    return [...set]
  }, [user, moderators, tasks])

  // ── Split divider drag ──
  const onDividerDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      const clamped = Math.max(0, Math.min(100, pct))
      // Snap near the edges so a pane can fully collapse.
      setSplitPct(clamped < 4 ? 0 : clamped > 96 ? 100 : clamped)
    }
    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const layout = splitPct >= 98 ? 'left' : splitPct <= 2 ? 'calendar' : 'split'

  // Table/Board keep the calendar alongside (split) so it stays visible; drag the
  // divider (or double-click it) to go full-width. Calendar = calendar full.
  function showTable() { setLeftMode('table'); setSplitPct(60) }
  function showBoard() { setLeftMode('board'); setSplitPct(60) }
  function showCalendar() { setSplitPct(0) }

  // ── Task mutations ──
  function changeStatus(id: string, status: TaskStatus) {
    const current = tasks.find((t) => t.id === id)
    if (!current || current.status === status) return
    const previous = current.status
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)))
    void updateTaskStatus(activeWorkspaceId, id, status).catch(() => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: previous } : t)))
    })
  }

  function advanceTask(id: string) {
    const current = tasks.find((t) => t.id === id)
    if (!current) return
    const next = NEXT_STATUS[current.status]
    if (next) changeStatus(id, next)
  }

  function changeAssignee(id: string, assignee: string) {
    const current = tasks.find((t) => t.id === id)
    if (!current || current.assignee === assignee) return
    const previous = current.assignee
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, assignee } : t)))
    void updateTaskAssignee(activeWorkspaceId, id, assignee).catch(() => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, assignee: previous } : t)))
    })
  }

  function rescheduleTask(id: string, dateKey: string) {
    const current = tasks.find((t) => t.id === id)
    if (!current || current.dueDate === dateKey) return
    const previousDate = current.dueDate
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, dueDate: dateKey } : t)))
    void updateTaskDueDate(activeWorkspaceId, id, dateKey).catch(() => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, dueDate: previousDate } : t)))
    })
  }

  function openCreate(date?: string) {
    setEditingTask(null)
    setPrefillDate(date)
    setModalOpen(true)
  }

  function openEdit(task: CatchTask) {
    setEditingTask(task)
    setPrefillDate(undefined)
    setModalOpen(true)
  }

  function handleCreated(task: CatchTask) {
    setTasks((prev) => [task, ...prev])
  }

  function handleUpdated(updated: CatchTask) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
  }

  // ── Meeting mutations ──
  function handleMeetingCreated(m: Meeting) {
    setMeetings((prev) => [...prev, m].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
  }

  async function handleMeetingDelete(id: string) {
    const prev = meetings
    setMeetings((list) => list.filter((m) => m.id !== id))
    setMeetingDetail(null)
    try {
      await deleteMeeting(activeWorkspaceId, id)
      showToast('Meeting deleted.', 'success')
    } catch {
      setMeetings(prev)
      showToast('Failed to delete meeting.', 'error')
    }
  }

  const toggleBtn = (active: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? 'gradient-bar-emerald text-white shadow-[var(--glow-emerald)]'
        : 'text-[var(--text-secondary)] hover:text-white'
    }`

  const leftPane =
    leftMode === 'board' ? (
      <TaskBoard tasks={tasks} onAdvance={advanceTask} onEdit={openEdit} />
    ) : (
      <TaskTable
        tasks={tasks}
        meta={taskMeta}
        assigneeSuggestions={assigneeSuggestions}
        onEdit={openEdit}
        onMetaChange={updateTaskMeta}
        onStatusChange={changeStatus}
        onAssigneeChange={changeAssignee}
        onDueChange={rescheduleTask}
      />
    )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* View toggles: Table (default) · Board · Calendar */}
        <div className="inline-flex rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1">
          <button onClick={showTable} className={toggleBtn(layout !== 'calendar' && leftMode === 'table')}>
            <Table2 size={15} /> Table
          </button>
          <button onClick={showBoard} className={toggleBtn(layout !== 'calendar' && leftMode === 'board')}>
            <LayoutGrid size={15} /> Board
          </button>
          <button onClick={showCalendar} className={toggleBtn(layout === 'calendar')}>
            <CalendarClock size={15} /> Calendar
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={calendarFilterLabel}
            onChange={setCalendarFilterLabel}
            options={CALENDAR_FILTERS}
            placeholder="Calendar: All"
          />
          <Button variant="secondary" onClick={() => setMeetingFormOpen(true)} disabled={!user}>
            <Video size={15} /> New Meeting
          </Button>
          <Button onClick={() => openCreate()}>
            <Plus size={16} /> Add Task
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border-card)] py-16 text-sm text-[var(--text-secondary)]">
          <Loader2 size={20} className="animate-spin" />
          Loading tasks…
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex h-[calc(100vh-210px)] min-h-[520px] w-full items-stretch overflow-hidden"
        >
          {/* Left pane: Table or Board */}
          <div
            className="min-w-0 overflow-auto pr-0.5"
            style={{ flexBasis: `${splitPct}%`, display: splitPct <= 0 ? 'none' : undefined }}
          >
            {leftPane}
          </div>

          {/* Draggable divider */}
          <div
            onMouseDown={onDividerDown}
            onDoubleClick={() => setSplitPct((p) => (p >= 98 ? 55 : 100))}
            title="Drag to resize · double-click to toggle split"
            className="group relative z-10 flex w-2 shrink-0 cursor-col-resize items-center justify-center"
          >
            <div className="h-16 w-1 rounded-full bg-[var(--border-card)] transition-colors group-hover:bg-[var(--accent-emerald)]" />
          </div>

          {/* Right pane: hour-grid Calendar */}
          <div
            className="min-w-0 overflow-hidden"
            style={{ flexBasis: `${100 - splitPct}%`, display: splitPct >= 100 ? 'none' : undefined }}
          >
            <TaskTimeCalendar
              day={calendarDay}
              onDayChange={setCalendarDay}
              tasks={tasks}
              meetings={meetings}
              filter={calendarFilter}
              onEditTask={openEdit}
              onAddTask={openCreate}
              onMeetingClick={setMeetingDetail}
            />
          </div>
        </div>
      )}

      <TaskFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        workspaceId={activeWorkspaceId}
        editingTask={editingTask}
        prefillDate={prefillDate}
        assigneeSuggestions={assigneeSuggestions}
        currentUserName={user?.name}
        onCreated={handleCreated}
        onUpdated={handleUpdated}
      />

      <MeetingFormModal
        open={meetingFormOpen}
        onClose={() => setMeetingFormOpen(false)}
        workspaceId={activeWorkspaceId}
        moderators={moderators}
        onCreated={handleMeetingCreated}
      />

      <MeetingDetailModal
        meeting={meetingDetail}
        onClose={() => setMeetingDetail(null)}
        onDelete={handleMeetingDelete}
      />
    </div>
  )
}
