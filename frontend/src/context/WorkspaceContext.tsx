import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { initialWorkspaces } from '../data/mockData'
import {
  buildLocalWorkspace,
  defaultIntegrations,
  disconnectIntegrationDb,
  fetchIntegrations,
  fetchWorkspaces,
  insertWorkspace,
  type NewWorkspaceInput,
} from '../lib/db'
import type { IntegrationKey, Workspace, WorkspaceId, WorkspaceIntegrations } from '../types'
import { computeQuota, getPlanOverride, type PlanTier } from '../lib/plan'

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
const LOCAL_WORKSPACES_KEY = 'catch:localWorkspaces'

interface WorkspaceContextValue {
  workspaces: Workspace[]
  workspacesLoading: boolean
  activeWorkspaceId: WorkspaceId
  setActiveWorkspaceId: (id: WorkspaceId) => void
  addWorkspace: (input: NewWorkspaceInput) => Promise<WorkspaceId>
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

function persistActiveId(id: WorkspaceId) {
  try {
    localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // localStorage unavailable — active workspace choice will not persist across reloads
  }
}

/** Extra guest workspaces (created via Onboarding while signed out) layered on
 * top of the built-in mock workspaces — never reach Supabase. */
function readLocalWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(LOCAL_WORKSPACES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Workspace[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persistLocalWorkspaces(list: Workspace[]) {
  try {
    localStorage.setItem(LOCAL_WORKSPACES_KEY, JSON.stringify(list))
  } catch {
    // localStorage unavailable — guest workspaces will not persist across reloads
  }
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  // dbWorkspaces backs signed-in users (fetched from Supabase); guestExtraWorkspaces
  // backs guests, layered on top of the seeded mock workspaces below.
  const [dbWorkspaces, setDbWorkspaces] = useState<Workspace[]>([])
  const [guestExtraWorkspaces, setGuestExtraWorkspaces] = useState<Workspace[]>(() => readLocalWorkspaces())
  // Which user id we've finished fetching workspaces for. `workspacesLoading` is
  // derived from this so it's true the instant `user` is set (before the fetch
  // effect even runs) — closing the race that briefly saw 0 workspaces and
  // bounced signed-in users to /onboarding on every fresh tab.
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<WorkspaceId>('')

  const [integrationsCache, setIntegrationsCache] = useState<Record<WorkspaceId, WorkspaceIntegrations>>({})
  const [integrationsLoading, setIntegrationsLoading] = useState(false)

  // No authenticated user → never touch Supabase. Render the seeded mock
  // workspaces (Arbitrum Foundation, KuCoin Exchange) plus any workspace the
  // guest created locally during Onboarding, so the dashboard always has
  // something to render instead of an empty list.
  const workspaces = useMemo(
    () => (user ? dbWorkspaces : [...initialWorkspaces, ...guestExtraWorkspaces]),
    [user, dbWorkspaces, guestExtraWorkspaces],
  )

  // A signed-in user is "loading" until we've fetched workspaces for THAT exact
  // user id. Guests are never loading.
  const workspacesLoading = user ? loadedForUser !== user.id : false

  // Workspaces belong to the signed-in owner — reload the list whenever the
  // authenticated user changes (login, logout, or session restore).
  useEffect(() => {
    if (!user) {
      setLoadedForUser(null)
      return
    }

    let cancelled = false
    fetchWorkspaces(user.id)
      .then((list) => {
        if (!cancelled) setDbWorkspaces(list)
      })
      .catch(() => {
        if (!cancelled) setDbWorkspaces([])
      })
      .finally(() => {
        if (!cancelled) setLoadedForUser(user.id)
      })

    return () => {
      cancelled = true
    }
  }, [user])

  // Resolve/clamp the active workspace id whenever the resolved list changes
  // — keeps the current selection if it's still valid, otherwise falls back
  // to the last stored id or the first workspace in the list.
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
    if (activeWorkspaceId) persistActiveId(activeWorkspaceId)
  }, [activeWorkspaceId])

  // Guest mode keeps its extra workspaces entirely in localStorage.
  useEffect(() => {
    persistLocalWorkspaces(guestExtraWorkspaces)
  }, [guestExtraWorkspaces])

  async function loadIntegrations(workspaceId: WorkspaceId) {
    setIntegrationsLoading(true)
    if (!user) {
      // Guest mode — never touch Supabase; every integration starts unconnected.
      setIntegrationsCache((prev) => ({ ...prev, [workspaceId]: defaultIntegrations() }))
      setIntegrationsLoading(false)
      return
    }
    try {
      const integrations = await fetchIntegrations(workspaceId)
      setIntegrationsCache((prev) => ({ ...prev, [workspaceId]: integrations }))
    } catch {
      setIntegrationsCache((prev) => ({ ...prev, [workspaceId]: defaultIntegrations() }))
    } finally {
      setIntegrationsLoading(false)
    }
  }

  useEffect(() => {
    if (activeWorkspaceId) void loadIntegrations(activeWorkspaceId)
    // loadIntegrations closes over `user`, which is already a dependency of
    // the effects above that drive activeWorkspaceId — re-running here on
    // activeWorkspaceId changes is sufficient.
  }, [activeWorkspaceId])

  function setActiveWorkspaceId(id: WorkspaceId) {
    setActiveWorkspaceIdState(id)
  }

  async function addWorkspace(input: NewWorkspaceInput): Promise<WorkspaceId> {
    if (!user) {
      // Guest session — skip Supabase entirely and keep the workspace local.
      // Guests aren't billed, so no quota enforcement here.
      const workspace = buildLocalWorkspace(input.name)
      setGuestExtraWorkspaces((prev) => [...prev, workspace])
      setActiveWorkspaceIdState(workspace.id)
      return workspace.id
    }

    // Plan quota gate: block creating a workspace past the tier limit.
    const tier: PlanTier = getPlanOverride() ?? user.plan ?? 'starter'
    const q = computeQuota('workspaces', dbWorkspaces.length, tier)
    if (q.status === 'reached') {
      throw new QuotaExceededError('workspaces', q.used, q.limit)
    }

    const workspace = await insertWorkspace(user.id, input)
    setDbWorkspaces((prev) => [...prev, workspace])
    setActiveWorkspaceIdState(workspace.id)
    return workspace.id
  }

  function getWorkspaceIntegrations(workspaceId: WorkspaceId): WorkspaceIntegrations {
    return integrationsCache[workspaceId] ?? defaultIntegrations()
  }

  async function refreshIntegrations(workspaceId: WorkspaceId): Promise<void> {
    await loadIntegrations(workspaceId)
  }

  async function disconnectIntegration(workspaceId: WorkspaceId, key: IntegrationKey): Promise<void> {
    if (!user) {
      // Guest mode — update the cached (never-persisted) state directly.
      setIntegrationsCache((prev) => ({
        ...prev,
        [workspaceId]: {
          ...(prev[workspaceId] ?? defaultIntegrations()),
          [key]: { status: 'Not Connected', fields: {}, mockData: {}, lastSync: null },
        },
      }))
      return
    }
    await disconnectIntegrationDb(workspaceId, key)
    await loadIntegrations(workspaceId)
  }

  const value = useMemo(
    () => ({
      workspaces,
      workspacesLoading,
      activeWorkspaceId,
      setActiveWorkspaceId,
      addWorkspace,
      getWorkspaceIntegrations,
      integrationsLoading,
      refreshIntegrations,
      disconnectIntegration,
    }),
    [workspaces, workspacesLoading, activeWorkspaceId, integrationsCache, integrationsLoading],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}
