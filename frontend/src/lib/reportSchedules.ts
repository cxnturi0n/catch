// Email-automation schedule persistence for the Report module (#6).
//
// One schedule row per workspace (unique workspace_id → upsert). Guest-safe by
// construction: every function here talks to Supabase, so callers must only
// invoke them for a signed-in user with a real (non-local) workspace. Backed by
// migration 014 (owner RLS + grants). The UI stores schedules even before the
// `send-report` edge function / RESEND_API_KEY exist — dispatch is a separate,
// server-side concern.

import { supabase } from './supabase'
import type { ReportType } from './reportModel'
import type { WorkspaceId } from '../types'

export type ReportCadence = 'off' | 'daily' | 'weekly'

export interface ReportSchedule {
  reportType: ReportType
  cadence: ReportCadence
  /** 0 (Sunday) – 6 (Saturday); only meaningful for the weekly cadence. */
  weekday: number
  /** "HH:MM" 24h, interpreted in `timezone`. */
  time: string
  timezone: string
  email: string
  enabled: boolean
  /** Slack incoming-webhook URL. Optional; delivered server-side (edge function). */
  slackWebhookUrl: string
  /** Notion integration token, paired with `notionPageId`. Server-side only. */
  notionToken: string
  /** Notion page id the report block is appended to. */
  notionPageId: string
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function defaultSchedule(email = ''): ReportSchedule {
  return {
    reportType: 'general',
    cadence: 'off',
    weekday: 0,
    time: '21:00',
    timezone: guessTimezone(),
    email,
    enabled: false,
    slackWebhookUrl: '',
    notionToken: '',
    notionPageId: '',
  }
}

/** Best-effort browser timezone; falls back to UTC where unavailable. */
export function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

interface ScheduleRow {
  workspace_id: string
  report_type: string
  cadence: string
  weekday: number | null
  time: string
  timezone: string
  email: string | null
  enabled: boolean
  slack_webhook_url: string | null
  notion_token: string | null
  notion_page_id: string | null
}

function mapRow(row: ScheduleRow): ReportSchedule {
  return {
    reportType: (row.report_type === 'community' ? 'community' : 'general') as ReportType,
    cadence: (['off', 'daily', 'weekly'].includes(row.cadence) ? row.cadence : 'off') as ReportCadence,
    weekday: row.weekday ?? 0,
    time: row.time ?? '21:00',
    timezone: row.timezone ?? 'UTC',
    email: row.email ?? '',
    enabled: Boolean(row.enabled),
    slackWebhookUrl: row.slack_webhook_url ?? '',
    notionToken: row.notion_token ?? '',
    notionPageId: row.notion_page_id ?? '',
  }
}

/** Load the workspace's schedule, or null when none has been saved yet. */
export async function fetchReportSchedule(workspaceId: WorkspaceId): Promise<ReportSchedule | null> {
  const { data, error } = await supabase
    .from('report_schedules')
    .select(
      'workspace_id, report_type, cadence, weekday, time, timezone, email, enabled, slack_webhook_url, notion_token, notion_page_id',
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapRow(data as ScheduleRow) : null
}

/** Create or update the workspace's schedule (one row per workspace). */
export async function upsertReportSchedule(workspaceId: WorkspaceId, schedule: ReportSchedule): Promise<void> {
  const { error } = await supabase.from('report_schedules').upsert(
    {
      workspace_id: workspaceId,
      report_type: schedule.reportType,
      cadence: schedule.cadence,
      weekday: schedule.cadence === 'weekly' ? schedule.weekday : null,
      time: schedule.time,
      timezone: schedule.timezone,
      email: schedule.email || null,
      enabled: schedule.enabled && schedule.cadence !== 'off',
      slack_webhook_url: schedule.slackWebhookUrl?.trim() || null,
      notion_token: schedule.notionToken?.trim() || null,
      notion_page_id: schedule.notionPageId?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  )
  if (error) throw new Error(error.message)
}
