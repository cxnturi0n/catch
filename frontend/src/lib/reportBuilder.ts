import { getActiveMembersTrend, getDailyMessages, getIncidents, getKols, getStats, getTasks } from '../data/mockData'
import type { CatchTask, KOL, ModerationIncident, TrendPoint, Workspace, WorkspaceStats } from '../types'
import { formatLongDate } from './format'
import {
  buildReportModel,
  buildUnifiedOverview,
  formatCount,
  formatMoney,
  type ModeratorChartInput,
  type PaymentSummaryInput,
  type ReportModel,
  type ReportType,
} from './reportModel'

export interface ReportSection {
  title: string
  lines: string[]
}

export interface ReportData {
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  reportType: ReportType
  periodStart: string
  periodEnd: string
  generatedAt: string
  summary: string
  sections: ReportSection[]
  recommendations: string[]
  /** Chart-ready structured view rendered by the preview / printable one-pager. */
  model: ReportModel
}

/**
 * Optional moderator-activity rollup folded into the general report. Built from
 * the compensation data (see modules/moderators/report.ts) and passed in by the
 * caller so the report builder stays synchronous and data-source agnostic.
 */
export interface ModeratorActivityInput {
  summaryLine: string
  lines: string[]
  recommendation?: string
}

/** Everything the builder needs beyond the workspace itself. */
export interface BuildReportInput {
  reportType: ReportType
  periodStart: string
  periodEnd: string
  /** Text lines for the Moderator Activity section (general only). */
  moderatorActivity?: ModeratorActivityInput
  /** Optional shift-coverage-gap section the CM can toggle into the report. */
  coverageGap?: { summaryLine: string; lines: string[]; recommendation?: string }
  /** Real workspace data from the API, overrides the empty defaults when present
   * (so signed-in / demo workspaces report their actual numbers). */
  live?: {
    stats: WorkspaceStats
    incidents: ModerationIncident[]
    kols: KOL[]
    tasks: CatchTask[]
    membersTrend: TrendPoint[]
    messagesTrend: TrendPoint[]
    /** Raw per-platform daily rollup rows, drives the cross-platform unified
     * overview. Omitted for guest / mock sessions (unified is then skipped). */
    platformRows?: { platform: string; date: string; metrics: Record<string, number> }[]
  }
  /** Chart-ready moderator rollup (general only). */
  moderator?: ModeratorChartInput
  /** Chart-ready payments rollup (general only). */
  payments?: PaymentSummaryInput
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-') || 'workspace'
  )
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${n >= 0 ? '+' : ''}${n}%`
}

function daysBetween(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  return Math.max(1, Math.round(ms / 86_400_000))
}

/** Incidents whose date falls inside the selected [start, end] window. */
function incidentsInRange(incidents: ModerationIncident[], startIso: string, endIso: string): ModerationIncident[] {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime() + 86_400_000 - 1 // inclusive of the end day
  return incidents.filter((i) => {
    const t = new Date(i.date).getTime()
    return !Number.isNaN(t) && t >= start && t <= end
  })
}

export function buildReportData(workspace: Workspace, input: BuildReportInput): ReportData {
  const { reportType, periodStart, periodEnd } = input
  const isGeneral = reportType === 'general'

  // Real data when provided, else the
  // deterministic mock dataset (guest sessions).
  const stats = input.live?.stats ?? getStats(workspace.id)
  const allIncidents = input.live?.incidents ?? getIncidents(workspace.id)
  const kols = input.live?.kols ?? getKols(workspace.id)
  const tasks = input.live?.tasks ?? getTasks(workspace.id)

  const rangeDays = daysBetween(periodStart, periodEnd)
  const incidents = incidentsInRange(allIncidents, periodStart, periodEnd)
  const membersTrend: TrendPoint[] = (input.live?.membersTrend ?? getActiveMembersTrend(workspace.id)).slice(-rangeDays)
  const messagesTrend: TrendPoint[] = (input.live?.messagesTrend ?? getDailyMessages(workspace.id)).slice(-Math.min(rangeDays, 14))

  // ── Cross-platform unified overview (real connected platforms only) ──
  // Message volume folded in when a platform tracks it (Telegram member_messages).
  const combinedMessages = (input.live?.messagesTrend ?? []).slice(-rangeDays).reduce((s, p) => s + p.value, 0)
  const unified = buildUnifiedOverview(input.live?.platformRows ?? [], combinedMessages)

  const openIncidents = incidents.filter((i) => i.status === 'Open')
  const resolvedIncidents = incidents.filter((i) => i.status === 'Resolved')
  const resolutionRate = incidents.length > 0 ? Math.round((resolvedIncidents.length / incidents.length) * 100) : null

  const typeBreakdown = incidents.reduce<Record<string, number>>((acc, i) => {
    acc[i.type] = (acc[i.type] ?? 0) + 1
    return acc
  }, {})

  const activeKols = kols.filter((k) => k.status === 'Active')
  const topKol = [...kols].sort((a, b) => b.reach - a.reach)[0]

  const doneTasks = tasks.filter((t) => t.status === 'Done')
  const pendingTasks = tasks.filter((t) => t.status !== 'Done')

  const moderatorActivity = isGeneral ? input.moderatorActivity : undefined
  const payments = isGeneral ? input.payments : undefined

  // ── Recommendations ──
  const recommendations: string[] = []
  if (isGeneral) {
    if (openIncidents.length > 0) {
      recommendations.push(
        `Prioritize closing the ${openIncidents.length} open moderation incident${openIncidents.length === 1 ? '' : 's'}, focusing on repeat scam vectors first.`,
      )
    } else {
      recommendations.push('No open incidents outstanding, maintain current moderation cadence.')
    }
  }
  if ((stats.messagesDelta ?? 0) < 0) {
    recommendations.push('Message volume dipped vs last period, consider a community engagement push (AMA, giveaway, or KOL spotlight).')
  } else {
    recommendations.push('Message volume is trending up, sustain momentum with a themed community event next week.')
  }
  recommendations.push(
    `Expand KOL coverage beyond ${activeKols.length} active partner${activeKols.length === 1 ? '' : 's'} to diversify reach across channels.`,
  )
  if (moderatorActivity?.recommendation) recommendations.push(moderatorActivity.recommendation)

  // ── Summary ──
  const unifiedLead = unified
    ? `Across ${unified.platformCount} connected platforms, Catch unifies ${formatCount(unified.totalMembers)} total subscriptions (${unified.totalMembersNote}) into one view. `
    : ''
  const summary = unifiedLead + (isGeneral
    ? `${workspace.name} closed the period with ${formatNumber(stats.activeMembers)} active members (${pct(stats.activeMembersDelta)} vs. last period) and ${formatNumber(stats.messagesWeek)} messages sent (${pct(stats.messagesDelta)}). The moderation team handled ${incidents.length} incident${incidents.length === 1 ? '' : 's'} (${resolvedIncidents.length} resolved), and ${activeKols.length} KOL partners remain actively engaged.${moderatorActivity ? ` ${moderatorActivity.summaryLine}` : ''}`
    : `${workspace.name} closed the period with ${formatNumber(stats.activeMembers)} active members (${pct(stats.activeMembersDelta)} vs. last period), ${formatNumber(stats.newMembers)} new members, and ${formatNumber(stats.messagesWeek)} messages sent (${pct(stats.messagesDelta)}). ${activeKols.length} KOL partner${activeKols.length === 1 ? '' : 's'} remain actively engaged across channels.`)

  // ── Sections (text view: plain-text export, share, history snapshot) ──
  const communityGrowth: ReportSection = {
    title: 'Community Growth',
    lines: [
      `Active members: ${formatNumber(stats.activeMembers)} (${pct(stats.activeMembersDelta)})`,
      `New members this period: ${formatNumber(stats.newMembers)} (${pct(stats.newMembersDelta)})`,
      `Messages this period: ${formatNumber(stats.messagesWeek)} (${pct(stats.messagesDelta)})`,
    ],
  }
  const kolActivity: ReportSection = {
    title: 'KOL Activity',
    lines: [
      `Active KOL partners: ${activeKols.length} of ${kols.length} total`,
      topKol
        ? `Top performer by reach: ${topKol.name} (${topKol.handle}, ${formatNumber(topKol.reach)} reach)`
        : 'No KOLs tracked yet for this workspace.',
    ],
  }

  const sections: ReportSection[] = []
  if (unified) {
    sections.push({
      title: 'Unified Overview',
      lines: [
        `Total across ${unified.platformCount} connected platforms: ${formatCount(unified.totalMembers)} (${unified.totalMembersNote})`,
        ...unified.platforms.map(
          (p) =>
            `${p.label}: ${formatCount(p.members)} ${p.memberLabel.toLowerCase()}${p.keyMetric ? ` · ${p.keyMetric.label} ${formatCount(p.keyMetric.value)}` : ''}`,
        ),
        ...(unified.combinedMessages !== undefined ? [`Combined message volume: ${formatCount(unified.combinedMessages)} (${unified.messagesNote})`] : []),
      ],
    })
  }
  sections.push(communityGrowth)
  if (isGeneral) {
    sections.push({
      title: 'Security & Moderation',
      lines: [
        `Scam alerts blocked: ${stats.scamAlertsBlocked} (${pct(stats.scamAlertsDelta)} vs last period)`,
        `Incidents logged: ${incidents.length} total, ${resolvedIncidents.length} resolved, ${openIncidents.length} open`,
        `Resolution rate: ${resolutionRate === null ? 'n/a' : `${resolutionRate}%`}`,
        `Breakdown by type: ${Object.entries(typeBreakdown).map(([type, count]) => `${type} (${count})`).join(', ') || 'none logged'}`,
      ],
    })
  }
  sections.push(kolActivity)
  if (isGeneral && moderatorActivity) {
    sections.push({ title: 'Moderator Activity', lines: moderatorActivity.lines })
  }
  if (input.coverageGap) {
    sections.push({
      title: 'Shift Coverage',
      lines: [
        input.coverageGap.summaryLine,
        ...input.coverageGap.lines,
        ...(input.coverageGap.recommendation ? [`Recommendation: ${input.coverageGap.recommendation}`] : []),
      ],
    })
  }
  if (isGeneral && payments && payments.count > 0) {
    const top = payments.byModerator.slice(0, 3)
    sections.push({
      title: 'Payments',
      lines: [
        `Total paid this period: ${formatMoney(payments.totalPaid, payments.currency)} across ${payments.count} payment${payments.count === 1 ? '' : 's'}`,
        top.length > 0 ? `Top recipients: ${top.map((m) => `${m.name} (${formatMoney(m.amount, payments.currency)})`).join(', ')}` : 'No recipients recorded.',
      ],
    })
  }
  if (isGeneral) {
    sections.push({
      title: 'Tasks Overview',
      lines: [`Completed: ${doneTasks.length} of ${tasks.length}`, `Pending (To Do / In Progress): ${pendingTasks.length}`],
    })
  }

  const model = buildReportModel({
    reportType,
    stats,
    membersTrend,
    messagesTrend,
    incidents,
    kols,
    tasks,
    moderator: input.moderator,
    payments,
    unified,
  })

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceSlug: slugify(workspace.name),
    reportType,
    periodStart,
    periodEnd,
    generatedAt: new Date().toISOString(),
    summary,
    sections,
    recommendations,
    model,
  }
}

const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  community: 'COMMUNITY ANALYTICS REPORT',
  general: 'GENERAL REPORT',
}

export function reportDataToPlainText(data: ReportData): string {
  const sectionsText = data.sections
    .map((s, i) => `${i + 2}. ${s.title.toUpperCase()}\n${s.lines.map((l) => `- ${l}`).join('\n')}`)
    .join('\n\n')

  return `${REPORT_TYPE_LABEL[data.reportType] ?? 'REPORT'}, ${data.workspaceName.toUpperCase()}
