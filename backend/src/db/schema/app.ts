import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.js'

// ---------------------------------------------------------------------------
// Application schema, ported from legacy/supabase/migrations with the clean-ups
// listed in AUDIT_AND_MIGRATION_PLAN.md §10.1:
//  - every user reference points at `user.id` (Better Auth), never auth.users
//  - third-party credentials are stored encrypted (see lib/crypto.ts) in a
//    single text column; plaintext jsonb is gone
//  - workspace_members prepared for multi-user workspaces (owner is a member)
//  - composite FKs guarantee a moderator belongs to the row's workspace
//  - enum-like columns carry CHECK constraints, workspace_id is indexed
//  - updated_at maintained by Drizzle ($onUpdate)
//  - localStorage-only data from the old SPA gets real tables
//    (report_runs, x_imports, tasks.area / start_date)
// ---------------------------------------------------------------------------

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' })
const userRefNullable = (name: string) => uuid(name).references(() => user.id, { onDelete: 'set null' })

// Platforms Catch knows about. Integrations are limited to the first four;
// the rest appear in moderator/content metadata.
export const PLATFORMS = ['discord', 'telegram', 'galxe', 'zealy', 'x', 'twitch', 'youtube', 'kick', 'snapshot', 'other'] as const
export const INTEGRATION_PLATFORMS = ['discord', 'telegram', 'galxe', 'zealy'] as const
export const PLAN_TIERS = ['starter', 'pro', 'agency', 'enterprise'] as const
export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const

// --- Users (profile extras kept out of the auth table) ---------------------
export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  jobRole: text('job_role'),
  managesMultiple: boolean('manages_multiple'),
  communitySize: text('community_size'),
  primaryPlatforms: text('primary_platforms').array().notNull().default(sql`'{}'::text[]`),
  timezone: text('timezone'),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  layoutPromptSeenAt: timestamp('layout_prompt_seen_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// --- Workspaces -------------------------------------------------------------
export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    projectType: text('project_type'),
    communitySize: text('community_size'),
    platforms: text('platforms').array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('workspaces_owner_idx').on(t.ownerId)],
)

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: workspaceRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: WORKSPACE_ROLES }).notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('workspace_members_user_idx').on(t.userId)],
)

// Pending invitations. The token is stored hashed; the clear token travels
// only inside the e-mail link.
export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: id(),
    workspaceId: workspaceRef(),
    email: text('email').notNull(),
    role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: userRefNullable('invited_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique('workspace_invites_ws_email_key').on(t.workspaceId, t.email), index('workspace_invites_ws_idx').on(t.workspaceId)],
)

// --- Integrations -----------------------------------------------------------
export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    workspaceId: workspaceRef(),
    platform: text('platform', { enum: INTEGRATION_PLATFORMS }).notNull(),
    status: text('status', { enum: ['disconnected', 'connected', 'error'] }).notNull().default('disconnected'),
    // Encrypted JSON (lib/crypto.ts). Never selected by list endpoints.
    credentialsEnc: text('credentials_enc'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    lastSync: timestamp('last_sync', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('integrations_workspace_platform_key').on(t.workspaceId, t.platform)],
)

export const integrationSyncState = pgTable(
  'integration_sync_state',
  {
    workspaceId: workspaceRef(),
    // Includes pseudo keys such as 'discord:activity' / 'discord:members'.
    platform: text('platform').notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastSnapshotAt: timestamp('last_snapshot_at', { withTimezone: true }),
    lastMetrics: jsonb('last_metrics').$type<Record<string, unknown>>(),
    lastError: text('last_error'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.platform] })],
)

