// ============================================================================
// Moderator platform v2 (migration 016) — profile updates, CV upload,
// response/shift metrics, compensation configs, resources, content schedule,
// meetings, usage events. Kept out of the monolith db.ts to reduce merge risk
// while parallel agents build their features.
// ============================================================================

import { supabase } from './supabase'
import type {
  Resource,
  ResourceKind,
  ResourceVisibility,
  ResourceWithStats,
  UsageEvent,
  UsageEventType,
  UsageRollup,
  UsageUnit,
  WorkspaceId,
} from '../types'

// Moderator profile, CV, performance data and compensation configs now live
// behind the Catch API.
export {
  updateModeratorProfile,
  uploadModeratorCv,
  getCvSignedUrl,
  deleteModeratorCv,
  fetchResponseMetrics,
  fetchShiftEvents,
  fetchCompensationConfigs,
  upsertCompensationConfig,
  applyCompensationConfigToAll,
  type ModeratorProfileUpdate,
  type CompConfigUpsert,
} from './api/moderators'
export {
  fetchContentSchedule,
  insertContentScheduleItem,
  updateContentScheduleItem,
  deleteContentScheduleItem,
  fetchMeetings,
  insertMeeting,
  deleteMeeting,
  type NewContentInput,
  type NewMeetingInput,
} from './api/operations'


function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('No data returned from Supabase.')
  return result.data
}

// ── Resources drive (internal storage + external links + view log) ──

interface ResourceRow {
  id: string
  workspace_id: string
  kind: ResourceKind
  title: string
  description: string | null
  storage_path: string | null
  external_url: string | null
  mime_type: string | null
  size_bytes: number | null
  visibility: ResourceVisibility
  created_by: string | null
  created_at: string
  updated_at: string
}

