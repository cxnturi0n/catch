// ============================================================================
// Moderator platform v2 (migration 016) — profile updates, CV upload,
// response/shift metrics, compensation configs, resources, content schedule,
// meetings, usage events. Kept out of the monolith db.ts to reduce merge risk
// while parallel agents build their features.
// ============================================================================

import { supabase } from './supabase'
import type {
  CompCurrency,
  CompensationConfig,
  CompensationKind,
  ContentPlatform,
  ContentScheduleItem,
  ContentStatus,
  FixedPeriod,
  Meeting,
  MeetingProvider,
  ModeratorResponseMetric,
  ModeratorShiftEvent,
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

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('No data returned from Supabase.')
  return result.data
}

// ── Moderator profile updates (partial, safe against pre-016 schemas) ──

export interface ModeratorProfileUpdate {
  bio?: string | null
  skills?: string[]
  languages?: string[]
  platformsKnown?: string[]
  externalSource?: string | null
  profilePhotoUrl?: string | null
  cvStoragePath?: string | null
  cvFilename?: string | null
  cvExtractedText?: string | null
  shiftStartUtc?: number | null
  shiftEndUtc?: number | null
  shiftDays?: number[]
}

export async function updateModeratorProfile(id: string, update: ModeratorProfileUpdate): Promise<void> {
  const row: Record<string, unknown> = {}
  if (update.bio !== undefined) row.bio = update.bio
  if (update.skills !== undefined) row.skills = update.skills
  if (update.languages !== undefined) row.languages = update.languages
  if (update.platformsKnown !== undefined) row.platforms_known = update.platformsKnown
  if (update.externalSource !== undefined) row.external_source = update.externalSource
  if (update.profilePhotoUrl !== undefined) row.profile_photo_url = update.profilePhotoUrl
  if (update.cvStoragePath !== undefined) row.cv_storage_path = update.cvStoragePath
  if (update.cvFilename !== undefined) row.cv_filename = update.cvFilename
  if (update.cvExtractedText !== undefined) row.cv_extracted_text = update.cvExtractedText
  if (update.shiftStartUtc !== undefined) row.shift_start_utc = update.shiftStartUtc
  if (update.shiftEndUtc !== undefined) row.shift_end_utc = update.shiftEndUtc
  if (update.shiftDays !== undefined) row.shift_days = update.shiftDays
  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('moderators').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}

// ── CV upload to Storage bucket "cvs" ──
// Path convention: <workspaceId>/<moderatorId>/<timestamp>_<filename>