// --- Metrics ----------------------------------------------------------------
export const platformMetrics = pgTable(
  'platform_metrics',
  {
    id: id(),
    workspaceId: workspaceRef(),
    platform: text('platform').notNull(),
    date: date('date').notNull().default(sql`current_date`),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [unique('platform_metrics_ws_platform_date_key').on(t.workspaceId, t.platform, t.date)],
)

export const platformMetricSnapshots = pgTable(
  'platform_metric_snapshots',
  {
    id: id(),
    workspaceId: workspaceRef(),
    platform: text('platform').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('pms_ws_platform_time_idx').on(t.workspaceId, t.platform, t.capturedAt)],
)

export const messageActivity = pgTable(
  'message_activity',
  {
    id: id(),
    workspaceId: workspaceRef(),
    platform: text('platform', { enum: ['telegram', 'discord'] }).notNull(),
    bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
    messageCount: integer('message_count').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('message_activity_ws_platform_bucket_key').on(t.workspaceId, t.platform, t.bucketStart),
    index('message_activity_ws_bucket_idx').on(t.workspaceId, t.bucketStart),
  ],
)

export const memberMessages = pgTable(
  'member_messages',
  {
    id: id(),
    workspaceId: workspaceRef(),
    platform: text('platform', { enum: ['telegram', 'discord'] }).notNull().default('telegram'),
    memberRef: text('member_ref').notNull(),
    displayName: text('display_name'),
    day: date('day').notNull().default(sql`current_date`),
    messageCount: integer('message_count').notNull().default(0),
    // Earliest/latest message of the day: punctuality needs the first one.
    firstMessageAt: timestamp('first_message_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('member_messages_ws_platform_member_day_key').on(t.workspaceId, t.platform, t.memberRef, t.day),
    index('member_messages_ws_day_idx').on(t.workspaceId, t.day),
  ],
)

export const telegramMembershipEvents = pgTable(
  'telegram_membership_events',
  {
    id: id(),
    workspaceId: workspaceRef(),
    chatId: text('chat_id').notNull(),
    userRef: text('user_ref').notNull(),
    displayName: text('display_name'),
    eventType: text('event_type', { enum: ['join', 'leave'] }).notNull(),
    oldStatus: text('old_status'),
    newStatus: text('new_status'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('tme_dedup_key').on(t.workspaceId, t.chatId, t.userRef, t.eventType, t.occurredAt),
    index('tme_ws_time_idx').on(t.workspaceId, t.occurredAt),
  ],
)

// Telegram redelivers updates; processed ids make every handler idempotent.
export const processedTelegramUpdates = pgTable(
  'processed_telegram_updates',
  {
    workspaceId: workspaceRef(),
    updateId: bigint('update_id', { mode: 'number' }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.updateId] })],
)

export const discordChannelCursors = pgTable(
  'discord_channel_cursors',
  {
    id: id(),
    workspaceId: workspaceRef(),
    channelId: text('channel_id').notNull(),
    lastMessageId: text('last_message_id'),
    updatedAt: updatedAt(),
  },
  (t) => [unique('discord_channel_cursors_ws_channel_key').on(t.workspaceId, t.channelId)],
)

export const discordMemberTenure = pgTable(
  'discord_member_tenure',
  {
    id: id(),
    workspaceId: workspaceRef(),
    memberRef: text('member_ref').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('discord_member_tenure_ws_member_key').on(t.workspaceId, t.memberRef),
    index('dmt_ws_joined_idx').on(t.workspaceId, t.joinedAt),
  ],
)

export const discordMembershipSnapshots = pgTable(
  'discord_membership_snapshots',
  {
    id: id(),
    workspaceId: workspaceRef(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    totalMembers: integer('total_members').notNull().default(0),
    newMembers: integer('new_members').notNull().default(0),
    leftMembers: integer('left_members').notNull().default(0),
  },
  (t) => [index('dms_ws_time_idx').on(t.workspaceId, t.capturedAt)],
)

// Manual X (Twitter) CSV imports, previously kept in localStorage.
export const xImports = pgTable(
  'x_imports',
  {
    id: id(),
    workspaceId: workspaceRef(),
    importedBy: userRefNullable('imported_by'),
    filename: text('filename'),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    rows: jsonb('rows').$type<unknown[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('x_imports_ws_idx').on(t.workspaceId, t.createdAt)],
)

// --- Team -------------------------------------------------------------------
export const moderators = pgTable(
  'moderators',
  {
    id: id(),
    workspaceId: workspaceRef(),
    fullName: text('full_name').notNull(),
    discordHandle: text('discord_handle'),
    telegramHandle: text('telegram_handle'),
    platforms: text('platforms').array().notNull().default(sql`'{}'::text[]`),
    startDate: date('start_date'),
    contractType: text('contract_type').notNull().default('Volunteer'),
    timezone: text('timezone'),
    country: text('country'),
    status: text('status').notNull().default('Off Duty'),
    notes: text('notes'),
    warnings: jsonb('warnings').$type<Array<{ date: string; reason: string; severity?: string }>>().notNull().default([]),
    bio: text('bio'),
    skills: text('skills').array().notNull().default(sql`'{}'::text[]`),
    languages: text('languages').array().notNull().default(sql`'{}'::text[]`),
    platformsKnown: text('platforms_known').array().notNull().default(sql`'{}'::text[]`),
    externalSource: text('external_source'),
    profilePhotoUrl: text('profile_photo_url'),
    cvStoragePath: text('cv_storage_path'),
    cvFilename: text('cv_filename'),
    cvExtractedText: text('cv_extracted_text'),
    // Shift window in UTC hours, by deliberate design (distributed teams).
    shiftStartUtc: integer('shift_start_utc'),
    shiftEndUtc: integer('shift_end_utc'),
    shiftDays: integer('shift_days').array().notNull().default(sql`'{1,2,3,4,5}'::int[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('moderators_ws_idx').on(t.workspaceId),
    // Lets child tables reference (workspace_id, id) so a moderator can only
    // be attached to rows of its own workspace.
    unique('moderators_ws_id_key').on(t.workspaceId, t.id),
    check('moderators_shift_start_chk', sql`${t.shiftStartUtc} is null or ${t.shiftStartUtc} between 0 and 23`),
    check('moderators_shift_end_chk', sql`${t.shiftEndUtc} is null or ${t.shiftEndUtc} between 0 and 23`),
  ],
)

const moderatorScoped = (t: { workspaceId: unknown; moderatorId: unknown }, name: string) =>
  foreignKey({
    columns: [t.workspaceId as never, t.moderatorId as never],
    foreignColumns: [moderators.workspaceId, moderators.id],
    name,
  }).onDelete('cascade')

export const moderatorResponseMetrics = pgTable(
  'moderator_response_metrics',
  {
    id: id(),
    workspaceId: workspaceRef(),
    moderatorId: uuid('moderator_id').notNull(),
    platform: text('platform', { enum: PLATFORMS }).notNull(),
    day: date('day').notNull(),
    responsesCount: integer('responses_count').notNull().default(0),
    avgResponseSeconds: integer('avg_response_seconds'),
    createdAt: createdAt(),
  },
  (t) => [
    moderatorScoped(t, 'mrm_moderator_fk'),
    unique('mrm_mod_platform_day_key').on(t.moderatorId, t.platform, t.day),
    index('mrm_ws_day_idx').on(t.workspaceId, t.day),
  ],
)

export const moderatorShiftEvents = pgTable(
  'moderator_shift_events',
  {
    id: id(),
    workspaceId: workspaceRef(),
    moderatorId: uuid('moderator_id').notNull(),
    day: date('day').notNull(),
    expectedStartUtc: timestamp('expected_start_utc', { withTimezone: true }).notNull(),
    expectedEndUtc: timestamp('expected_end_utc', { withTimezone: true }).notNull(),
    firstActivityUtc: timestamp('first_activity_utc', { withTimezone: true }),
    wasOnTime: boolean('was_on_time'),
    createdAt: createdAt(),
  },
  (t) => [
    moderatorScoped(t, 'mse_moderator_fk'),
    unique('mse_mod_day_key').on(t.moderatorId, t.day),
    index('mse_ws_day_idx').on(t.workspaceId, t.day),
  ],
)

// --- Compensation -----------------------------------------------------------
export const pointsConfig = pgTable(
  'points_config',
  {
    id: id(),
    workspaceId: workspaceRef(),
    metricKey: text('metric_key').notNull(),
    label: text('label').notNull(),
    points: numeric('points', { precision: 12, scale: 4 }).notNull().default('0'),
    createdAt: createdAt(),
  },
  (t) => [unique('points_config_ws_metric_key').on(t.workspaceId, t.metricKey)],
)

export const conversionConfig = pgTable('conversion_config', {
  workspaceId: workspaceRef().primaryKey(),
  rate: numeric('rate', { precision: 12, scale: 6 }).notNull().default('0.01'),
  currency: text('currency').notNull().default('USD'),
  updatedAt: updatedAt(),
})

export const moderatorMetrics = pgTable(
  'moderator_metrics',
  {
    id: id(),
    workspaceId: workspaceRef(),
    moderatorId: uuid('moderator_id').notNull(),
    metricKey: text('metric_key').notNull(),
    value: numeric('value', { precision: 14, scale: 4 }).notNull().default('0'),
    period: text('period').notNull().default('current'),
    updatedAt: updatedAt(),
  },
  (t) => [
    moderatorScoped(t, 'moderator_metrics_moderator_fk'),
    unique('moderator_metrics_key').on(t.workspaceId, t.moderatorId, t.metricKey, t.period),
  ],
)

export const compensationConfigs = pgTable(
  'compensation_configs',
  {
    workspaceId: workspaceRef(),
    moderatorId: uuid('moderator_id').notNull(),
    kind: text('kind', { enum: ['fixed', 'variable', 'both'] }).notNull().default('variable'),
    fixedAmount: numeric('fixed_amount', { precision: 12, scale: 2 }),
    fixedCurrency: text('fixed_currency', { enum: ['USD', 'EUR', 'USDT'] }),
    fixedPeriod: text('fixed_period', { enum: ['monthly', 'weekly', 'hourly'] }),
    variableNotes: text('variable_notes'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.moderatorId] }), moderatorScoped(t, 'compensation_configs_moderator_fk')],
)

export const payments = pgTable(
  'payments',
  {
    id: id(),
    workspaceId: workspaceRef(),
    moderatorId: uuid('moderator_id').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull().default('USD'),
    period: text('period'),
    note: text('note'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [moderatorScoped(t, 'payments_moderator_fk'), index('payments_ws_paid_idx').on(t.workspaceId, t.paidAt)],
)

// --- Operations -------------------------------------------------------------
export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    workspaceId: workspaceRef(),
    title: text('title').notNull(),
    assignee: text('assignee'),
    area: text('area'),
    priority: text('priority', { enum: ['Low', 'Medium', 'High', 'Urgent'] }).notNull().default('Medium'),
    status: text('status', { enum: ['To Do', 'In Progress', 'Review', 'Done'] }).notNull().default('To Do'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tasks_ws_idx').on(t.workspaceId)],
)

export const incidents = pgTable(
  'incidents',
  {
    id: id(),
    workspaceId: workspaceRef(),
    date: date('date').notNull().default(sql`current_date`),
    type: text('type').notNull(),
    channel: text('channel').notNull(),
    actionTaken: text('action_taken'),
    status: text('status', { enum: ['Open', 'Resolved', 'Escalated'] }).notNull().default('Open'),
    createdAt: createdAt(),
  },
  (t) => [index('incidents_ws_date_idx').on(t.workspaceId, t.date)],
)

export const kols = pgTable(
  'kols',
  {
    id: id(),
    workspaceId: workspaceRef(),
    name: text('name').notNull(),
    handle: text('handle'),
    channel: text('channel'),
    reach: integer('reach').notNull().default(0),
    status: text('status').notNull().default('Pending'),
    lastActivity: date('last_activity'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('kols_ws_idx').on(t.workspaceId)],
)

export const meetings = pgTable(
  'meetings',
  {
    id: id(),
    workspaceId: workspaceRef(),
    title: text('title').notNull(),
    description: text('description'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    meetLink: text('meet_link'),
    attendeeEmails: text('attendee_emails').array().notNull().default(sql`'{}'::text[]`),
    attendeeModeratorIds: uuid('attendee_moderator_ids').array().notNull().default(sql`'{}'::uuid[]`),
    provider: text('provider', { enum: ['google', 'outlook', 'other'] }).notNull().default('google'),
    createdBy: userRefNullable('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('meetings_ws_time_idx').on(t.workspaceId, t.startsAt), check('meetings_range_chk', sql`${t.endsAt} > ${t.startsAt}`)],
)

export const contentSchedule = pgTable(
  'content_schedule',
  {
    id: id(),
    workspaceId: workspaceRef(),
    title: text('title').notNull(),
    description: text('description'),
    platform: text('platform', { enum: PLATFORMS }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    status: text('status', { enum: ['scheduled', 'published', 'cancelled'] }).notNull().default('scheduled'),
    ownerUserId: userRefNullable('owner_user_id'),
    assignedModeratorId: uuid('assigned_moderator_id').references(() => moderators.id, { onDelete: 'set null' }),
    notes: text('notes'),
    attachments: jsonb('attachments').$type<unknown[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('content_schedule_ws_time_idx').on(t.workspaceId, t.scheduledAt)],
)

// --- Resources (files live in S3 under `${workspaceId}/...`) ----------------
export const resourceFolders = pgTable(
  'resource_folders',
  {
    id: id(),
    workspaceId: workspaceRef(),
    name: text('name').notNull(),
    sectionType: text('section_type').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    createdBy: userRefNullable('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('resource_folders_ws_idx').on(t.workspaceId, t.updatedAt)],
)

export const resources = pgTable(
  'resources',
  {
    id: id(),
    workspaceId: workspaceRef(),
    folderId: uuid('folder_id').references(() => resourceFolders.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['file', 'external_link'] }).notNull(),
    title: text('title').notNull(),
    description: text('description'),
    storagePath: text('storage_path'),
    externalUrl: text('external_url'),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    visibility: text('visibility', { enum: ['team', 'private'] }).notNull().default('team'),
    createdBy: userRefNullable('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('resources_ws_idx').on(t.workspaceId, t.createdAt),
    index('resources_folder_idx').on(t.folderId),
    check(
      'resources_kind_chk',
      sql`(${t.kind} = 'file' and ${t.storagePath} is not null) or (${t.kind} = 'external_link' and ${t.externalUrl} is not null)`,
    ),
  ],
)

export const resourceViews = pgTable(
  'resource_views',
  {
    id: id(),
    workspaceId: workspaceRef(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    viewerUserId: userRefNullable('viewer_user_id'),
    viewerModeratorId: uuid('viewer_moderator_id').references(() => moderators.id, { onDelete: 'set null' }),
    viewerLabel: text('viewer_label'),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('resource_views_resource_idx').on(t.resourceId, t.viewedAt), index('resource_views_ws_idx').on(t.workspaceId)],
)

// --- Reporting --------------------------------------------------------------
export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: id(),
    workspaceId: workspaceRef().unique(),
    reportType: text('report_type', { enum: ['community', 'general'] }).notNull().default('general'),
    cadence: text('cadence', { enum: ['off', 'daily', 'weekly'] }).notNull().default('off'),
    weekday: integer('weekday'),
    time: text('time').notNull().default('21:00'),
    timezone: text('timezone').notNull().default('UTC'),
    // Recipients must be verified addresses (see reports module); the raw
    // free-text `email` of the legacy schema is gone.
    recipientEmails: text('recipient_emails').array().notNull().default(sql`'{}'::text[]`),
    enabled: boolean('enabled').notNull().default(false),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    // Encrypted (lib/crypto.ts).
    slackWebhookUrlEnc: text('slack_webhook_url_enc'),
    notionTokenEnc: text('notion_token_enc'),
    notionPageId: text('notion_page_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('report_schedules_weekday_chk', sql`${t.weekday} is null or ${t.weekday} between 0 and 6`),
    check('report_schedules_time_chk', sql`${t.time} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  ],
)

// Generated reports, previously kept in the browser's localStorage.
export const reportRuns = pgTable(
  'report_runs',
  {
    id: id(),
    workspaceId: workspaceRef(),
    reportType: text('report_type').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdBy: userRefNullable('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('report_runs_ws_idx').on(t.workspaceId, t.createdAt)],
)

// Deterministic intelligence reports (modules/ai/report). The `report` blob is
// the full typed document; `input_hash` dedupes regeneration on unchanged data.
export const aiReports = pgTable(
  'ai_reports',
  {
    id: id(),
    workspaceId: workspaceRef(),
    periodKind: text('period_kind').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    inputHash: text('input_hash').notNull(),
    report: jsonb('report').$type<Record<string, unknown>>().notNull(),
    narrativeSource: text('narrative_source', { enum: ['rules', 'llm'] }).notNull().default('rules'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdBy: userRefNullable('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_reports_ws_idx').on(t.workspaceId, t.createdAt), index('ai_reports_ws_hash_idx').on(t.workspaceId, t.inputHash)],
)
export type AiReportRow = typeof aiReports.$inferSelect

// --- Governance -------------------------------------------------------------
export const usageEvents = pgTable(
  'usage_events',
  {
    id: id(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: userRefNullable('user_id'),
    eventType: text('event_type').notNull(),
    platform: text('platform'),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull().default('1'),
    unit: text('unit').notNull().default('call'),
    costHintUsd: numeric('cost_hint_usd', { precision: 10, scale: 6 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('usage_events_ws_time_idx').on(t.workspaceId, t.occurredAt),
    index('usage_events_user_type_time_idx').on(t.userId, t.eventType, t.occurredAt),
  ],
)

export const feedback = pgTable(
  'feedback',
  {
    id: id(),
    userId: userRefNullable('user_id'),
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    rating: integer('rating'),
    role: text('role'),
    status: text('status', { enum: ['pending', 'planned', 'in_progress', 'shipped', 'declined'] }).notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [index('feedback_status_idx').on(t.status), check('feedback_rating_chk', sql`${t.rating} is null or ${t.rating} between 1 and 5`)],
)

export const discoveryForms = pgTable('discovery_forms', {
  id: id(),
  slug: text('slug').notNull().unique(),
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  source: text('source'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
})

export const discoveryResponses = pgTable(
  'discovery_responses',
  {
    id: id(),
    formId: uuid('form_id').references(() => discoveryForms.id, { onDelete: 'cascade' }),
    slugSnapshot: text('slug_snapshot'),
    respondentName: text('respondent_name'),
    respondentEmail: text('respondent_email'),
    respondentRole: text('respondent_role'),
    answers: jsonb('answers').$type<Record<string, string>>().notNull(),
    userAgent: text('user_agent'),
    completionMs: integer('completion_ms'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('discovery_responses_form_idx').on(t.formId), index('discovery_responses_time_idx').on(t.submittedAt)],
)

export type Workspace = typeof workspaces.$inferSelect
export type Integration = typeof integrations.$inferSelect
export type Moderator = typeof moderators.$inferSelect
