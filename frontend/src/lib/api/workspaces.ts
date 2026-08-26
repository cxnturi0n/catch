import { api } from './client'
import { toWorkspace, type ApiWorkspace } from '../workspaceView'
import type { IntegrationHealth, IntegrationKey, WorkspaceIntegrations } from '../../types'

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
  health?: IntegrationHealth
}

// Metadata keys that are state for the health block, not facts to list on the card.
const HIDDEN_METADATA = new Set(['backfill', 'admins', 'webhook', 'webhook_checked_at', 'webhook_last_error', 'audit_log', 'chat_numeric_id', 'bot_id', 'privacy_mode', 'bot_is_admin', 'icon', 'demo'])

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
      status: i.status === 'connected' ? 'Connected' : i.status === 'error' ? 'Error' : 'Not Connected',
      fields: {},
      mockData: Object.fromEntries(Object.entries(i.metadata).filter(([k, v]) => !HIDDEN_METADATA.has(k) && (typeof v === 'string' || typeof v === 'number'))) as Record<string, string | number>,
      lastSync: i.lastSync,
      lastError: i.lastError,
      health: i.health ?? {},
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

export interface ProfileRow {
  timezone: string | null
  layout_prompt_seen_at: string | null
  onboarded_at: string | null
}

/** Profile extras (timezone, onboarding flags) from GET /me. */
export async function getProfile(_userId: string): Promise<ProfileRow | null> {
  const me = await api<{ profile: { timezone: string | null; layoutPromptSeenAt: string | null; onboardedAt: string | null } | null }>('/me')
  if (!me.profile) return null
  return { timezone: me.profile.timezone, layout_prompt_seen_at: me.profile.layoutPromptSeenAt, onboarded_at: me.profile.onboardedAt }
}

export async function updateProfileTimezone(_userId: string, timezone: string): Promise<void> {
  await updateProfile({ timezone })
}

export async function markLayoutPromptSeen(_userId: string): Promise<void> {
  await updateProfile({ layoutPromptSeen: true })
}