Period: ${formatLongDate(data.periodStart)}, ${formatLongDate(data.periodEnd)}

1. EXECUTIVE SUMMARY
${data.summary}

${sectionsText}

${data.sections.length + 2}. RECOMMENDATIONS
${data.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}, Generated by Catch, ${formatLongDate(data.generatedAt)}`
}

export function reportDataToHtml(data: ReportData): string {
  const periodLabel = `${formatLongDate(data.periodStart)}, ${formatLongDate(data.periodEnd)}`
  const typeLabel = data.reportType === 'community' ? 'Community Analytics Report' : 'General Report'
  const sectionsHtml = data.sections
    .map(
      (s) => `
        <section class="section">
          <h2>${escapeHtml(s.title)}</h2>
          <ul>${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
        </section>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(typeLabel)}, ${escapeHtml(data.workspaceName)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #060812;
    color: #ffffff;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 48px 24px;
  }
  .doc {
    max-width: 760px;
    margin: 0 auto;
    background: #0c1424;
    border: 1px solid #1c2b47;
    border-radius: 20px;
    overflow: hidden;
  }
  .stripe { height: 8px; background: linear-gradient(90deg, #1e3a8a, #2f7cf6, #8cc5ff); }
  .body { padding: 36px 40px; }
  .logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: linear-gradient(135deg, #1e3a8a, #2f7cf6, #8cc5ff);
    font-weight: 800;
    box-shadow: 0 0 30px rgba(47, 124, 246, 0.35);
  }
  .title { font-size: 24px; font-weight: 800; margin: 20px 0 4px; }
  .subtitle { color: #9fb2d4; font-size: 14px; margin-bottom: 32px; }
  .summary {
    background: rgba(255,255,255,0.03);
    border: 1px solid #1c2b47;
    border-radius: 14px;
    padding: 18px 20px;
    margin-bottom: 28px;
    color: #e2e8f0;
    line-height: 1.6;
  }
  .section { margin-bottom: 26px; padding-bottom: 26px; border-bottom: 1px solid #1c2b47; }
  .section:last-of-type { border-bottom: none; }
  .section h2 {
    font-size: 15px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: linear-gradient(90deg, #2f7cf6, #8cc5ff);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    margin: 0 0 12px;
  }
  .section ul { margin: 0; padding-left: 20px; color: #cbd5e1; line-height: 1.8; }
  .recommendations { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .recommendations li {
    background: rgba(47,124,246,0.08);
    border: 1px solid rgba(77,159,255,0.3);
    border-radius: 10px;
    padding: 12px 16px;
    color: #dbeafe;
  }
  .footer { margin-top: 32px; color: #6b7ba0; font-size: 12px; text-align: center; }
</style>
</head>
<body>
  <div class="doc">
    <div class="stripe"></div>
    <div class="body">
      <div class="logo">C</div>
      <div class="title">${escapeHtml(typeLabel)}, ${escapeHtml(data.workspaceName)}</div>
      <div class="subtitle">${escapeHtml(periodLabel)}</div>
      <div class="summary">${escapeHtml(data.summary)}</div>
      ${sectionsHtml}
      <section class="section">
        <h2>Recommendations</h2>
        <ul class="recommendations">${data.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
      </section>
      <div class="footer">Generated by Catch · ${escapeHtml(formatLongDate(data.generatedAt))}</div>
    </div>
    <div class="stripe"></div>
  </div>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