function mapResource(r: ResourceRow): Resource {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    storagePath: r.storage_path,
    externalUrl: r.external_url,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    visibility: r.visibility,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function fetchResources(workspaceId: WorkspaceId): Promise<Resource[]> {
  const result = await supabase
    .from('resources')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  return unwrap<ResourceRow[]>(result).map(mapResource)
}

export async function fetchResourcesWithStats(workspaceId: WorkspaceId): Promise<ResourceWithStats[]> {
  const [resources, views] = await Promise.all([
    fetchResources(workspaceId),
    supabase
      .from('resource_views')
      .select('resource_id, viewer_moderator_id, viewer_user_id, viewer_label, viewed_at')
      .eq('workspace_id', workspaceId),
  ])
  const rows = (views.data ?? []) as Array<{
    resource_id: string
    viewer_moderator_id: string | null
    viewer_user_id: string | null
    viewer_label: string | null
    viewed_at: string
  }>
  const byResource = new Map<string, { count: number; last: string | null; viewers: Set<string> }>()
  for (const v of rows) {
    const bucket = byResource.get(v.resource_id) ?? { count: 0, last: null, viewers: new Set<string>() }
    bucket.count += 1
    bucket.last = !bucket.last || v.viewed_at > bucket.last ? v.viewed_at : bucket.last
    bucket.viewers.add(v.viewer_moderator_id ?? v.viewer_user_id ?? v.viewer_label ?? 'anon')
    byResource.set(v.resource_id, bucket)
  }
  return resources.map((r) => {
    const b = byResource.get(r.id)
    return { ...r, viewCount: b?.count ?? 0, lastViewedAt: b?.last ?? null, uniqueViewers: b?.viewers.size ?? 0 }
  })
}

export interface NewResourceInput {
  workspaceId: WorkspaceId
  kind: ResourceKind
  title: string
  description?: string | null
  storagePath?: string | null
  externalUrl?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  visibility?: ResourceVisibility
  createdBy?: string | null
}

export async function insertResource(input: NewResourceInput): Promise<Resource> {
  const row = {
    workspace_id: input.workspaceId,
    kind: input.kind,
    title: input.title,
    description: input.description ?? null,
    storage_path: input.storagePath ?? null,
    external_url: input.externalUrl ?? null,
    mime_type: input.mimeType ?? null,
    size_bytes: input.sizeBytes ?? null,
    visibility: input.visibility ?? 'team',
    created_by: input.createdBy ?? null,
  }
  const result = await supabase.from('resources').insert(row).select('*').single()
  return mapResource(unwrap<ResourceRow>(result))
}

export async function deleteResource(id: string, storagePath?: string | null): Promise<void> {
  if (storagePath) {
    await supabase.storage.from('resources').remove([storagePath])
  }
  const { error } = await supabase.from('resources').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function uploadResourceFile(
  workspaceId: WorkspaceId,
  file: File,
): Promise<{ path: string; sizeBytes: number; mimeType: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${workspaceId}/${Date.now()}_${safeName}`
  const { error } = await supabase.storage.from('resources').upload(path, file, {
    upsert: false,
    contentType: file.type,
  })
  if (error) throw new Error(error.message)
  return { path, sizeBytes: file.size, mimeType: file.type }
}

export async function getResourceSignedUrl(storagePath: string, expiresIn = 300): Promise<string> {
  const { data, error } = await supabase.storage.from('resources').createSignedUrl(storagePath, expiresIn)
  if (error || !data) throw new Error(error?.message ?? 'Failed to sign resource URL.')
  return data.signedUrl
}

export async function logResourceView(input: {
  resourceId: string
  workspaceId: WorkspaceId
  viewerUserId?: string | null
  viewerModeratorId?: string | null
  viewerLabel?: string | null
}): Promise<void> {
  const { error } = await supabase.from('resource_views').insert({
    resource_id: input.resourceId,
    workspace_id: input.workspaceId,
    viewer_user_id: input.viewerUserId ?? null,
    viewer_moderator_id: input.viewerModeratorId ?? null,
    viewer_label: input.viewerLabel ?? null,
  })
  if (error) throw new Error(error.message)
}

// ── Content schedule (CM-owned calendar items visible to moderators) ──





// ── Meetings (with calendar deep-link generation) ──




/**
 * Build a Google Calendar deep-link that pre-fills a new event; if the user
 * has Google Meet enabled by default (workspaces do), Google auto-attaches a
 * Meet link when they hit Save. No OAuth, no API call.
 * Docs: https://calendar.google.com/calendar/render?action=TEMPLATE
 */
export function buildGoogleCalendarUrl(m: {
  title: string
  description?: string | null
  startsAt: string
  endsAt: string
  attendeeEmails?: string[]
  meetLink?: string | null
}): string {
  const fmt = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: m.title,
    dates: `${fmt(m.startsAt)}/${fmt(m.endsAt)}`,
  })
  const desc = [m.description ?? '', m.meetLink ? `\nMeet: ${m.meetLink}` : ''].filter(Boolean).join('')
  if (desc) params.set('details', desc)
  if (m.attendeeEmails && m.attendeeEmails.length) params.set('add', m.attendeeEmails.join(','))
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** Outlook Live web deep-link — same shape, different host. */
export function buildOutlookCalendarUrl(m: {
  title: string
  description?: string | null
  startsAt: string
  endsAt: string
  attendeeEmails?: string[]
}): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: m.title,
    startdt: m.startsAt,
    enddt: m.endsAt,
    body: m.description ?? '',
  })
  if (m.attendeeEmails && m.attendeeEmails.length) params.set('to', m.attendeeEmails.join(','))
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

// ── Usage events ──

interface UsageRow {
  id: string
  workspace_id: string
  event_type: UsageEventType
  platform: string | null
  quantity: number
  unit: UsageUnit
  cost_hint_usd: number | null
  occurred_at: string
  metadata: unknown
}

function mapUsage(r: UsageRow): UsageEvent {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    eventType: r.event_type,
    platform: r.platform,
    quantity: Number(r.quantity),
    unit: r.unit,
    costHintUsd: r.cost_hint_usd,
    occurredAt: r.occurred_at,
    metadata: (typeof r.metadata === 'object' && r.metadata !== null ? r.metadata : {}) as Record<string, unknown>,
  }
}

export async function fetchUsageEvents(workspaceId: WorkspaceId, sinceDays = 30): Promise<UsageEvent[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
  const result = await supabase
    .from('usage_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
  return unwrap<UsageRow[]>(result).map(mapUsage)
}

export async function fetchUsageRollup(workspaceId: WorkspaceId, sinceDays = 30): Promise<UsageRollup[]> {
  const events = await fetchUsageEvents(workspaceId, sinceDays)
  const byType = new Map<UsageEventType, UsageRollup>()
  for (const e of events) {
    const cur = byType.get(e.eventType) ?? {
      eventType: e.eventType, totalQuantity: 0, totalCostUsd: 0, callCount: 0,
    }
    cur.totalQuantity += e.quantity
    cur.totalCostUsd += (e.costHintUsd ?? 0) * (e.quantity || 1)
    cur.callCount += 1
    byType.set(e.eventType, cur)
  }
  return Array.from(byType.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd)
}

export interface NewUsageInput {
  workspaceId: WorkspaceId
  eventType: UsageEventType
  platform?: string | null
  quantity?: number
  unit?: UsageUnit
  costHintUsd?: number | null
  metadata?: Record<string, unknown>
}

export async function logUsageEvent(input: NewUsageInput): Promise<void> {
  const { error } = await supabase.from('usage_events').insert({
    workspace_id: input.workspaceId,
    event_type: input.eventType,
    platform: input.platform ?? null,
    quantity: input.quantity ?? 1,
    unit: input.unit ?? 'call',
    cost_hint_usd: input.costHintUsd ?? null,
    metadata: input.metadata ?? {},
  })
  if (error) throw new Error(error.message)
}
