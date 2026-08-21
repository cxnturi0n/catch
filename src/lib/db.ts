import { supabase } from './supabase'
import { initials as initialsOf } from '../data/moderatorsData'
import type {
  CatchTask,
  CompCurrency,
  ConversionConfig,
  FeedbackCategory,
  FeedbackEntry,
  FeedbackRole,
  IntegrationConnection,
  IntegrationKey,
  KOL,
  Moderator,
  ModeratorMetricValue,
  ModerationIncident,
  NewFeedbackInput,
  NewPaymentInput,
  Payment,
  PointsMetric,
  TaskPriority,
  TaskStatus,
  TrendPoint,
  Warning,
  Workspace,
  WorkspaceId,
  WorkspaceIntegrations,
} from '../types'

// ── Shared helpers ──

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('No data returned from Supabase.')
  return result.data
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// ── Profiles ──

export interface ProfileRow {
  id: string
  full_name: string | null
  email: string | null
  plan: string | null
  timezone: string | null
  /** Set the first (and only) time the "Build your layout" prompt is shown. Requires migration 024. */
  layout_prompt_seen_at?: string | null
  created_at: string
  updated_at: string
}

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return data as ProfileRow | null
}

export async function updateProfileName(userId: string, fullName: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', userId)
  if (error) throw new Error(error.message)
}

/** Persist the account's display timezone (IANA id). Requires migration 020. */
export async function updateProfileTimezone(userId: string, timezone: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ timezone }).eq('id', userId)
  if (error) throw new Error(error.message)
}

/**
 * Stamp the one-shot "Build your layout" prompt as seen. Best-effort by design:
 * the localStorage flag already covers this device, so a missing column (pre-024)
 * or an offline write must never block the user. Requires migration 024 to make
 * the "never again" promise hold across devices.
 */
export async function markLayoutPromptSeen(userId: string): Promise<void> {
  await supabase.from('profiles').update({ layout_prompt_seen_at: new Date().toISOString() }).eq('id', userId)
}

export interface OnboardingProfile {
  role: string
  managesMultiple: boolean
  communitySize: string
  primaryPlatforms: string[]
}

/**
 * Persists the onboarding answers onto the user's profile row (the "who is
 * using Catch" signal). Best-effort: requires migration 003 to have added the
 * columns — callers should not block onboarding completion on this succeeding.
 */
export async function saveOnboardingProfile(userId: string, input: OnboardingProfile): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      role: input.role,
      manages_multiple: input.managesMultiple,
      community_size: input.communitySize,
      primary_platforms: input.primaryPlatforms,
      onboarded_at: new Date().toISOString(),
    })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}

// ── Workspaces ──

interface WorkspaceRow {
  id: string
  owner_id: string
  name: string
  project_type: string | null
  community_size: string | null
  platforms: string[] | null
  created_at: string
  updated_at: string
}

const COLOR_PAIRS: [string, string][] = [
  ['#7c3aed', '#06b6d4'],
  ['#06b6d4', '#10b981'],
  ['#10b981', '#7c3aed'],
  ['#7c3aed', '#10b981'],
]

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function shortNameFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'NW'
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  const [colorFrom, colorTo] = COLOR_PAIRS[hashString(row.id) % COLOR_PAIRS.length]
  return {
    id: row.id,
    name: row.name,
    shortName: shortNameFor(row.name),
    colorFrom,
    colorTo,
  }
}

export interface NewWorkspaceInput {
  name: string
  projectType: string
  /** Optional: the quick "add workspace" form no longer asks — the user tells
   *  Catch Intelligence in chat instead. Onboarding still collects it. */
  communitySize?: string
  platforms: string[]
}

export async function fetchWorkspaces(ownerId: string): Promise<Workspace[]> {
  const result = await supabase
    .from('workspaces')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: true })
  const rows = unwrap<WorkspaceRow[]>(result)
  return rows.map(mapWorkspace)
}

export async function insertWorkspace(ownerId: string, input: NewWorkspaceInput): Promise<Workspace> {
  const result = await supabase
    .from('workspaces')
    .insert({
      owner_id: ownerId,
      name: input.name,
      project_type: input.projectType,
      community_size: input.communitySize ?? null,
      platforms: input.platforms,
    })
    .select('*')
    .single()
  const row = unwrap<WorkspaceRow>(result)
  return mapWorkspace(row)
}

