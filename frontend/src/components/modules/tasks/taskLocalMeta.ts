import { useCallback, useEffect, useState } from 'react'

// Tasks in the DB only carry title/assignee/priority/status/due_date. The Task
// Manager table also surfaces an "Area" grouping and a "Start date", neither of
// which exist as columns and which we cannot add (db.ts is off-limits). We keep
// them client-side, persisted in localStorage keyed per workspace + task id.

export interface TaskMeta {
  area?: string
  start?: string // 'YYYY-MM-DD'
}

export type TaskMetaMap = Record<string, TaskMeta>

function storageKeyFor(workspaceId: string | undefined): string | null {
  return workspaceId ? `catch:taskmeta:${workspaceId}` : null
}

/** Client-side, per-workspace store for the table's Area + Start date columns. */
export function useLocalTaskMeta(workspaceId: string | undefined) {
  const storageKey = storageKeyFor(workspaceId)
  const [map, setMap] = useState<TaskMetaMap>({})

  useEffect(() => {
    if (!storageKey) {
      setMap({})
      return
    }
    try {
      const raw = localStorage.getItem(storageKey)
      setMap(raw ? (JSON.parse(raw) as TaskMetaMap) : {})
    } catch {
      setMap({})
    }
  }, [storageKey])

  const update = useCallback(
    (id: string, patch: Partial<TaskMeta>) => {
      setMap((prev) => {
        const merged: TaskMeta = { ...prev[id], ...patch }
        // Drop empty strings so cleared cells fall back to the em-dash default.
        if (!merged.area) delete merged.area
        if (!merged.start) delete merged.start
        const next: TaskMetaMap = { ...prev, [id]: merged }
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(next))
          } catch {
            /* quota / private mode — ignore, stay in-memory */
          }
        }
        return next
      })
    },
    [storageKey],
  )

  return { map, update }
}
