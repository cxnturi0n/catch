import { useEffect, useRef } from 'react'
import { API_URL } from '../lib/api/client'
import { useAuth } from '../context/AuthContext'
import type { WorkspaceId } from '../types'

// Coalesce bursts (a sync writes several tables at once) into one refetch.
const BURST_WINDOW_MS = 500

/**
 * Subscribes to the workspace's Server-Sent Events stream and calls
 * `onChange` when one of `tables` (topics) changes. Best-effort: the browser
 * reconnects on its own, and every consumer keeps its polling interval as
 * the floor, so a dropped stream only costs latency.
 */
export function useRealtimeTables(workspaceId: WorkspaceId | null | undefined, tables: readonly string[], onChange: () => void) {
  const { user } = useAuth()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const tablesKey = tables.join(',')

  useEffect(() => {
    if (!user || !workspaceId || tablesKey === '' || typeof EventSource === 'undefined') return
    const wanted = new Set(tablesKey.split(','))
    let timer: number | undefined
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        onChangeRef.current()
      }, BURST_WINDOW_MS)
    }
    const source = new EventSource(`${API_URL}/workspaces/${workspaceId}/events`, { withCredentials: true })
    source.addEventListener('change', (ev) => {
      try {
        const { topic } = JSON.parse((ev as MessageEvent).data) as { topic: string }
        if (wanted.has(topic)) schedule()
      } catch {
        /* ignore malformed event */
      }
    })
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      source.close()
    }
  }, [user, workspaceId, tablesKey])
}
