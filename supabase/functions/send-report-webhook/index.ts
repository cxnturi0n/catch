import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createServiceClient } from '../_shared/supabaseAdmin.ts'

// Report delivery to Slack + Notion (companion to `send-report`, which handles
// email). Slack incoming webhooks and the Notion API cannot be called from the
// browser (CORS + the secret would leak), so this runs server-side.
//
// Invoked with a JSON body `{ workspaceId }` (or `{ scheduleId }`): it loads
// that single schedule row, assembles the workspace's REAL report from Supabase,
// renders it as plain text, and — for each channel whose config is present —
// pushes it. Missing config for a channel is skipped, never fatal.
//   • Slack: POST { text } to slack_webhook_url (incoming webhook).
//   • Notion: append a paragraph block to notion_page_id via the Notion API,
//     header `Authorization: Bearer <notion_token>`, `Notion-Version: 2022-06-28`.
//
// Gated by CRON_SECRET (same shared-secret pattern as send-report) so only the
// trusted caller can trigger a server-side delivery. Deploy with --no-verify-jwt.
//   x-cron-secret: <CRON_SECRET>   (required)

interface ScheduleRow {
  workspace_id: string
  report_type: string
  cadence: string
  weekday: number | null
  time: string
  timezone: string
  slack_webhook_url: string | null
  notion_token: string | null
  notion_page_id: string | null
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

/** Render the report as plain text — good for both Slack and a Notion paragraph. */
function renderReportText(report: WorkspaceReport): string {
  const title = report.reportType === 'community' ? 'Community Analytics Report' : 'General Report'
  const period = `${report.periodStart.slice(0, 10)} → ${report.periodEnd.slice(0, 10)}`
  const lines: string[] = [`*${title}* — ${report.workspaceName}`, `Period: ${period}`, '']

  if (report.members != null) lines.push(`Members: ${report.members}`)

  if (report.reportType === 'general') {
    lines.push(`Incidents: ${report.incidentsTotal} (resolved ${report.incidentsResolved})`)
    if (report.incidentsByType.length > 0) {
      lines.push('By type: ' + report.incidentsByType.map((i) => `${i.label} ${i.value}`).join(', '))
    }
    if (report.tasksByStatus.length > 0) {
      lines.push('Tasks: ' + report.tasksByStatus.map((t) => `${t.label} ${t.value}`).join(', '))
    }
    lines.push(`Moderators: ${report.moderatorCount}`)
    if (report.paymentsCount > 0) {
      lines.push(`Payments: ${report.paymentsCount} totalling ${report.paymentsTotal} ${report.paymentsCurrency}`)
    }
  }

  return lines.join('\n')
}

/** POST the report to a Slack incoming webhook. */
async function sendSlack(webhookUrl: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `slack ${res.status}: ${body.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `slack: ${err instanceof Error ? err.message : 'request failed'}` }
  }
}

/** Append a paragraph block with the report text to a Notion page. */
async function sendNotion(token: string, pageId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              // Notion caps a single rich_text content at 2000 chars.
              rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }],
            },
          },
        ],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `notion ${res.status}: ${body.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `notion: ${err instanceof Error ? err.message : 'request failed'}` }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Shared-secret gate — only a trusted caller (which knows CRON_SECRET) may run this.
  const expected = Deno.env.get('CRON_SECRET')
  if (!expected || req.headers.get('x-cron-secret') !== expected) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
  }

  let body: { workspaceId?: string; scheduleId?: string } = {}
  try {
    body = await req.json()
  } catch {
    // Empty/invalid body is fine as long as an identifier is otherwise absent → 400 below.
  }
  const workspaceId = body.workspaceId?.trim()
  const scheduleId = body.scheduleId?.trim()
  if (!workspaceId && !scheduleId) {
    return jsonResponse({ success: false, error: 'workspaceId or scheduleId is required' }, 400)
  }

  try {
    const supabase = createServiceClient()

    const query = supabase
      .from('report_schedules')
      .select(
        'workspace_id, report_type, cadence, weekday, time, timezone, slack_webhook_url, notion_token, notion_page_id',
      )
    const { data, error } = await (scheduleId
      ? query.eq('id', scheduleId)
      : query.eq('workspace_id', workspaceId!)
    ).maybeSingle()
    if (error) return jsonResponse({ success: false, error: error.message }, 500)
    if (!data) return jsonResponse({ success: false, error: 'Schedule not found' }, 404)

    const row = data as ScheduleRow
    const hasSlack = Boolean(row.slack_webhook_url && row.slack_webhook_url.trim())
    const hasNotion = Boolean(
      row.notion_token && row.notion_token.trim() && row.notion_page_id && row.notion_page_id.trim(),
    )
    if (!hasSlack && !hasNotion) {
      return jsonResponse({ success: true, delivered: [], skipped: ['slack', 'notion'], note: 'No Slack/Notion config on this schedule' })
    }

    const reportType = row.report_type === 'community' ? 'community' : 'general'
    const windowDays = row.cadence === 'weekly' ? 7 : 1
    const now = new Date()
    const periodEnd = now.toISOString()
    const periodStart = new Date(now.getTime() - windowDays * 86_400_000).toISOString()

    const report = await gatherReport(supabase, row.workspace_id, reportType, periodStart, periodEnd)
    if (!report) return jsonResponse({ success: false, error: 'Workspace not found' }, 404)

    const text = renderReportText(report)

    const delivered: string[] = []
    const skipped: string[] = []
    const errors: string[] = []

    if (hasSlack) {
      const r = await sendSlack(row.slack_webhook_url!, text)
      if (r.ok) delivered.push('slack')
      else if (r.error) errors.push(r.error)
    } else {
      skipped.push('slack')
    }

    if (hasNotion) {
      const r = await sendNotion(row.notion_token!, row.notion_page_id!, text)
      if (r.ok) delivered.push('notion')
      else if (r.error) errors.push(r.error)
    } else {
      skipped.push('notion')
    }

    return jsonResponse({ success: errors.length === 0, delivered, skipped, errors, at: now.toISOString() })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