/** Builds a workspace that never touches Supabase — used for guest sessions
 * with no authenticated user, where the workspace instead lives in localStorage. */
export function buildLocalWorkspace(name: string): Workspace {
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return mapWorkspace({
    id,
    owner_id: '',
    name,
    project_type: null,
    community_size: null,
    platforms: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
}

// ── Integrations ──

interface IntegrationRow {
  id: string
  workspace_id: string
  platform: string
  status: string
  credentials: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  last_sync: string | null
  created_at: string
  updated_at: string
}

export function defaultIntegrations(): WorkspaceIntegrations {
  return {
    discord: { status: 'Not Connected', fields: {}, mockData: {}, lastSync: null },
    telegram: { status: 'Not Connected', fields: {}, mockData: {}, lastSync: null },
    twitter: { status: 'Coming Soon', fields: {}, mockData: {}, lastSync: null },
    zealy: { status: 'Not Connected', fields: {}, mockData: {}, lastSync: null },
    galxe: { status: 'Not Connected', fields: {}, mockData: {}, lastSync: null },
    snapshot: { status: 'Not Connected', fields: {}, mockData: {}, lastSync: null },
    twitch: { status: 'Coming Soon', fields: {}, mockData: {}, lastSync: null },
    youtube: { status: 'Coming Soon', fields: {}, mockData: {}, lastSync: null },
    kick: { status: 'Coming Soon', fields: {}, mockData: {}, lastSync: null },
  }
}

function mapIntegrationRow(row: IntegrationRow): IntegrationConnection {
  const fields: Record<string, string> = {}
  for (const [k, v] of Object.entries(row.credentials ?? {})) fields[k] = String(v)

  const mockData: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(row.metadata ?? {})) {
    mockData[humanizeKey(k)] = typeof v === 'number' ? v : String(v)
  }

  return {
    status: row.status === 'connected' ? 'Connected' : 'Not Connected',
    fields,
    mockData,
    lastSync: row.last_sync,
  }
}

export async function fetchIntegrations(workspaceId: WorkspaceId): Promise<WorkspaceIntegrations> {
  const result = await supabase.from('integrations').select('*').eq('workspace_id', workspaceId)
  const rows = unwrap<IntegrationRow[]>(result)
  const integrations = defaultIntegrations()
  for (const row of rows) {
    const key = row.platform as IntegrationKey
    if (key === 'twitter') continue // Twitter/X stays "Coming Soon" until the integration ships
    if (key === 'twitch' || key === 'youtube' || key === 'kick') continue // streaming platforms stay "Coming Soon" until integrations ship
    if (key in integrations) integrations[key] = mapIntegrationRow(row)
  }
  return integrations
}

export async function disconnectIntegrationDb(workspaceId: WorkspaceId, key: IntegrationKey): Promise<void> {
  const { error } = await supabase
    .from('integrations')
    .upsert(
      { workspace_id: workspaceId, platform: key, status: 'disconnected', credentials: {}, metadata: {}, last_sync: null },
      { onConflict: 'workspace_id,platform' },
    )
  if (error) throw new Error(error.message)
}

// ── Platform metrics ──

interface PlatformMetricRow {
  id: string
  workspace_id: string
  platform: string
  date: string
  metrics: Record<string, number>
  created_at: string
}

export interface LiveMetrics {
  trend: TrendPoint[]
  latestMembers: number | null
  latestBans7d: number | null
}

export async function fetchPlatformMetrics(
  workspaceId: WorkspaceId,
  platforms: IntegrationKey[],
  days: number,
): Promise<LiveMetrics | null> {
  if (platforms.length === 0) return null
  const since = new Date()
  since.setDate(since.getDate() - days)
  const result = await supabase
    .from('platform_metrics')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('platform', platforms)
    .gte('date', since.toISOString().slice(0, 10))
    .order('date', { ascending: true })
  const rows = unwrap<PlatformMetricRow[]>(result)
  if (rows.length === 0) return null

  const byDate = new Map<string, number>()
  for (const row of rows) {
    const members = typeof row.metrics.members === 'number' ? row.metrics.members : 0
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + members)
  }
  const trend: TrendPoint[] = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }))

  const latestByPlatform = new Map<string, PlatformMetricRow>()
  for (const row of rows) {
    const current = latestByPlatform.get(row.platform)
    if (!current || row.date > current.date) latestByPlatform.set(row.platform, row)
  }
  let latestMembers = 0
  let latestBans7d = 0
  let hasBans = false
  for (const row of latestByPlatform.values()) {
    if (typeof row.metrics.members === 'number') latestMembers += row.metrics.members
    if (typeof row.metrics.bans_7d === 'number') {
      latestBans7d += row.metrics.bans_7d
      hasBans = true
    }
  }

  return { trend, latestMembers, latestBans7d: hasBans ? latestBans7d : null }
}

