import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { incidents, moderators, payments, platformMetrics, tasks, workspaces } from '../../db/schema/index.js'
import { upstreamFetch } from '../../integrations/types.js'

// Report assembly + renderers, shared by the scheduled dispatcher and the
// "send now" endpoint. Only real workspace data; nothing estimated.

export interface WorkspaceReport {
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

export async function gatherReport(workspaceId: string, reportType: 'community' | 'general', periodStart: Date, periodEnd: Date): Promise<WorkspaceReport | null> {
  const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
  if (!ws) return null
  const report: WorkspaceReport = {
    workspaceName: ws.name,
    reportType,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    members: null,
    incidentsTotal: 0,
    incidentsResolved: 0,
    incidentsByType: [],
    tasksByStatus: [],
    paymentsTotal: 0,
    paymentsCurrency: 'USD',
    paymentsCount: 0,
    moderatorCount: 0,
  }

  const metricRows = await db.select({ platform: platformMetrics.platform, date: platformMetrics.date, metrics: platformMetrics.metrics }).from(platformMetrics).where(eq(platformMetrics.workspaceId, workspaceId)).orderBy(desc(platformMetrics.date)).limit(20)
  const latest = new Map<string, Record<string, unknown>>()
  for (const r of metricRows) if (!latest.has(r.platform)) latest.set(r.platform, r.metrics)
  let sum = 0
  let has = false
  for (const m of latest.values()) {
    if (typeof m.members === 'number') {
      sum += m.members
      has = true
    }
  }
  report.members = has ? sum : null

  if (reportType === 'general') {
    const startDay = periodStart.toISOString().slice(0, 10)
    const endDay = periodEnd.toISOString().slice(0, 10)
    const inc = await db.select({ type: incidents.type, status: incidents.status }).from(incidents).where(and(eq(incidents.workspaceId, workspaceId), gte(incidents.date, startDay), lte(incidents.date, endDay)))
    report.incidentsTotal = inc.length
    report.incidentsResolved = inc.filter((i) => i.status === 'Resolved').length
    const byType = new Map<string, number>()
    for (const i of inc) byType.set(i.type, (byType.get(i.type) ?? 0) + 1)
    report.incidentsByType = [...byType.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)

    const t = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.workspaceId, workspaceId))
    const byStatus = new Map<string, number>()
    for (const row of t) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1)
    report.tasksByStatus = ['Done', 'Review', 'In Progress', 'To Do'].map((label) => ({ label, value: byStatus.get(label) ?? 0 })).filter((s) => s.value > 0)

    const mods = await db.select({ id: moderators.id }).from(moderators).where(eq(moderators.workspaceId, workspaceId))
    report.moderatorCount = mods.length

    const pays = await db.select({ amount: payments.amount, currency: payments.currency }).from(payments).where(and(eq(payments.workspaceId, workspaceId), gte(payments.paidAt, periodStart), lte(payments.paidAt, periodEnd)))
    report.paymentsCount = pays.length
    report.paymentsTotal = pays.reduce((s, p) => s + Number(p.amount), 0)
    if (pays[0]?.currency) report.paymentsCurrency = pays[0].currency
  }
  return report
}

// ---- renderers --------------------------------------------------------------
const SERIES = ['#2f7cf6', '#8cc5ff', '#1e3a8a', '#6db3ff', '#14276b', '#4d9fff']
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmtNum = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function kpiCell(label: string, value: string) {
  return `<td style="padding:8px;border:1px solid #1c2b47;border-radius:8px;background:#0c1424;"><div style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#9fb2d4;">${esc(label)}</div><div style="font-size:18px;font-weight:700;color:#ffffff;">${esc(value)}</div></td>`
}
function barTable(title: string, rows: { label: string; value: number }[]) {
  if (rows.length === 0) return ''
  const max = Math.max(...rows.map((r) => r.value), 1)
  const total = rows.reduce((s, r) => s + r.value, 0)
  const body = rows
    .map((r, i) => {
      const w = Math.max(4, Math.round((r.value / max) * 100))
      const share = total > 0 ? Math.round((r.value / total) * 100) : 0
      return `<tr><td style="width:38%;padding:4px 8px 4px 0;font-size:13px;color:#cbd5e1;">${esc(r.label)}</td><td style="padding:4px 0;"><div style="background:#0c1424;border-radius:6px;overflow:hidden;"><div style="width:${w}%;background:${SERIES[i % SERIES.length]};height:14px;border-radius:6px;"></div></div></td><td style="width:64px;padding:4px 0 4px 8px;font-size:12px;color:#ffffff;text-align:right;">${fmtNum(r.value)} · ${share}%</td></tr>`
    })
    .join('')
  return `<div style="margin:0 0 20px;"><div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#8cc5ff;margin-bottom:8px;">${esc(title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></div>`
}

export function reportTitle(r: WorkspaceReport) {
  return r.reportType === 'community' ? 'Community Analytics Report' : 'General Report'
}

