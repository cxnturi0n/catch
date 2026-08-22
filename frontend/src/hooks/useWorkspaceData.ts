import { useEffect, useState } from 'react'
import type { WorkspaceId } from '../types'

/**
 * Loads a module's rows for the active workspace through the API. The seeder
 * is kept for demo accounts only: real workspaces start empty.
 */
export function useWorkspaceData<T>(
  workspaceId: WorkspaceId,
  fetcher: (workspaceId: WorkspaceId) => Promise<T[]>,
  seeder: (workspaceId: WorkspaceId, seedRows: T[]) => Promise<T[]>,
  getSeedRows: (workspaceId: WorkspaceId) => T[],
  hasUser: boolean,
) {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      if (!hasUser) {
        if (!cancelled) {
          setData(getSeedRows(workspaceId))
          setLoading(false)
        }
        return
      }

      try {
        const rows = await fetcher(workspaceId)
        if (cancelled) return
        if (rows.length === 0) {
          const seedRows = getSeedRows(workspaceId)
          const seeded = seedRows.length > 0 ? await seeder(workspaceId, seedRows) : []
          if (!cancelled) setData(seeded)
        } else {
          setData(rows)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data.')
          setData([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // fetcher/seeder/getSeedRows are stable module-level function references;
    // only workspaceId/hasUser should trigger a reload.
  }, [workspaceId, hasUser])

  return { data, setData, loading, error }
}