/** Raw daily rollup rows (metrics jsonb intact) so callers can read ANY metric
 * key per platform — the capability matrix drives which keys it reads. */
export interface PlatformMetricDay {
  platform: string
  date: string
  metrics: Record<string, number>
}

export async function fetchPlatformMetricRows(
  workspaceId: WorkspaceId,
  platforms: IntegrationKey[],
  days: number,
): Promise<PlatformMetricDay[]> {
  if (platforms.length === 0) return []
  const since = new Date()
  since.setDate(since.getDate() - days)
  const result = await supabase
    .from('platform_metrics')
    .select('platform, date, metrics')
    .eq('workspace_id', workspaceId)
    .in('platform', platforms)
    .gte('date', since.toISOString().slice(0, 10))
    .order('date', { ascending: true })
  return unwrap<{ platform: string; date: string; metrics: Record<string, number> }[]>(result).map((r) => ({
    platform: r.platform,
    date: r.date,
    metrics: r.metrics ?? {},
  }))
}

/** Telegram messages rolled up to a per-day total time series (member_messages
 * is per-member/day; this sums members to a single daily volume trend). */
export async function fetchMemberMessageTrend(workspaceId: WorkspaceId, sinceDays = 30): Promise<TrendPoint[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)
  const result = await supabase
    .from('member_messages')
    .select('day, message_count')
    .eq('workspace_id', workspaceId)
    .eq('platform', 'telegram')
    .gte('day', since)
  const rows = unwrap<{ day: string; message_count: number }[]>(result)
  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.message_count))
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }))
}

// ── Incidents ──

interface IncidentRow {
  id: string
  workspace_id: string
  date: string
  type: string
  channel: string
  action_taken: string | null
  status: string | null
  created_at: string
}

function mapIncident(row: IncidentRow): ModerationIncident {
  return {
    id: row.id,
    date: row.date,
    type: row.type as ModerationIncident['type'],
    channel: row.channel as ModerationIncident['channel'],
    actionTaken: row.action_taken ?? '',
    status: (row.status ?? 'Open') as ModerationIncident['status'],
  }
}

export async function fetchIncidents(workspaceId: WorkspaceId): Promise<ModerationIncident[]> {
  const result = await supabase.from('incidents').select('*').eq('workspace_id', workspaceId).order('date', { ascending: false })
  return unwrap<IncidentRow[]>(result).map(mapIncident)
}

export async function addIncident(workspaceId: WorkspaceId, data: Omit<ModerationIncident, 'id'>): Promise<ModerationIncident> {
  const result = await supabase
    .from('incidents')
    .insert({
      workspace_id: workspaceId,
      date: data.date,
      type: data.type,
      channel: data.channel,
      action_taken: data.actionTaken,
      status: data.status,
    })
    .select('*')
    .single()
  return mapIncident(unwrap<IncidentRow>(result))
}

export async function seedIncidents(workspaceId: WorkspaceId, incidents: ModerationIncident[]): Promise<ModerationIncident[]> {
  if (incidents.length === 0) return []
  const result = await supabase
    .from('incidents')
    .insert(
      incidents.map((i) => ({
        workspace_id: workspaceId,
        date: i.date,
        type: i.type,
        channel: i.channel,
        action_taken: i.actionTaken,
        status: i.status,
      })),
    )
    .select('*')
  return unwrap<IncidentRow[]>(result).map(mapIncident)
}

