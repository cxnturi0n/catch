import { api } from './client'
import { toWorkspace, type ApiWorkspace } from '../workspaceView'
import type { IntegrationKey, WorkspaceIntegrations } from '../../types'

export interface QuotaState {
  resource: string
  used: number
  limit: number
  remaining: number
  reached: boolean
}

export interface NewWorkspaceInput {
  name: string
  projectType?: string | null
  communitySize?: string | null
  platforms?: string[]
}

export async function listWorkspaces() {
  const r = await api<{ workspaces: ApiWorkspace[]; quota: QuotaState }>('/workspaces')
  return { workspaces: r.workspaces.map(toWorkspace), quota: r.quota }
}

export async function createWorkspace(input: NewWorkspaceInput) {
  return toWorkspace(await api<ApiWorkspace>('/workspaces', { method: 'POST', body: input }))
}

export function deleteWorkspace(id: string) {
  return api<void>(`/workspaces/${id}`, { method: 'DELETE' })
}

interface ApiIntegration {
  platform: 'discord' | 'telegram' | 'galxe' | 'zealy'
  status: 'disconnected' | 'connected' | 'error'
  metadata: Record<string, unknown>
  lastSync: string | null
  lastError: string | null
}

export function defaultIntegrations(): WorkspaceIntegrations {
  const off = () => ({ status: 'Not Connected' as const, fields: {}, mockData: {}, lastSync: null })
  const soon = () => ({ status: 'Coming Soon' as const, fields: {}, mockData: {}, lastSync: null })
  return { discord: off(), telegram: off(), zealy: off(), galxe: off(), snapshot: off(), twitter: soon(), twitch: soon(), youtube: soon(), kick: soon() }
}

export async function fetchIntegrations(workspaceId: string): Promise<WorkspaceIntegrations> {
  const r = await api<{ integrations: ApiIntegration[] }>(`/workspaces/${workspaceId}/integrations`)
  const out = defaultIntegrations()
  for (const i of r.integrations) {
    out[i.platform] = {
      status: i.status === 'connected' ? 'Connected' : 'Not Connected',
      fields: {},
      mockData: Object.fromEntries(Object.entries(i.metadata).filter(([, v]) => typeof v === 'string' || typeof v === 'number')) as Record<string, string | number>,
      lastSync: i.lastSync,
    }
  }
  return out
}

export function disconnectIntegration(workspaceId: string, key: IntegrationKey) {
  return api<void>(`/workspaces/${workspaceId}/integrations/${key}`, { method: 'DELETE' })
}

export interface ProfilePatch {
  jobRole?: string | null
  managesMultiple?: boolean | null
  communitySize?: string | null
  primaryPlatforms?: string[]
  timezone?: string | null
  onboarded?: boolean
  layoutPromptSeen?: boolean
}

export function updateProfile(patch: ProfilePatch) {
  return api<{ ok: true }>('/me/profile', { method: 'PATCH', body: patch })
}
