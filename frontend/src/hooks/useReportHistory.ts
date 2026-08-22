import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceId } from '../types'
import type { ReportData } from '../lib/reportBuilder'
import { fetchReportRuns, saveReportRun } from '../lib/api/misc'

export interface ReportHistoryEntry {
  id: string
  data: ReportData
}

// Generated reports are stored server-side (report_runs), so history follows
// the workspace instead of the browser.
export function useReportHistory(workspaceId: WorkspaceId) {
  const [entries, setEntries] = useState<ReportHistoryEntry[]>([])

  useEffect(() => {
    let cancelled = false
    if (!workspaceId) {
      setEntries([])
      return
    }
    fetchReportRuns<ReportData>(workspaceId)
      .then((runs) => !cancelled && setEntries(runs.map((r) => ({ id: r.id, data: r.data }))))
      .catch(() => !cancelled && setEntries([]))
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const addEntry = useCallback(
    (data: ReportData) => {
      const optimistic: ReportHistoryEntry = { id: `local-${Date.now()}`, data }
      setEntries((prev) => [optimistic, ...prev])
      const period = (d: ReportData) => {
        const any = d as unknown as { periodStart?: string; periodEnd?: string; range?: { start?: string; end?: string } }
        const start = any.periodStart ?? any.range?.start ?? new Date().toISOString()
        const end = any.periodEnd ?? any.range?.end ?? new Date().toISOString()
        return { start: start.slice(0, 10), end: end.slice(0, 10) }
      }
      const p = period(data)
      void saveReportRun(workspaceId, { reportType: String((data as unknown as { reportType?: string }).reportType ?? 'general'), periodStart: p.start, periodEnd: p.end, data: data as unknown as Record<string, unknown> })
        .then((run) => setEntries((prev) => prev.map((e) => (e.id === optimistic.id ? { id: run.id, data } : e))))
        .catch(() => undefined)
    },
    [workspaceId],
  )

  return { entries, addEntry }
}