// ── KOLs ──

interface KolRow {
  id: string
  workspace_id: string
  name: string
  handle: string | null
  channel: string | null
  reach: number | null
  status: string | null
  last_activity: string | null
  notes: string | null
  created_at: string
}

function mapKol(row: KolRow): KOL {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle ?? '',
    channel: (row.channel ?? 'Twitter') as KOL['channel'],
    reach: row.reach ?? 0,
    status: (row.status ?? 'Pending') as KOL['status'],
    lastActivity: row.last_activity ?? row.created_at.slice(0, 10),
    notes: row.notes ?? '',
  }
}

export async function fetchKOLs(workspaceId: WorkspaceId): Promise<KOL[]> {
  const result = await supabase.from('kols').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false })
  return unwrap<KolRow[]>(result).map(mapKol)
}

export async function addKOL(workspaceId: WorkspaceId, data: Omit<KOL, 'id'>): Promise<KOL> {
  const result = await supabase
    .from('kols')
    .insert({
      workspace_id: workspaceId,
      name: data.name,
      handle: data.handle,
      channel: data.channel,
      reach: data.reach,
      status: data.status,
      last_activity: data.lastActivity,
      notes: data.notes,
    })
    .select('*')
    .single()
  return mapKol(unwrap<KolRow>(result))
}

export async function seedKOLs(workspaceId: WorkspaceId, kols: KOL[]): Promise<KOL[]> {
  if (kols.length === 0) return []
  const result = await supabase
    .from('kols')
    .insert(
      kols.map((k) => ({
        workspace_id: workspaceId,
        name: k.name,
        handle: k.handle,
        channel: k.channel,
        reach: k.reach,
        status: k.status,
        last_activity: k.lastActivity,
        notes: k.notes,
      })),
    )
    .select('*')
  return unwrap<KolRow[]>(result).map(mapKol)
}

// ── Tasks ──

interface TaskRow {
  id: string
  workspace_id: string
  title: string
  assignee: string | null
  priority: string | null
  status: string | null
  due_date: string | null
  created_at: string
}

function mapTask(row: TaskRow): CatchTask {
  return {
    id: row.id,
    title: row.title,
    assignee: row.assignee ?? '',
    priority: (row.priority ?? 'Medium') as TaskPriority,
    dueDate: row.due_date ?? row.created_at.slice(0, 10),
    status: (row.status ?? 'To Do') as TaskStatus,
  }
}

export async function fetchTasks(workspaceId: WorkspaceId): Promise<CatchTask[]> {
  const result = await supabase.from('tasks').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false })
  return unwrap<TaskRow[]>(result).map(mapTask)
}

