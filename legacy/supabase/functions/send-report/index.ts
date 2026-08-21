import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createServiceClient } from '../_shared/supabaseAdmin.ts'
import { renderReportEmail } from './email.ts'

// Scheduled report dispatcher (#6). Polled HOURLY by pg_cron (migration 014):
// reads every enabled report_schedules row, works out which are "due" this hour
// in their own timezone, renders each as an HTML EMAIL and sends it via Resend.
// Gated by CRON_SECRET — deploy with --no-verify-jwt.
//
//   x-cron-secret: <CRON_SECRET>   (required)
//
// ── EMAIL FEASIBILITY / LIMITS (read before relying on this) ──────────────────
//  • No JS in email: mail clients strip <script> and never run recharts, so the
//    email is built from plain HTML tables + inline-styled bar divs (see
//    email.ts) — NOT the in-app recharts preview.
//  • Deliverability needs a VERIFIED sending domain in Resend and a matching
//    REPORT_FROM_EMAIL (SPF/DKIM), or mail lands in spam / is rejected.
//  • Cron granularity is HOURLY. Schedule times therefore match on the hour;
//    the minutes are informational. last_sent_at enforces at-most-once-per-day.
//  • The UI stores schedules independently of this function — automation can be
//    configured before RESEND_API_KEY exists; only dispatch waits on the key.

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

interface ScheduleRow {
  workspace_id: string
  report_type: string
  cadence: string
  weekday: number | null
  time: string
  timezone: string
  email: string | null
  slack_webhook_url: string | null
  notion_token: string | null
  notion_page_id: string | null
  enabled: boolean
  last_sent_at: string | null
}

/** A schedule is worth dispatching if it has at least one delivery target. */
function hasAnyTarget(row: ScheduleRow): boolean {
  const hasEmail = !!row.email && !!row.email.trim()
  const hasSlack = !!row.slack_webhook_url && !!row.slack_webhook_url.trim()
  const hasNotion = !!row.notion_token && !!row.notion_token.trim() && !!row.notion_page_id && !!row.notion_page_id.trim()
  return hasEmail || hasSlack || hasNotion
}

interface LocalParts {
  hour: number
  weekday: number
  ymd: string
}