export function renderReportEmail(r: WorkspaceReport): { html: string; text: string } {
  const typeLabel = reportTitle(r)
  const periodLabel = `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}`
  const kpis: [string, string][] = []
  if (r.members != null) kpis.push(['Members', fmtNum(r.members)])
  if (r.reportType === 'general') {
    kpis.push(['Incidents', `${r.incidentsResolved}/${r.incidentsTotal}`], ['Moderators', fmtNum(r.moderatorCount)])
    if (r.paymentsTotal > 0) kpis.push(['Payout', `${fmtNum(r.paymentsTotal)} ${r.paymentsCurrency}`])
  }
  if (kpis.length === 0) kpis.push(['Workspace', r.workspaceName])
  const summary =
    r.reportType === 'general'
      ? `${r.workspaceName} handled ${r.incidentsTotal} moderation incident${r.incidentsTotal === 1 ? '' : 's'} (${r.incidentsResolved} resolved) this period, with ${r.moderatorCount} moderator${r.moderatorCount === 1 ? '' : 's'} on the roster${r.paymentsTotal > 0 ? ` and ${fmtNum(r.paymentsTotal)} ${r.paymentsCurrency} paid out` : ''}.`
      : `${r.workspaceName} community snapshot for ${periodLabel}.${r.members != null ? ` Currently tracking ${fmtNum(r.members)} members across connected platforms.` : ''}`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/></head><body style="margin:0;background:#060812;padding:24px 12px;font-family:Inter,Arial,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#0c1424;border:1px solid #1c2b47;border-radius:16px;overflow:hidden;"><tr><td style="height:8px;background-image:linear-gradient(90deg,#1e3a8a,#2f7cf6,#8cc5ff);font-size:0;">&nbsp;</td></tr><tr><td style="padding:28px 32px;"><div style="font-size:18px;font-weight:800;color:#ffffff;">${esc(typeLabel)}</div><div style="font-size:13px;color:#9fb2d4;">${esc(r.workspaceName)} · ${esc(periodLabel)}</div><p style="margin:20px 0;padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid #1c2b47;border-radius:12px;font-size:14px;line-height:1.6;color:#e2e8f0;">${esc(summary)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 0 20px;"><tr>${kpis.map(([l, v]) => kpiCell(l, v)).join('')}</tr></table>${r.reportType === 'general' ? barTable('Incidents by type', r.incidentsByType) + barTable('Tasks by status', r.tasksByStatus) : ''}<div style="margin-top:8px;font-size:12px;color:#6b7ba0;text-align:center;">Generated by Catch · ${esc(fmtDate(new Date().toISOString()))}</div></td></tr></table></td></tr></table></body></html>`
  return { html, text: renderReportText(r) }
}

export function renderReportText(r: WorkspaceReport): string {
  const lines = [`${reportTitle(r)} — ${r.workspaceName}`, `Period: ${r.periodStart.slice(0, 10)} → ${r.periodEnd.slice(0, 10)}`, '']
  if (r.members != null) lines.push(`Members: ${r.members}`)
  if (r.reportType === 'general') {
    lines.push(`Incidents: ${r.incidentsTotal} (resolved ${r.incidentsResolved})`)
    if (r.incidentsByType.length) lines.push('By type: ' + r.incidentsByType.map((i) => `${i.label} ${i.value}`).join(', '))
    if (r.tasksByStatus.length) lines.push('Tasks: ' + r.tasksByStatus.map((t) => `${t.label} ${t.value}`).join(', '))
    lines.push(`Moderators: ${r.moderatorCount}`)
    if (r.paymentsCount > 0) lines.push(`Payments: ${r.paymentsCount} totalling ${r.paymentsTotal} ${r.paymentsCurrency}`)
  }
  return lines.join('\n')
}

// ---- deliveries -------------------------------------------------------------
// Slack webhooks only ever live on hooks.slack.com: the allow-list closes the
// SSRF the legacy function had (any URL was fetched from the server).
export function isSlackWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'hooks.slack.com' && u.pathname.startsWith('/services/')
  } catch {
    return false
  }
}

export async function sendSlack(webhookUrl: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSlackWebhookUrl(webhookUrl)) return { ok: false, error: 'slack: webhook host not allowed' }
  // Slack mrkdwn control sequences in user-provided names are neutralised.
  const safe = text.replace(/<!(channel|here|everyone)>/gi, '')
  const res = await upstreamFetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: safe }) }).catch(() => null)
  if (!res) return { ok: false, error: 'slack: request failed' }
  return res.ok ? { ok: true } : { ok: false, error: `slack ${res.status}` }
}

const NOTION_PAGE_ID = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i
export async function sendNotion(token: string, pageId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!NOTION_PAGE_ID.test(pageId)) return { ok: false, error: 'notion: invalid page id' }
  const res = await upstreamFetch(`https://api.notion.com/v1/blocks/${encodeURIComponent(pageId)}/children`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }] } }] }),
  }).catch(() => null)
  if (!res) return { ok: false, error: 'notion: request failed' }
  return res.ok ? { ok: true } : { ok: false, error: `notion ${res.status}` }
}

export const _in = inArray