export async function addTask(workspaceId: WorkspaceId, data: Omit<CatchTask, 'id'>): Promise<CatchTask> {
  const result = await supabase
    .from('tasks')
    .insert({
      workspace_id: workspaceId,
      title: data.title,
      assignee: data.assignee,
      priority: data.priority,
      status: data.status,
      due_date: data.dueDate,
    })
    .select('*')
    .single()
  return mapTask(unwrap<TaskRow>(result))
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<void> {
  const { error } = await supabase.from('tasks').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function seedTasks(workspaceId: WorkspaceId, tasks: CatchTask[]): Promise<CatchTask[]> {
  if (tasks.length === 0) return []
  const result = await supabase
    .from('tasks')
    .insert(
      tasks.map((t) => ({
        workspace_id: workspaceId,
        title: t.title,
        assignee: t.assignee,
        priority: t.priority,
        status: t.status,
        due_date: t.dueDate,
      })),
    )
    .select('*')
  return unwrap<TaskRow[]>(result).map(mapTask)
}

// ── Moderators ──

interface ModeratorRow {
  id: string
  workspace_id: string
  full_name: string
  discord_handle: string | null
  telegram_handle: string | null
  platforms: string[] | null
  start_date: string | null
  contract_type: string | null
  monthly_rate: number | null
  currency: string | null
  timezone: string | null
  country?: string | null
  shift: string | null
  status: string | null
  notes: string | null
  warnings: Warning[] | null
  created_at: string
  updated_at: string
  // Profile v2 (migration 016) — nullable to survive pre-migration reads
  bio?: string | null
  skills?: string[] | null
  languages?: string[] | null
  platforms_known?: string[] | null
  external_source?: string | null
  profile_photo_url?: string | null
  cv_storage_path?: string | null
  cv_filename?: string | null
  cv_extracted_text?: string | null
  shift_start_utc?: number | null
  shift_end_utc?: number | null
  shift_days?: number[] | null
}

// The moderators table tracks roster/contract fields only — performance
// stats (messages, bans, ratings, shift attendance) have no backing table in
// this schema, so they default to a fresh-moderator baseline on read.
function mapModerator(row: ModeratorRow): Moderator {
  return {
    id: row.id,
    fullName: row.full_name,
    discordHandle: row.discord_handle ?? '',
    telegramHandle: row.telegram_handle ?? '',
    avatarInitials: initialsOf(row.full_name),
    startDate: row.start_date ?? row.created_at.slice(0, 10),
    contractType: (row.contract_type ?? 'Volunteer') as Moderator['contractType'],
    monthlyRate: row.monthly_rate ?? undefined,
    currency: (row.currency ?? undefined) as Moderator['currency'],
    timezone: row.timezone ?? '',
    country: row.country ?? undefined,
    shift: (row.shift ?? 'Morning (06-14)') as Moderator['shift'],
    platforms: (row.platforms ?? []) as Moderator['platforms'],
    status: (row.status ?? 'Off Duty') as Moderator['status'],
    messagesThisMonth: 0,
    bansExecuted: 0,
    timeoutsGiven: 0,
    avgResponseTime: '—',
    lastActiveDate: row.updated_at.slice(0, 10),
    shiftsCompleted: 0,
    shiftsAssigned: 0,
    warnings: row.warnings ?? [],
    notes: row.notes ?? '',
    rating: 5,
    bio: row.bio ?? undefined,
    skills: row.skills ?? undefined,
    languages: row.languages ?? undefined,
    platformsKnown: row.platforms_known ?? undefined,
    externalSource: row.external_source ?? undefined,
    profilePhotoUrl: row.profile_photo_url ?? undefined,
    cvStoragePath: row.cv_storage_path ?? undefined,
    cvFilename: row.cv_filename ?? undefined,
    cvExtractedText: row.cv_extracted_text ?? undefined,
    shiftStartUtc: row.shift_start_utc ?? undefined,
    shiftEndUtc: row.shift_end_utc ?? undefined,
    shiftDays: row.shift_days ?? undefined,
  }
}

function moderatorToRow(workspaceId: WorkspaceId, m: Omit<Moderator, 'id' | 'avatarInitials'>) {
  return {
    workspace_id: workspaceId,
    full_name: m.fullName,
    discord_handle: m.discordHandle || null,
    telegram_handle: m.telegramHandle || null,
    platforms: m.platforms,
    start_date: m.startDate || null,
    contract_type: m.contractType,
    monthly_rate: m.monthlyRate ?? null,
    currency: m.currency ?? null,
    timezone: m.timezone || null,
    shift: m.shift,
    status: m.status,
    notes: m.notes || null,
    warnings: m.warnings,
    // Only sent when provided, so pre-022 callers don't hit a missing column.
    ...(m.country !== undefined && { country: m.country }),
    // Profile v2 fields — only sent if the caller provided them, so pre-016
    // callers don't overwrite existing profile data with null.
    ...(m.bio !== undefined && { bio: m.bio }),
    ...(m.skills !== undefined && { skills: m.skills }),
    ...(m.languages !== undefined && { languages: m.languages }),
    ...(m.platformsKnown !== undefined && { platforms_known: m.platformsKnown }),
    ...(m.externalSource !== undefined && { external_source: m.externalSource }),
    ...(m.profilePhotoUrl !== undefined && { profile_photo_url: m.profilePhotoUrl }),
    ...(m.cvStoragePath !== undefined && { cv_storage_path: m.cvStoragePath }),
    ...(m.cvFilename !== undefined && { cv_filename: m.cvFilename }),
    ...(m.cvExtractedText !== undefined && { cv_extracted_text: m.cvExtractedText }),
    ...(m.shiftStartUtc !== undefined && { shift_start_utc: m.shiftStartUtc }),
    ...(m.shiftEndUtc !== undefined && { shift_end_utc: m.shiftEndUtc }),
    ...(m.shiftDays !== undefined && { shift_days: m.shiftDays }),
  }
}

export async function fetchModerators(workspaceId: WorkspaceId): Promise<Moderator[]> {
  const result = await supabase.from('moderators').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: true })
  return unwrap<ModeratorRow[]>(result).map(mapModerator)
}

