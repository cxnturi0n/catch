import { api } from './client'
import type { IntegrationKey, TrendPoint, WorkspaceId, XAnalyticsData } from '../../types'

// ── Integrations: connect / sync ────────────────────────────────────────────

export interface ConnectResult {
  success: boolean
  server_name?: string
  group_name?: string
  name?: string
  member_count?: number
  followers?: number
  campaign_count?: number
  error?: string
}

export interface SyncResult {
  success: boolean
  members?: number
  bans_7d?: number
  total_xp?: number
  followers?: number
  campaigns?: number
  participants?: number
  error?: string
}

type Connectable = 'discord' | 'telegram' | 'zealy' | 'galxe'
const intBase = (ws: WorkspaceId, p: Connectable) => `/workspaces/${ws}/integrations/${p}`

async function connect(ws: WorkspaceId, platform: Connectable, body: Record<string, string | undefined>): Promise<ConnectResult> {
  const r = await api<{ metadata: Record<string, string | number | null> }>(`${intBase(ws, platform)}/connect`, { method: 'POST', body })
  return { success: true, ...(r.metadata as Partial<ConnectResult>) }
}
async function sync(ws: WorkspaceId, platform: Connectable): Promise<SyncResult> {
  const r = await api<{ metrics: Record<string, unknown> }>(`${intBase(ws, platform)}/sync`, { method: 'POST' })
  return { success: true, ...(r.metrics as Partial<SyncResult>) }
}

export const discordConnect = (ws: WorkspaceId, botToken: string, serverId: string) => connect(ws, 'discord', { botToken, serverId })
export const telegramConnect = (ws: WorkspaceId, botToken: string, chatId: string) => connect(ws, 'telegram', { botToken, chatId })
export const zealyConnect = (ws: WorkspaceId, subdomain: string, apiKey: string) => connect(ws, 'zealy', { subdomain, apiKey })
export const galxeConnect = (ws: WorkspaceId, alias: string, accessToken?: string) => connect(ws, 'galxe', { alias, accessToken })
export const discordSync = (ws: WorkspaceId) => sync(ws, 'discord')
export const telegramSync = (ws: WorkspaceId) => sync(ws, 'telegram')
export const zealySync = (ws: WorkspaceId) => sync(ws, 'zealy')
export const galxeSync = (ws: WorkspaceId) => sync(ws, 'galxe')

// ── Metrics reads ───────────────────────────────────────────────────────────

const m = (ws: WorkspaceId) => `/workspaces/${ws}/metrics`

export interface PlatformMetricDay {
  platform: string
  date: string
  metrics: Record<string, number>
}

export async function fetchPlatformMetricRows(workspaceId: WorkspaceId, platforms: IntegrationKey[], days: number): Promise<PlatformMetricDay[]> {
  if (platforms.length === 0) return []
  const r = await api<{ rows: Array<{ platform: string; date: string; metrics: Record<string, unknown> }> }>(`${m(workspaceId)}/daily?days=${days}&platforms=${platforms.join(',')}`)
  return r.rows.map((x) => ({ platform: x.platform, date: x.date, metrics: (x.metrics ?? {}) as Record<string, number> }))
}

export interface LiveMetrics {
  trend: TrendPoint[]
  latestMembers: number | null
  latestBans7d: number | null
}