export async function uploadModeratorCv(
  workspaceId: WorkspaceId,
  moderatorId: string,
  file: File,
): Promise<{ path: string; filename: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${workspaceId}/${moderatorId}/${Date.now()}_${safeName}`
  const { error } = await supabase.storage.from('cvs').upload(path, file, { upsert: true, contentType: file.type })
  if (error) throw new Error(error.message)
  return { path, filename: file.name }
}

export async function getCvSignedUrl(storagePath: string, expiresIn = 300): Promise<string> {
  const { data, error } = await supabase.storage.from('cvs').createSignedUrl(storagePath, expiresIn)
  if (error || !data) throw new Error(error?.message ?? 'Failed to sign CV URL.')
  return data.signedUrl
}

export async function deleteModeratorCv(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from('cvs').remove([storagePath])
  if (error) throw new Error(error.message)
}

// ── Response metrics + shift events ──

interface ResponseMetricRow {
  moderator_id: string
  platform: string
  day: string
  responses_count: number
  avg_response_seconds: number | null
}

export async function fetchResponseMetrics(
  workspaceId: WorkspaceId,
  sinceDays = 30,
  moderatorId?: string,
): Promise<ModeratorResponseMetric[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)
  let q = supabase
    .from('moderator_response_metrics')
    .select('moderator_id, platform, day, responses_count, avg_response_seconds')
    .eq('workspace_id', workspaceId)
    .gte('day', since)
    .order('day', { ascending: false })
  if (moderatorId) q = q.eq('moderator_id', moderatorId)
  const result = await q
  return unwrap<ResponseMetricRow[]>(result).map((r) => ({
    moderatorId: r.moderator_id,
    platform: r.platform as ModeratorResponseMetric['platform'],
    day: r.day,
    responsesCount: r.responses_count,
    avgResponseSeconds: r.avg_response_seconds,
  }))
}

interface ShiftEventRow {
  moderator_id: string
  day: string
  expected_start_utc: string
  expected_end_utc: string
  first_activity_utc: string | null
  was_on_time: boolean | null
}

export async function fetchShiftEvents(
  workspaceId: WorkspaceId,
  sinceDays = 30,
  moderatorId?: string,
): Promise<ModeratorShiftEvent[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)
  let q = supabase
    .from('moderator_shift_events')
    .select('moderator_id, day, expected_start_utc, expected_end_utc, first_activity_utc, was_on_time')
    .eq('workspace_id', workspaceId)
    .gte('day', since)
    .order('day', { ascending: false })
  if (moderatorId) q = q.eq('moderator_id', moderatorId)
  const result = await q
  return unwrap<ShiftEventRow[]>(result).map((r) => ({
    moderatorId: r.moderator_id,
    day: r.day,
    expectedStartUtc: r.expected_start_utc,
    expectedEndUtc: r.expected_end_utc,
    firstActivityUtc: r.first_activity_utc,
    wasOnTime: r.was_on_time,
  }))
}

// ── Compensation configs (fixed / variable / both, apply-to-all) ──

interface CompConfigRow {
  moderator_id: string
  workspace_id: string
  kind: CompensationKind
  fixed_amount: number | null
  fixed_currency: string | null
  fixed_period: string | null
  variable_notes: string | null
  updated_at: string
}

function mapCompConfig(r: CompConfigRow): CompensationConfig {
  return {
    moderatorId: r.moderator_id,
    workspaceId: r.workspace_id,
    kind: r.kind,
    fixedAmount: r.fixed_amount,
    fixedCurrency: (r.fixed_currency ?? null) as CompCurrency | null,
    fixedPeriod: (r.fixed_period ?? null) as FixedPeriod | null,
    variableNotes: r.variable_notes,
    updatedAt: r.updated_at,
  }
}

export async function fetchCompensationConfigs(workspaceId: WorkspaceId): Promise<CompensationConfig[]> {
  const result = await supabase
    .from('compensation_configs')
    .select('*')
    .eq('workspace_id', workspaceId)
  return unwrap<CompConfigRow[]>(result).map(mapCompConfig)
}

export interface CompConfigUpsert {
  moderatorId: string
  workspaceId: WorkspaceId
  kind: CompensationKind
  fixedAmount?: number | null
  fixedCurrency?: CompCurrency | null
  fixedPeriod?: FixedPeriod | null
  variableNotes?: string | null
}

export async function upsertCompensationConfig(input: CompConfigUpsert): Promise<CompensationConfig> {
  const row = {
    moderator_id: input.moderatorId,
    workspace_id: input.workspaceId,
    kind: input.kind,
    fixed_amount: input.fixedAmount ?? null,
    fixed_currency: input.fixedCurrency ?? null,
    fixed_period: input.fixedPeriod ?? null,
    variable_notes: input.variableNotes ?? null,
    updated_at: new Date().toISOString(),
  }
  const result = await supabase
    .from('compensation_configs')
    .upsert(row, { onConflict: 'moderator_id' })
    .select('*')
    .single()
  return mapCompConfig(unwrap<CompConfigRow>(result))
}

/** Bulk apply the same config shape to every moderator id passed in. */
export async function applyCompensationConfigToAll(
  workspaceId: WorkspaceId,
  moderatorIds: string[],
  base: Omit<CompConfigUpsert, 'moderatorId' | 'workspaceId'>,
): Promise<void> {
  if (moderatorIds.length === 0) return
  const now = new Date().toISOString()
  const rows = moderatorIds.map((mid) => ({
    moderator_id: mid,
    workspace_id: workspaceId,
    kind: base.kind,
    fixed_amount: base.fixedAmount ?? null,
    fixed_currency: base.fixedCurrency ?? null,
    fixed_period: base.fixedPeriod ?? null,
    variable_notes: base.variableNotes ?? null,
    updated_at: now,
  }))
  const { error } = await supabase.from('compensation_configs').upsert(rows, { onConflict: 'moderator_id' })
  if (error) throw new Error(error.message)
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

interface ContentRow {
  id: string
  workspace_id: string
  title: string
  description: string | null
  platform: ContentPlatform | null
  scheduled_at: string
  published_at: string | null
  status: ContentStatus
  owner_user_id: string | null
  assigned_moderator_id: string | null
  notes: string | null
  attachments: unknown
  created_at: string
  updated_at: string
}

function mapContent(r: ContentRow): ContentScheduleItem {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    description: r.description,
    platform: r.platform,
    scheduledAt: r.scheduled_at,
    publishedAt: r.published_at,
    status: r.status,
    ownerUserId: r.owner_user_id,
    assignedModeratorId: r.assigned_moderator_id,
    notes: r.notes,
    attachments: Array.isArray(r.attachments) ? (r.attachments as ContentScheduleItem['attachments']) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function fetchContentSchedule(workspaceId: WorkspaceId, sinceDays = 60): Promise<ContentScheduleItem[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
  const result = await supabase
    .from('content_schedule')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('scheduled_at', since)
    .order('scheduled_at', { ascending: true })
  return unwrap<ContentRow[]>(result).map(mapContent)
}

export interface NewContentInput {
  workspaceId: WorkspaceId
  title: string
  description?: string | null
  platform?: ContentPlatform | null
  scheduledAt: string
  ownerUserId?: string | null
  assignedModeratorId?: string | null
  notes?: string | null
  attachments?: ContentScheduleItem['attachments']
}

export async function insertContentScheduleItem(input: NewContentInput): Promise<ContentScheduleItem> {
  const row = {
    workspace_id: input.workspaceId,
    title: input.title,
    description: input.description ?? null,
    platform: input.platform ?? null,
    scheduled_at: input.scheduledAt,
    owner_user_id: input.ownerUserId ?? null,
    assigned_moderator_id: input.assignedModeratorId ?? null,
    notes: input.notes ?? null,
    attachments: input.attachments ?? [],
  }
  const result = await supabase.from('content_schedule').insert(row).select('*').single()
  return mapContent(unwrap<ContentRow>(result))
}

export async function updateContentScheduleItem(
  id: string,
  patch: Partial<Omit<ContentScheduleItem, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title
  if (patch.description !== undefined) row.description = patch.description
  if (patch.platform !== undefined) row.platform = patch.platform
  if (patch.scheduledAt !== undefined) row.scheduled_at = patch.scheduledAt
  if (patch.publishedAt !== undefined) row.published_at = patch.publishedAt
  if (patch.status !== undefined) row.status = patch.status
  if (patch.ownerUserId !== undefined) row.owner_user_id = patch.ownerUserId
  if (patch.assignedModeratorId !== undefined) row.assigned_moderator_id = patch.assignedModeratorId
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.attachments !== undefined) row.attachments = patch.attachments
  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('content_schedule').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteContentScheduleItem(id: string): Promise<void> {
  const { error } = await supabase.from('content_schedule').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Meetings (with calendar deep-link generation) ──

interface MeetingRow {
  id: string
  workspace_id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string
  meet_link: string | null
  attendee_emails: string[] | null
  attendee_moderator_ids: string[] | null
  provider: MeetingProvider
  created_by: string | null
  created_at: string
  updated_at: string
}

function mapMeeting(r: MeetingRow): Meeting {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    description: r.description,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    meetLink: r.meet_link,
    attendeeEmails: r.attendee_emails ?? [],
    attendeeModeratorIds: r.attendee_moderator_ids ?? [],
    provider: r.provider,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function fetchMeetings(workspaceId: WorkspaceId, sinceDays = 30): Promise<Meeting[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
  const result = await supabase
    .from('meetings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('starts_at', since)
    .order('starts_at', { ascending: true })
  return unwrap<MeetingRow[]>(result).map(mapMeeting)
}

export interface NewMeetingInput {
  workspaceId: WorkspaceId
  title: string
  description?: string | null
  startsAt: string
  endsAt: string
  meetLink?: string | null
  attendeeEmails?: string[]
  attendeeModeratorIds?: string[]
  provider?: MeetingProvider
  createdBy?: string | null
}

export async function insertMeeting(input: NewMeetingInput): Promise<Meeting> {
  const row = {
    workspace_id: input.workspaceId,
    title: input.title,
    description: input.description ?? null,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    meet_link: input.meetLink ?? null,
    attendee_emails: input.attendeeEmails ?? [],
    attendee_moderator_ids: input.attendeeModeratorIds ?? [],
    provider: input.provider ?? 'google',
    created_by: input.createdBy ?? null,
  }
  const result = await supabase.from('meetings').insert(row).select('*').single()
  return mapMeeting(unwrap<MeetingRow>(result))
}

export async function deleteMeeting(id: string): Promise<void> {
  const { error } = await supabase.from('meetings').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

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
