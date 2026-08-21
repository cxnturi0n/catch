import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { isApiError } from '../lib/api/client'
import {
  createWorkspace,
  defaultIntegrations,
  disconnectIntegration as disconnectIntegrationApi,
  fetchIntegrations,
  listWorkspaces,
  type NewWorkspaceInput,
  type QuotaState,
} from '../lib/api/workspaces'
import type { IntegrationKey, Workspace, WorkspaceId, WorkspaceIntegrations } from '../types'

export class QuotaExceededError extends Error {
  resource: 'workspaces' | 'moderators'
  used: number
  limit: number
  constructor(resource: 'workspaces' | 'moderators', used: number, limit: number) {
    super(`${resource} quota exceeded: ${used}/${limit}`)
    this.name = 'QuotaExceededError'
    this.resource = resource
    this.used = used
    this.limit = limit
  }
}

export type { NewWorkspaceInput }

const ACTIVE_KEY = 'catch:activeWorkspace'

export type WorkspaceView = Workspace & { role: string; platforms: string[] }

interface WorkspaceContextValue {
  workspaces: WorkspaceView[]
  workspacesLoading: boolean
  workspaceQuota: QuotaState | null
  activeWorkspaceId: WorkspaceId
  setActiveWorkspaceId: (id: WorkspaceId) => void
  addWorkspace: (input: NewWorkspaceInput) => Promise<WorkspaceId>
  reloadWorkspaces: () => Promise<void>
  getWorkspaceIntegrations: (workspaceId: WorkspaceId) => WorkspaceIntegrations
  integrationsLoading: boolean
  refreshIntegrations: (workspaceId: WorkspaceId) => Promise<void>
  disconnectIntegration: (workspaceId: WorkspaceId, key: IntegrationKey) => Promise<void>
}

function readStoredActiveId(): WorkspaceId | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

// Workspaces come from the API only. There is no guest mode: a signed-out user
// never reaches a consumer of this context (ProtectedRoute).
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([])
  const [workspaceQuota, setWorkspaceQuota] = useState<QuotaState | null>(null)
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<WorkspaceId>('')
  const [integrationsCache, setIntegrationsCache] = useState<Record<WorkspaceId, WorkspaceIntegrations>>({})
  const [integrationsLoading, setIntegrationsLoading] = useState(false)

  const workspacesLoading = user ? loadedForUser !== user.id : false

  const reloadWorkspaces = useCallback(async () => {
    if (!user) return
    try {
      const r = await listWorkspaces()
      setWorkspaces(r.workspaces)
      setWorkspaceQuota(r.quota)
    } catch {
      setWorkspaces([])
    }
  }, [user])

  useEffect(() => {
    if (!user) {
      setWorkspaces([])
      setLoadedForUser(null)
      return
    }
    let cancelled = false
    listWorkspaces()
      .then((r) => {
        if (cancelled) return
        setWorkspaces(r.workspaces)
        setWorkspaceQuota(r.quota)
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([])
      })
      .finally(() => {
        if (!cancelled) setLoadedForUser(user.id)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (workspaces.length === 0) {
      setActiveWorkspaceIdState('')
      return
    }
    setActiveWorkspaceIdState((prev) => {
      if (prev && workspaces.some((w) => w.id === prev)) return prev
      const stored = readStoredActiveId()
      return stored && workspaces.some((w) => w.id === stored) ? stored : workspaces[0].id
    })
  }, [workspaces])

  useEffect(() => {
    if (!activeWorkspaceId) return
    try {
      localStorage.setItem(ACTIVE_KEY, activeWorkspaceId)
    } catch {
      /* preference only */
    }
  }, [activeWorkspaceId])

  const loadIntegrations = useCallback(async (workspaceId: WorkspaceId) => {
    setIntegrationsLoading(true)
    try {
      const integrations = await fetchIntegrations(workspaceId)
      setIntegrationsCache((prev) => ({ ...prev, [workspaceId]: integrations }))
    } catch {
      setIntegrationsCache((prev) => ({ ...prev, [workspaceId]: defaultIntegrations() }))
    } finally {
      setIntegrationsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeWorkspaceId) void loadIntegrations(activeWorkspaceId)
  }, [activeWorkspaceId, loadIntegrations])

  async function addWorkspace(input: NewWorkspaceInput): Promise<WorkspaceId> {
    try {
      const ws = await createWorkspace(input)
      setWorkspaces((prev) => [...prev, ws])
      setActiveWorkspaceIdState(ws.id)
      void reloadWorkspaces()
      return ws.id
    } catch (err) {
      if (isApiError(err) && err.code === 'QUOTA_EXCEEDED') {
        const q = workspaceQuota
        throw new QuotaExceededError('workspaces', q?.used ?? 0, q?.limit ?? 0)
      }
      throw err
    }
  }

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      workspacesLoading,
      workspaceQuota,
      activeWorkspaceId,
      setActiveWorkspaceId: setActiveWorkspaceIdState,
      addWorkspace,
      reloadWorkspaces,
      getWorkspaceIntegrations: (id) => integrationsCache[id] ?? defaultIntegrations(),
      integrationsLoading,
      refreshIntegrations: loadIntegrations,
      disconnectIntegration: async (workspaceId, key) => {
        await disconnectIntegrationApi(workspaceId, key)
        await loadIntegrations(workspaceId)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, workspacesLoading, workspaceQuota, activeWorkspaceId, integrationsCache, integrationsLoading, reloadWorkspaces, loadIntegrations],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}