/** Wall-clock hour / weekday / date for `date` in an IANA timezone. */
function localParts(tz: string, date: Date): LocalParts {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC',
      hourCycle: 'h23',
      hour: '2-digit',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
  } catch {
    // Unknown timezone → fall back to UTC so a bad value never crashes dispatch.
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hourCycle: 'h23',
      hour: '2-digit',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    hour: Number(get('hour')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

function isDue(row: ScheduleRow, now: Date): boolean {
  if (!row.enabled || row.cadence === 'off' || !hasAnyTarget(row)) return false
  const nowParts = localParts(row.timezone, now)
  const scheduledHour = Number((row.time || '00:00').split(':')[0])
  if (nowParts.hour !== scheduledHour) return false
  if (row.cadence === 'weekly' && (row.weekday ?? 0) !== nowParts.weekday) return false
  // Dedupe: skip if we already sent on this local calendar day.
  if (row.last_sent_at) {
    const sentParts = localParts(row.timezone, new Date(row.last_sent_at))
    if (sentParts.ymd === nowParts.ymd) return false
  }
  return true
}

interface WorkspaceReport {
  workspaceName: string
  reportType: 'community' | 'general'
  periodStart: string
  periodEnd: string
  members: number | null
  incidentsTotal: number
  incidentsResolved: number
  incidentsByType: { label: string; value: number }[]
  tasksByStatus: { label: string; value: number }[]
  paymentsTotal: number
  paymentsCurrency: string
  paymentsCount: number
  moderatorCount: number
}

type ServiceClient = ReturnType<typeof createServiceClient>

/** Assemble a report from the workspace's REAL Supabase data (no mock/demo). */
async function gatherReport(
  supabase: ServiceClient,
  workspaceId: string,
  reportType: 'community' | 'general',
  periodStart: string,
  periodEnd: string,
): Promise<WorkspaceReport | null> {
  const { data: ws } = await supabase.from('workspaces').select('name').eq('id', workspaceId).maybeSingle()
  if (!ws) return null

  const startDay = periodStart.slice(0, 10)
  const endDay = periodEnd.slice(0, 10)

  // Latest members across connected platforms (most recent daily row per platform).
  let members: number | null = null
  const { data: metricRows } = await supabase
    .from('platform_metrics')
    .select('platform, date, metrics')
    .eq('workspace_id', workspaceId)
    .order('date', { ascending: false })
    .limit(20)
  if (metricRows && metricRows.length > 0) {
    const latestByPlatform = new Map<string, { date: string; metrics: Record<string, number> }>()
    for (const r of metricRows as { platform: string; date: string; metrics: Record<string, number> }[]) {
      if (!latestByPlatform.has(r.platform)) latestByPlatform.set(r.platform, { date: r.date, metrics: r.metrics ?? {} })
    }
    let sum = 0
    let has = false
    for (const v of latestByPlatform.values()) {
      if (typeof v.metrics.members === 'number') {
        sum += v.metrics.members
        has = true
      }
    }
    members = has ? sum : null
  }

  const report: WorkspaceReport = {
    workspaceName: ws.name as string,
    reportType,
    periodStart,
    periodEnd,
    members,
    incidentsTotal: 0,
    incidentsResolved: 0,
    incidentsByType: [],
    tasksByStatus: [],
    paymentsTotal: 0,
    paymentsCurrency: 'USD',
    paymentsCount: 0,
    moderatorCount: 0,
  }

  if (reportType === 'general') {
    const { data: incidents } = await supabase
      .from('incidents')
      .select('type, status, date')
      .eq('workspace_id', workspaceId)
      .gte('date', startDay)
      .lte('date', endDay)
    const inc = (incidents ?? []) as { type: string; status: string }[]
    report.incidentsTotal = inc.length
    report.incidentsResolved = inc.filter((i) => i.status === 'Resolved').length
    const byType = new Map<string, number>()
    for (const i of inc) byType.set(i.type, (byType.get(i.type) ?? 0) + 1)
    report.incidentsByType = [...byType.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)

    const { data: tasks } = await supabase.from('tasks').select('status').eq('workspace_id', workspaceId)
    const t = (tasks ?? []) as { status: string }[]
    const byStatus = new Map<string, number>()
    for (const row of t) byStatus.set(row.status ?? 'To Do', (byStatus.get(row.status ?? 'To Do') ?? 0) + 1)
    report.tasksByStatus = ['Done', 'In Progress', 'To Do']
      .map((label) => ({ label, value: byStatus.get(label) ?? 0 }))
      .filter((s) => s.value > 0)

    const { data: mods } = await supabase.from('moderators').select('id').eq('workspace_id', workspaceId)
    report.moderatorCount = (mods ?? []).length

    const { data: payments } = await supabase
      .from('payments')
      .select('amount, currency, paid_at')
      .eq('workspace_id', workspaceId)
      .gte('paid_at', periodStart)
      .lte('paid_at', periodEnd)
    const pays = (payments ?? []) as { amount: number; currency: string }[]
    report.paymentsCount = pays.length
    report.paymentsTotal = pays.reduce((s, p) => s + Number(p.amount), 0)
    if (pays.length > 0 && pays[0].currency) report.paymentsCurrency = pays[0].currency
  }

  return report
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not set' }
  const from = Deno.env.get('REPORT_FROM_EMAIL') ?? 'Catch <onboarding@resend.dev>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `resend ${res.status}: ${body.slice(0, 200)}` }
  }
  return { ok: true }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Shared-secret gate — only the scheduler (which knows CRON_SECRET) may run this.
  const expected = Deno.env.get('CRON_SECRET')
  if (!expected || req.headers.get('x-cron-secret') !== expected) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
  }

  try {
    const supabase = createServiceClient()
    const now = new Date()

    const { data, error } = await supabase
      .from('report_schedules')
      .select('workspace_id, report_type, cadence, weekday, time, timezone, email, slack_webhook_url, notion_token, notion_page_id, enabled, last_sent_at')
      .eq('enabled', true)
    if (error) return jsonResponse({ success: false, error: error.message }, 500)

    const rows = (data ?? []) as ScheduleRow[]
    const due = rows.filter((r) => isDue(r, now))

    let sent = 0
    let failed = 0
    const errors: string[] = []

    for (const row of due) {
      const reportType = row.report_type === 'community' ? 'community' : 'general'
      const windowDays = row.cadence === 'weekly' ? 7 : 1
      const periodEnd = now.toISOString()
      const periodStart = new Date(now.getTime() - windowDays * 86_400_000).toISOString()

      const report = await gatherReport(supabase, row.workspace_id, reportType, periodStart, periodEnd)
      if (!report) {
        failed++
        continue
      }

      let anyDelivered = false

      // Email channel — only when a recipient is set AND Resend is configured.
      if (row.email && row.email.trim()) {
        const html = renderReportEmail(report)
        const subject = `${reportType === 'community' ? 'Community Analytics' : 'General'} Report — ${report.workspaceName}`
        const result = await sendEmail(row.email, subject, html)
        if (result.ok) anyDelivered = true
        else if (result.error) errors.push(result.error)
      }

      // Slack / Notion channel — delegated to send-report-webhook, which pulls
      // this schedule's own webhook/token from the row (per-workspace, no global
      // account needed). Same CRON_SECRET gate; failures are non-fatal.
      const hasSlack = !!row.slack_webhook_url && !!row.slack_webhook_url.trim()
      const hasNotion = !!row.notion_token && !!row.notion_token.trim() && !!row.notion_page_id && !!row.notion_page_id.trim()
      if (hasSlack || hasNotion) {
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!
          const res = await fetch(`${supabaseUrl}/functions/v1/send-report-webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-cron-secret': expected },
            body: JSON.stringify({ workspaceId: row.workspace_id }),
          })
          const wb = await res.json().catch(() => ({}))
          if (res.ok && wb?.success && Array.isArray(wb.delivered) && wb.delivered.length > 0) {
            anyDelivered = true
          } else if (Array.isArray(wb?.errors) && wb.errors.length > 0) {
            errors.push(...wb.errors.map((e: string) => `webhook: ${e}`))
          }
        } catch (err) {
          errors.push(`webhook: ${err instanceof Error ? err.message : 'call failed'}`)
        }
      }

      if (anyDelivered) {
        sent++
        await supabase.from('report_schedules').update({ last_sent_at: now.toISOString() }).eq('workspace_id', row.workspace_id)
      } else {
        failed++
      }
    }

    return jsonResponse({ success: true, checked: rows.length, due: due.length, sent, failed, errors, at: now.toISOString() })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
