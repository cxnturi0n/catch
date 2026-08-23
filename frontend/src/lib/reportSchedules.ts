// Email-automation schedule persistence for the Report module (#6).
//
// One schedule row per workspace (unique workspace_id → upsert). Guest-safe by
// construction: every function here talks to the API, so callers must only
// invoke them for a signed-in user with a real (non-local) workspace. Backed by
// migration 014 (owner RLS + grants). The UI stores schedules even before the
// `send-report` edge function / RESEND_API_KEY exist, dispatch is a separate,
// server-side concern.

import type { ReportType } from './reportModel'

export type ReportCadence = 'off' | 'daily' | 'weekly'

export interface ReportSchedule {
  reportType: ReportType
  cadence: ReportCadence
  /** 0 (Sunday), 6 (Saturday); only meaningful for the weekly cadence. */
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



/** Load the workspace's schedule, or null when none has been saved yet. */
/** Create or update the workspace's schedule (one row per workspace). */

export { fetchReportSchedule, upsertReportSchedule, sendReportNow, SECRET_KEPT } from './api/misc'
