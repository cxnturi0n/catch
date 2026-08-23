export type WorkspaceId = string

export interface Workspace {
  id: WorkspaceId
  name: string
  shortName: string
  colorFrom: string
  colorTo: string
}

export interface WorkspaceStats {
  activeMembers: number
  activeMembersDelta: number | null
  messagesWeek: number
  messagesDelta: number | null
  newMembers: number
  newMembersDelta: number | null
  scamAlertsBlocked: number
  scamAlertsDelta: number | null
}

export interface TrendPoint {
  date: string
  value: number
}

export type IncidentType = 'Fake Link' | 'Impersonation' | 'Phishing' | 'Rugpull Warning'
export type IncidentChannel = 'Discord' | 'Telegram'
export type IncidentStatus = 'Resolved' | 'Open'

export interface ModerationIncident {
  id: string
  date: string
  type: IncidentType
  channel: IncidentChannel
  actionTaken: string
  status: IncidentStatus
}

export type KOLStatus = 'Active' | 'Inactive' | 'Pending'
export type KOLChannel = 'Discord' | 'Telegram' | 'Twitter' | 'YouTube'

export interface KOL {
  id: string
  name: string
  handle: string
  channel: KOLChannel
  reach: number
  status: KOLStatus
  lastActivity: string
  notes: string
}

export type TaskPriority = 'High' | 'Medium' | 'Low'
export type TaskStatus = 'To Do' | 'In Progress' | 'Done'

export interface CatchTask {
  id: string
  title: string
  assignee: string
  priority: TaskPriority
  dueDate: string
  status: TaskStatus
  area?: string
  startDate?: string // 'YYYY-MM-DD'
}

export interface WorkspaceData {
  stats: WorkspaceStats
  activeMembersTrend: TrendPoint[]
  dailyMessages: TrendPoint[]
  incidents: ModerationIncident[]
  kols: KOL[]
  tasks: CatchTask[]
}

// ── Integrations ──

export type IntegrationKey =
  | 'discord'
  | 'telegram'
  | 'twitter'
  | 'zealy'
  | 'galxe'
  | 'snapshot'
  | 'twitch'
  | 'youtube'
  | 'kick'
export type IntegrationConnectionStatus = 'Connected' | 'Not Connected' | 'Coming Soon'

export interface IntegrationConnection {
  status: IntegrationConnectionStatus
  fields: Record<string, string>
  mockData: Record<string, string | number>
  lastSync: string | null
}

export type WorkspaceIntegrations = Record<IntegrationKey, IntegrationConnection>

// ── Moderators ──

export type ModeratorContractType = 'Volunteer' | 'Paid' | 'Trial'
export type ModeratorCurrency = 'USD' | 'EUR' | 'USDT'
export type ModeratorShift = 'Morning (06-14)' | 'Afternoon (14-22)' | 'Night (22-06)'
export type ModeratorPlatform = 'Discord' | 'Telegram'
export type ModeratorStatus = 'On Duty' | 'Off Duty' | 'On Leave' | 'Inactive'
export type WarningSeverity = 'Low' | 'Medium' | 'High'

export interface Warning {
  id: string
  date: string
  reason: string
  severity: WarningSeverity
  issuedBy: string
}

export interface Moderator {
  id: string
  fullName: string
  discordHandle: string
  telegramHandle: string
  avatarInitials: string
  startDate: string
  contractType: ModeratorContractType
  monthlyRate?: number
  currency?: ModeratorCurrency
  timezone: string
  country?: string
  shift: ModeratorShift
  platforms: ModeratorPlatform[]
  status: ModeratorStatus
  messagesThisMonth: number
  bansExecuted: number
  timeoutsGiven: number
  avgResponseTime: string
  lastActiveDate: string
  shiftsCompleted: number
  shiftsAssigned: number
  warnings: Warning[]
  notes: string
  rating: number
  // Profile v2 (migration 016)
  bio?: string
  skills?: string[]
  languages?: string[]
  platformsKnown?: string[]
  externalSource?: string
  profilePhotoUrl?: string
  cvStoragePath?: string
  cvFilename?: string
  cvExtractedText?: string
  shiftStartUtc?: number
  shiftEndUtc?: number
  shiftDays?: number[] // 0=Sun..6=Sat
}

/** Punctuality + response-rate metrics per moderator (migration 016). */
export interface ModeratorResponseMetric {
  moderatorId: string
  platform: 'discord' | 'telegram' | 'twitch' | 'youtube' | 'kick' | 'x'
  day: string
  responsesCount: number
  avgResponseSeconds: number | null
}

export interface ModeratorShiftEvent {
  moderatorId: string
  day: string
  expectedStartUtc: string
  expectedEndUtc: string
  firstActivityUtc: string | null
  wasOnTime: boolean | null
}

// ── CatchLab (feedback) ──

export type FeedbackCategory = 'Bug Report' | 'Feature Request' | 'Analytics & Metrics' | 'Integrations' | 'General Feedback'
export type FeedbackRole = 'Freelance CM' | 'Agency CM' | 'In-house CM' | 'Protocol Team' | 'Other'
// pending = private (owner-only inbox); the rest form the public roadmap.
export type FeedbackStatus = 'pending' | 'planned' | 'in_progress' | 'shipped' | 'declined'

