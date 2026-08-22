// ============================================================================
// Moderator platform v2 (migration 016) — profile updates, CV upload,
// response/shift metrics, compensation configs, resources, content schedule,
// meetings, usage events. Kept out of the monolith db.ts to reduce merge risk
// while parallel agents build their features.
// ============================================================================

import { supabase } from './supabase'
import type {
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
export { fetchResources, fetchResourcesWithStats, deleteResource, getResourceSignedUrl, logResourceView } from './api/resources'


function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('No data returned from Supabase.')
  return result.data
}

// ── Resources drive (internal storage + external links + view log) ──






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