export async function addModerator(workspaceId: WorkspaceId, data: Omit<Moderator, 'id' | 'avatarInitials'>): Promise<Moderator> {
  const result = await supabase.from('moderators').insert(moderatorToRow(workspaceId, data)).select('*').single()
  return mapModerator(unwrap<ModeratorRow>(result))
}

export async function updateModerator(
  id: string,
  workspaceId: WorkspaceId,
  data: Omit<Moderator, 'id' | 'avatarInitials'>,
): Promise<Moderator> {
  const result = await supabase.from('moderators').update(moderatorToRow(workspaceId, data)).eq('id', id).select('*').single()
  return mapModerator(unwrap<ModeratorRow>(result))
}

export async function addModeratorWarning(id: string, warnings: Warning[]): Promise<void> {
  const { error } = await supabase.from('moderators').update({ warnings }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function removeModerator(id: string): Promise<void> {
  const { error } = await supabase.from('moderators').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Metric snapshots — 1h / 5h / 24h windows (#4 granularity) ──

export interface MetricSnapshot {
  platform: string
  capturedAt: string
  metrics: Record<string, number>
}

/**
 * Read the hourly metric snapshots for a workspace over the last `sinceHours`.
 * The caller computes deltas (e.g. now vs 1h/5h ago) for "last hour / 5 hours"
 * views; the daily rollup in `platform_metrics` still powers the 7-day view.
 */
export async function fetchMetricSnapshots(
  workspaceId: WorkspaceId,
  sinceHours = 24,
  platform?: string,
): Promise<MetricSnapshot[]> {
  const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString()
  let query = supabase
    .from('platform_metric_snapshots')
    .select('platform, captured_at, metrics')
    .eq('workspace_id', workspaceId)
    .gte('captured_at', since)
    .order('captured_at', { ascending: true })
  if (platform) query = query.eq('platform', platform)
  const result = await query
  return unwrap<{ platform: string; captured_at: string; metrics: Record<string, number> }[]>(result).map((r) => ({
    platform: r.platform,
    capturedAt: r.captured_at,
    metrics: r.metrics ?? {},
  }))
}

// ── Messages per member (#1) ──

export interface MemberMessageStat {
  memberRef: string
  displayName: string
  messages: number
}

interface MemberMessageRow {
  member_ref: string
  display_name: string | null
  message_count: number
}

/** Aggregate Telegram messages-per-member over the last `sinceDays`, top first. */
export async function fetchMemberMessages(workspaceId: WorkspaceId, sinceDays = 30): Promise<MemberMessageStat[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)
  const result = await supabase
    .from('member_messages')
    .select('member_ref, display_name, message_count')
    .eq('workspace_id', workspaceId)
    .eq('platform', 'telegram')
    .gte('day', since)
  const rows = unwrap<MemberMessageRow[]>(result)
  const map = new Map<string, MemberMessageStat>()
  for (const r of rows) {
    const entry = map.get(r.member_ref) ?? { memberRef: r.member_ref, displayName: r.display_name ?? r.member_ref, messages: 0 }
    entry.messages += Number(r.message_count)
    if (r.display_name) entry.displayName = r.display_name
    map.set(r.member_ref, entry)
  }
  return [...map.values()].sort((a, b) => b.messages - a.messages)
}

// ── Telegram joins & leaves (#26) ──

/** Gross joins and leaves over a window. These are EXACT (one row per real
 * Telegram `chat_member` transition), unlike the net delta derived from the
 * hourly member-count poll. `since` is when the window starts — anything before
 * webhook activation is unknown, not zero, so callers should say so. */
export interface MembershipEventCounts {
  joins: number
  leaves: number
  since: string
}

/** Counts Telegram joins/leaves for the last `hours`. Returns zeroes if migration
 * 026 has not been run yet, so the app keeps working pre-migration. */
export async function fetchTelegramMembershipCounts(workspaceId: WorkspaceId, hours = 24): Promise<MembershipEventCounts> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  const result = await supabase
    .from('telegram_membership_events')
    .select('event_type')
    .eq('workspace_id', workspaceId)
    .gte('occurred_at', since)
  if (result.error) return { joins: 0, leaves: 0, since }
  const rows = (result.data ?? []) as { event_type: string }[]
  return {
    joins: rows.filter((r) => r.event_type === 'join').length,
    leaves: rows.filter((r) => r.event_type === 'leave').length,
    since,
  }
}

export async function seedModerators(workspaceId: WorkspaceId, moderators: Moderator[]): Promise<Moderator[]> {
  if (moderators.length === 0) return []
  const result = await supabase
    .from('moderators')
    .insert(moderators.map((m) => moderatorToRow(workspaceId, m)))
    .select('*')
  return unwrap<ModeratorRow[]>(result).map(mapModerator)
}

// ── Compensation: points catalog ──

interface PointsConfigRow {
  id: string
  workspace_id: string
  metric_key: string
  label: string
  points: number
  created_at: string
}

function mapPointsMetric(row: PointsConfigRow): PointsMetric {
  return { id: row.id, metricKey: row.metric_key, label: row.label, points: Number(row.points) }
}

export interface PointsMetricInput {
  metricKey: string
  label: string
  points: number
}

export async function fetchPointsConfig(workspaceId: WorkspaceId): Promise<PointsMetric[]> {
  const result = await supabase
    .from('points_config')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
  return unwrap<PointsConfigRow[]>(result).map(mapPointsMetric)
}

export async function seedPointsConfig(workspaceId: WorkspaceId, metrics: PointsMetricInput[]): Promise<PointsMetric[]> {
  if (metrics.length === 0) return []
  const result = await supabase
    .from('points_config')
    .insert(metrics.map((m) => ({ workspace_id: workspaceId, metric_key: m.metricKey, label: m.label, points: m.points })))
    .select('*')
  return unwrap<PointsConfigRow[]>(result).map(mapPointsMetric)
}

export async function upsertPointsMetric(workspaceId: WorkspaceId, metric: PointsMetricInput): Promise<PointsMetric> {
  const result = await supabase
    .from('points_config')
    .upsert(
      { workspace_id: workspaceId, metric_key: metric.metricKey, label: metric.label, points: metric.points },
      { onConflict: 'workspace_id,metric_key' },
    )
    .select('*')
    .single()
  return mapPointsMetric(unwrap<PointsConfigRow>(result))
}

export async function deletePointsMetric(id: string): Promise<void> {
  const { error } = await supabase.from('points_config').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Compensation: conversion rate ──

interface ConversionConfigRow {
  id: string
  workspace_id: string
  rate: number
  currency: string
  updated_at: string
}

export async function fetchConversionConfig(workspaceId: WorkspaceId): Promise<ConversionConfig | null> {
  const { data, error } = await supabase.from('conversion_config').select('*').eq('workspace_id', workspaceId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as ConversionConfigRow
  return { rate: Number(row.rate), currency: row.currency as CompCurrency }
}

export async function upsertConversionConfig(workspaceId: WorkspaceId, config: ConversionConfig): Promise<ConversionConfig> {
  const result = await supabase
    .from('conversion_config')
    .upsert(
      { workspace_id: workspaceId, rate: config.rate, currency: config.currency, updated_at: new Date().toISOString() },
      { onConflict: 'workspace_id' },
    )
    .select('*')
    .single()
  const row = unwrap<ConversionConfigRow>(result)
  return { rate: Number(row.rate), currency: row.currency as CompCurrency }
}

// ── Compensation: per-moderator metric counts ──

interface ModeratorMetricRow {
  id: string
  workspace_id: string
  moderator_id: string
  metric_key: string
  value: number
  period: string
  updated_at: string
}

export async function fetchModeratorMetrics(workspaceId: WorkspaceId, period = 'current'): Promise<ModeratorMetricValue[]> {
  const result = await supabase
    .from('moderator_metrics')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('period', period)
  return unwrap<ModeratorMetricRow[]>(result).map((r) => ({
    moderatorId: r.moderator_id,
    metricKey: r.metric_key,
    value: Number(r.value),
    period: r.period,
  }))
}

export async function upsertModeratorMetric(
  workspaceId: WorkspaceId,
  moderatorId: string,
  metricKey: string,
  value: number,
  period = 'current',
): Promise<void> {
  const { error } = await supabase.from('moderator_metrics').upsert(
    {
      workspace_id: workspaceId,
      moderator_id: moderatorId,
      metric_key: metricKey,
      value,
      period,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,moderator_id,metric_key,period' },
  )
  if (error) throw new Error(error.message)
}

// ── Payments ──

interface PaymentRow {
  id: string
  workspace_id: string
  moderator_id: string
  amount: number
  currency: string
  period: string | null
  note: string | null
  paid_at: string
  created_at: string
}

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    moderatorId: row.moderator_id,
    amount: Number(row.amount),
    currency: row.currency,
    period: row.period ?? '',
    note: row.note ?? '',
    paidAt: row.paid_at,
  }
}

export async function fetchPayments(workspaceId: WorkspaceId): Promise<Payment[]> {
  const result = await supabase
    .from('payments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('paid_at', { ascending: false })
  return unwrap<PaymentRow[]>(result).map(mapPayment)
}

export async function addPayment(workspaceId: WorkspaceId, input: NewPaymentInput): Promise<Payment> {
  const result = await supabase
    .from('payments')
    .insert({
      workspace_id: workspaceId,
      moderator_id: input.moderatorId,
      amount: input.amount,
      currency: input.currency,
      period: input.period || null,
      note: input.note || null,
      paid_at: input.paidAt,
    })
    .select('*')
    .single()
  return mapPayment(unwrap<PaymentRow>(result))
}

// ── Feedback (CatchLab) ──

interface FeedbackRow {
  id: string
  user_id: string | null
  category: string
  title: string
  description: string
  rating: number | null
  role: string | null
  status: string
  created_at: string
}

function mapFeedback(row: FeedbackRow): FeedbackEntry {
  return {
    id: row.id,
    category: row.category as FeedbackCategory,
    title: row.title,
    description: row.description,
    rating: row.rating,
    role: row.role as FeedbackRole | null,
    status: (row.status ?? 'pending') as FeedbackEntry['status'],
    createdAt: row.created_at,
  }
}

export async function submitFeedback(userId: string, input: NewFeedbackInput): Promise<void> {
  const { error } = await supabase.from('feedback').insert({
    user_id: userId,
    category: input.category,
    title: input.title,
    description: input.description,
    rating: input.rating,
    role: input.role,
  })
  if (error) throw new Error(error.message)
}

/** Public roadmap — items the whole community can see (planned/in_progress/shipped). */
export async function fetchRoadmapFeedback(): Promise<FeedbackEntry[]> {
  const result = await supabase
    .from('feedback')
    .select('*')
    .in('status', ['planned', 'in_progress', 'shipped'])
    .order('created_at', { ascending: false })
  return unwrap<FeedbackRow[]>(result).map(mapFeedback)
}

/** Owner-only request log — every submission including the pending inbox.
 * Returns [] for non-owners (RLS blocks the rows). */
export async function fetchAllFeedback(): Promise<FeedbackEntry[]> {
  const result = await supabase.from('feedback').select('*').order('created_at', { ascending: false })
  if (result.error) return []
  return (result.data ?? []).map((r) => mapFeedback(r as FeedbackRow))
}

/** Owner moves an item across the roadmap. */
export async function updateFeedbackStatus(id: string, status: FeedbackEntry['status']): Promise<void> {
  const { error } = await supabase.from('feedback').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}