export interface FeedbackEntry {
  id: string
  category: FeedbackCategory
  title: string
  description: string
  rating: number | null
  role: FeedbackRole | null
  status: FeedbackStatus
  createdAt: string
}

export interface NewFeedbackInput {
  category: FeedbackCategory
  title: string
  description: string
  rating: number | null
  role: FeedbackRole | null
}

// ── Community Leaderboard ──

export type LeaderboardPlatform = 'Discord' | 'Telegram'

export interface CommunityMember {
  id: string
  username: string
  platform: LeaderboardPlatform
  avatarInitials: string
  messagesCount: number
  reactionsReceived: number
  daysActive: number
  joinedDate: string
  engagementScore: number
}

// ── Moderator compensation (points engine) ──

export type CompCurrency = ModeratorCurrency // 'USD' | 'EUR' | 'USDT'

/** A single configurable metric in the points catalog (e.g. 1 like = 1 point). */
export interface PointsMetric {
  id: string
  metricKey: string
  label: string
  points: number
}

/** Workspace-wide points → currency conversion. */
export interface ConversionConfig {
  rate: number
  currency: CompCurrency
}

/** A manually-entered count for one (moderator, metric) pair in a period. */
export interface ModeratorMetricValue {
  moderatorId: string
  metricKey: string
  value: number
  period: string
}

export interface Payment {
  id: string
  moderatorId: string
  amount: number
  currency: string
  period: string
  note: string
  paidAt: string
}

export interface NewPaymentInput {
  moderatorId: string
  amount: number
  currency: string
  period: string
  note: string
  paidAt: string
}

// ── Compensation v2 (dedicated section, migration 016) ──

export type CompensationKind = 'fixed' | 'variable' | 'both'
export type FixedPeriod = 'monthly' | 'weekly' | 'hourly'

export interface CompensationConfig {
  moderatorId: string
  workspaceId: string
  kind: CompensationKind
  fixedAmount: number | null
  fixedCurrency: CompCurrency | null
  fixedPeriod: FixedPeriod | null
  variableNotes: string | null
  updatedAt: string
}

// ── Resources drive (migration 016) ──

export type ResourceKind = 'file' | 'external_link'
export type ResourceVisibility = 'team' | 'private'

export interface Resource {
  id: string
  workspaceId: string
  kind: ResourceKind
  title: string
  description: string | null
  storagePath: string | null
  externalUrl: string | null
  mimeType: string | null
  sizeBytes: number | null
  visibility: ResourceVisibility
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ResourceView {
  id: string
  resourceId: string
  workspaceId: string
  viewerUserId: string | null
  viewerModeratorId: string | null
  viewerLabel: string | null
  viewedAt: string
}

export interface ResourceWithStats extends Resource {
  viewCount: number
  lastViewedAt: string | null
  uniqueViewers: number
}

// ── Content schedule (migration 016) ──

export type ContentPlatform =
  | 'discord' | 'telegram' | 'twitter' | 'x' | 'zealy' | 'galxe'
  | 'snapshot' | 'twitch' | 'youtube' | 'kick' | 'other'
export type ContentStatus = 'scheduled' | 'published' | 'cancelled'

export interface ContentScheduleItem {
  id: string
  workspaceId: string
  title: string
  description: string | null
  platform: ContentPlatform | null
  scheduledAt: string
  publishedAt: string | null
  status: ContentStatus
  ownerUserId: string | null
  assignedModeratorId: string | null
  notes: string | null
  attachments: Array<{ url: string; label?: string }>
  createdAt: string
  updatedAt: string
}

// ── Meetings (migration 016) ──

export type MeetingProvider = 'google' | 'outlook' | 'other'

export interface Meeting {
  id: string
  workspaceId: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  meetLink: string | null
  attendeeEmails: string[]
  attendeeModeratorIds: string[]
  provider: MeetingProvider
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

// ── Usage events (migration 016) ──

export type UsageEventType =
  | 'edge_function' | 'ai_recap' | 'ai_cv_parse' | 'storage_bytes'
  | 'email_report' | 'cron_sync' | 'other'
export type UsageUnit = 'call' | 'tokens' | 'bytes' | 'emails'

export interface UsageEvent {
  id: string
  workspaceId: string
  eventType: UsageEventType
  platform: string | null
  quantity: number
  unit: UsageUnit
  costHintUsd: number | null
  occurredAt: string
  metadata: Record<string, unknown>
}

export interface UsageRollup {
  eventType: UsageEventType
  totalQuantity: number
  totalCostUsd: number
  callCount: number
}

// ── X / Twitter Analytics (CSV import) ──

export interface XAnalyticsTrendPoint {
  date: string
  impressions: number
  engagements: number
}

export interface XAnalyticsData {
  importedAt: string
  periodStart: string
  periodEnd: string
  totalImpressions: number
  totalEngagements: number
  avgEngagementRate: number
  totalLikes: number
  totalRetweets: number
  totalReplies: number
  trend: XAnalyticsTrendPoint[]
}