export async function fetchPlatformMetrics(workspaceId: WorkspaceId, platforms: IntegrationKey[], days: number): Promise<LiveMetrics | null> {
  const rows = await fetchPlatformMetricRows(workspaceId, platforms, days)
  if (rows.length === 0) return null
  const byDate = new Map<string, number>()
  for (const row of rows) byDate.set(row.date, (byDate.get(row.date) ?? 0) + (typeof row.metrics.members === 'number' ? row.metrics.members : 0))
  const trend: TrendPoint[] = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }))
  const latestByPlatform = new Map<string, PlatformMetricDay>()
  for (const row of rows) {
    const cur = latestByPlatform.get(row.platform)
    if (!cur || row.date > cur.date) latestByPlatform.set(row.platform, row)
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

export interface MetricSnapshot {
  platform: string
  capturedAt: string
  metrics: Record<string, number>
}

export async function fetchMetricSnapshots(workspaceId: WorkspaceId, sinceHours = 24, platform?: string): Promise<MetricSnapshot[]> {
  const q = new URLSearchParams({ hours: String(sinceHours), ...(platform && { platform }) })
  const r = await api<{ rows: Array<{ platform: string; capturedAt: string; metrics: Record<string, unknown> }> }>(`${m(workspaceId)}/snapshots?${q}`)
  return r.rows.map((x) => ({ platform: x.platform, capturedAt: x.capturedAt, metrics: (x.metrics ?? {}) as Record<string, number> }))
}

export interface MemberMessageStat {
  memberRef: string
  displayName: string
  messages: number
}

export type MessagePlatform = 'telegram' | 'discord'

async function memberMessages(workspaceId: WorkspaceId, sinceDays: number, platform: MessagePlatform = 'telegram') {
  return api<{ members: Array<{ memberRef: string; displayName: string | null; messages: number }>; trend: TrendPoint[] }>(`${m(workspaceId)}/member-messages?days=${sinceDays}&platform=${platform}`)
}

export async function fetchMemberMessages(workspaceId: WorkspaceId, sinceDays = 30, platform: MessagePlatform = 'telegram'): Promise<MemberMessageStat[]> {
  return (await memberMessages(workspaceId, sinceDays, platform)).members.map((x) => ({ memberRef: x.memberRef, displayName: x.displayName ?? x.memberRef, messages: x.messages }))
}

export async function fetchMemberMessageTrend(workspaceId: WorkspaceId, sinceDays = 30, platform: MessagePlatform = 'telegram'): Promise<TrendPoint[]> {
  return (await memberMessages(workspaceId, sinceDays, platform)).trend
}

// ── Channels, member picker, history import ─────────────────────────────────

export interface ChannelActivityRow {
  platform: MessagePlatform
  channelId: string
  name: string | null
  type: string | null
  messages: number
  activeMembers: number
  lastMessageAt: string | null
}

export async function fetchChannelActivity(workspaceId: WorkspaceId, sinceDays = 30, platform?: MessagePlatform): Promise<ChannelActivityRow[]> {
  const q = new URLSearchParams({ days: String(sinceDays), ...(platform && { platform }) })
  return (await api<{ rows: ChannelActivityRow[] }>(`${m(workspaceId)}/channels?${q}`)).rows
}

export interface PlatformMember {
  memberRef: string
  displayName: string | null
  messages: number
  lastMessageAt: string | null
  isAdmin: boolean
}

export async function fetchPlatformMembers(workspaceId: WorkspaceId, platform: MessagePlatform, q = '', limit = 20): Promise<PlatformMember[]> {
  const qs = new URLSearchParams({ platform, limit: String(limit), ...(q && { q }) })
  return (await api<{ rows: PlatformMember[] }>(`${m(workspaceId)}/platform-members?${qs}`)).rows
}

export function requestBackfill(workspaceId: WorkspaceId, platform: MessagePlatform) {
  return api<{ platform: string; backfill: { status: string } }>(`${intBase(workspaceId, platform)}/backfill`, { method: 'POST' })
}

export interface MembershipEventCounts {
  joins: number
  leaves: number
  since: string
}

export async function fetchTelegramMembershipCounts(workspaceId: WorkspaceId, hours = 24): Promise<MembershipEventCounts> {
  return api<MembershipEventCounts>(`${m(workspaceId)}/telegram-membership?hours=${hours}`)
}

export type ActivityPlatform = 'telegram' | 'discord'
export interface ActivityBucket {
  bucketStart: string
  platform: ActivityPlatform
  count: number
}

export async function fetchActivityBuckets(workspaceId: WorkspaceId, sinceDays = 28, platform?: ActivityPlatform): Promise<ActivityBucket[]> {
  const q = new URLSearchParams({ days: String(sinceDays), ...(platform && { platform }) })
  return (await api<{ rows: ActivityBucket[] }>(`${m(workspaceId)}/activity?${q}`)).rows
}

export interface TenureRecord {
  memberRef: string
  joinedAt: string | null
  firstSeen: string
  lastSeen: string
}
export interface MembershipSnapshotRow {
  capturedAt: string
  totalMembers: number
  newMembers: number
  leftMembers: number
}

export async function fetchTenure(workspaceId: WorkspaceId): Promise<TenureRecord[]> {
  return (await api<{ rows: TenureRecord[] }>(`${m(workspaceId)}/discord-tenure`)).rows
}

export async function fetchMembershipSnapshots(workspaceId: WorkspaceId, sinceDays = 90): Promise<MembershipSnapshotRow[]> {
  return (await api<{ rows: MembershipSnapshotRow[] }>(`${m(workspaceId)}/discord-membership?days=${sinceDays}`)).rows
}

// ── X analytics (CSV parsed in the browser, stored server-side) ─────────────

interface XImportRow {
  filename: string | null
  periodStart: string | null
  periodEnd: string | null
  rows: unknown[]
  createdAt: string
}

// The whole parsed dataset travels as a single "row" so the existing parser
// and charts stay untouched.
export async function loadXAnalytics(workspaceId: WorkspaceId): Promise<XAnalyticsData | null> {
  const r = await api<{ import: XImportRow | null }>(`${m(workspaceId)}/x-import`)
  const first = r.import?.rows[0] as (XAnalyticsData & { date: string }) | undefined
  return first ? (first as XAnalyticsData) : null
}

export async function saveXAnalytics(workspaceId: WorkspaceId, data: XAnalyticsData): Promise<void> {
  await api(`${m(workspaceId)}/x-import`, {
    method: 'PUT',
    body: { filename: null, periodStart: data.periodStart, periodEnd: data.periodEnd, rows: [{ ...data, date: data.importedAt }] },
  })
}

export async function clearXAnalytics(workspaceId: WorkspaceId): Promise<void> {
  await api(`${m(workspaceId)}/x-import`, { method: 'DELETE' }).catch(() => undefined)
}
