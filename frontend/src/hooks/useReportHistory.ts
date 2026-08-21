import { useEffect, useState } from 'react'
import type { WorkspaceId } from '../types'
import type { ReportData } from '../lib/reportBuilder'

export interface ReportHistoryEntry {
  id: string
  data: ReportData
}

const HISTORY_KEY = 'catch:reportHistory'
const MAX_PER_WORKSPACE = 20

function readAll(): ReportHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ReportHistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(entries: ReportHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
  } catch {
    // ignore persistence failures
  }
}

export function useReportHistory(workspaceId: WorkspaceId) {
  const [entries, setEntries] = useState<ReportHistoryEntry[]>(() =>
    readAll().filter((e) => e.data.workspaceId === workspaceId),
  )

  // Workspace switched — reload this workspace's own history slice.
  useEffect(() => {
    setEntries(readAll().filter((e) => e.data.workspaceId === workspaceId))
  }, [workspaceId])

  function addEntry(data: ReportData) {
    const newEntry: ReportHistoryEntry = { id: `report-${Date.now()}`, data }
    const all = readAll()
    const forThisWorkspace = all.filter((e) => e.data.workspaceId === data.workspaceId)
    const others = all.filter((e) => e.data.workspaceId !== data.workspaceId)
    const updatedForWorkspace = [newEntry, ...forThisWorkspace].slice(0, MAX_PER_WORKSPACE)
    writeAll([...others, ...updatedForWorkspace])
    setEntries(updatedForWorkspace)
  }

  return { entries, addEntry }
}
