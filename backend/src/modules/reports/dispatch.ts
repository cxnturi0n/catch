import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { reportSchedules } from '../../db/schema/index.js'

type ReportSchedule = typeof reportSchedules.$inferSelect
import { sendEmail } from '../../email/sender.js'
import { decryptSecret } from '../../lib/crypto.js'
import { logger } from '../../logger.js'
import { gatherReport, renderReportEmail, renderReportText, reportTitle, sendNotion, sendSlack } from './report.js'
import { buildReport } from '../ai/report/build.js'
import { user, workspaces } from '../../db/schema/index.js'
import type { PlanTier } from '../../lib/quota.js'

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function localParts(tz: string, date: Date) {
  const fmt = (zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = fmt(tz || 'UTC')
  } catch {
    parts = fmt('UTC')
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { hour: Number(get('hour')), weekday: WEEKDAY_INDEX[get('weekday')] ?? 0, ymd: `${get('year')}-${get('month')}-${get('day')}` }
}

export function hasTarget(s: ReportSchedule): boolean {
  return s.recipientEmails.length > 0 || !!s.slackWebhookUrlEnc || (!!s.notionTokenEnc && !!s.notionPageId)
}

export function isDue(s: ReportSchedule, now: Date): boolean {
  if (!s.enabled || s.cadence === 'off' || !hasTarget(s)) return false
  const np = localParts(s.timezone, now)
  if (np.hour !== Number(s.time.split(':')[0])) return false
  if (s.cadence === 'weekly' && (s.weekday ?? 0) !== np.weekday) return false
  if (s.lastSentAt && localParts(s.timezone, s.lastSentAt).ymd === np.ymd) return false
  return true
}

export interface DeliveryResult {
  email: number
  slack: boolean | null
  notion: boolean | null
  errors: string[]
}

// Sends one schedule now (used by the hourly dispatcher and "send test").
export async function deliverSchedule(s: ReportSchedule, now = new Date()): Promise<DeliveryResult> {
  const periodEnd = now
  const periodStart = new Date(now.getTime() - (s.cadence === 'weekly' ? 7 : 1) * 86_400_000)
  const report = await gatherReport(s.workspaceId, s.reportType, periodStart, periodEnd)
  const out: DeliveryResult = { email: 0, slack: null, notion: null, errors: [] }
  if (!report) {
    out.errors.push('workspace not found')
    return out
  }
  // Attach the deterministic narrative (AI when the owner's plan has quota
  // left, rule text otherwise). Never blocks delivery.
  try {
    const [ws] = await db.select({ id: workspaces.id, name: workspaces.name, plan: user.plan }).from(workspaces).innerJoin(user, eq(user.id, workspaces.ownerId)).where(eq(workspaces.id, s.workspaceId)).limit(1)
    if (ws) {
      const iso = (d: Date) => d.toISOString().slice(0, 10)
      const r = await buildReport({ workspace: { id: ws.id, name: ws.name }, period: 'custom', range: { start: iso(periodStart), end: iso(new Date(periodEnd.getTime() - 86_400_000)) }, scope: s.reportType === 'general' ? 'moderation' : 'overview', userId: null, plan: (ws.plan ?? 'starter') as PlanTier, now })
      report.narrative = { summary: r.report.summary, recommendations: r.report.recommendations.slice(0, 3).map((x) => ({ title: x.title, priority: x.priority })), source: r.report.narrativeSource }
    }
  } catch (err) {
    logger.warn({ err, workspaceId: s.workspaceId }, 'report narrative unavailable for scheduled delivery')
  }
  const subject = `${reportTitle(report)}, ${report.workspaceName}`
  const { html, text } = renderReportEmail(report)
  for (const to of s.recipientEmails) {
    try {
      await sendEmail({ to, subject, html, text })
      out.email++
    } catch (err) {
      out.errors.push(`email ${to}: ${err instanceof Error ? err.message : 'failed'}`)
    }
  }
  const plain = renderReportText(report)
  if (s.slackWebhookUrlEnc) {
    const r = await sendSlack(decryptSecret(s.slackWebhookUrlEnc), plain)
    out.slack = r.ok
    if (!r.ok && r.error) out.errors.push(r.error)
  }
  if (s.notionTokenEnc && s.notionPageId) {
    const r = await sendNotion(decryptSecret(s.notionTokenEnc), s.notionPageId, plain)
    out.notion = r.ok
    if (!r.ok && r.error) out.errors.push(r.error)
  }
  return out
}

// Hourly worker job: deliver every schedule whose local hour has arrived.
export async function dispatchDueReports(now = new Date()) {
  const all = await db.select().from(reportSchedules).where(eq(reportSchedules.enabled, true))
  let sent = 0
  const errors: string[] = []
  for (const s of all) {
    if (!isDue(s, now)) continue
    const r = await deliverSchedule(s, now)
    if (r.email > 0 || r.slack || r.notion) {
      sent++
      await db.update(reportSchedules).set({ lastSentAt: now }).where(eq(reportSchedules.id, s.id))
    }
    if (r.errors.length) {
      errors.push(...r.errors.map((e) => `${s.workspaceId}: ${e}`))
      logger.warn({ workspaceId: s.workspaceId, errors: r.errors }, 'report delivery errors')
    }
  }
  return { checked: all.length, sent, errors }
}
