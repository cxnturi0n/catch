import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { reportRuns, reportSchedules, user, workspaceMembers } from '../../db/schema/index.js'
import { decryptSecret, encryptSecret } from '../../lib/crypto.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { deliverSchedule } from './dispatch.js'
import { isSlackWebhookUrl } from './report.js'

const params = z.object({ workspaceId: z.uuid() })

const scheduleBody = z.object({
  reportType: z.enum(['community', 'general']).default('general'),
  cadence: z.enum(['off', 'daily', 'weekly']).default('off'),
  weekday: z.number().int().min(0).max(6).nullish(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('21:00'),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  recipientEmails: z.array(z.email()).max(10).default([]),
  enabled: z.boolean().default(false),
  // Secrets: null clears, undefined keeps, string replaces.
  slackWebhookUrl: z.string().trim().max(500).nullish(),
  notionToken: z.string().trim().max(200).nullish(),
  notionPageId: z.string().trim().max(64).nullish(),
})

function view(s: typeof reportSchedules.$inferSelect) {
  return {
    reportType: s.reportType,
    cadence: s.cadence,
    weekday: s.weekday ?? 0,
    time: s.time,
    timezone: s.timezone,
    recipientEmails: s.recipientEmails,
    enabled: s.enabled,
    lastSentAt: s.lastSentAt,
    // Never the secrets, only whether they are set.
    hasSlackWebhook: !!s.slackWebhookUrlEnc,
    hasNotionToken: !!s.notionTokenEnc,
    notionPageId: s.notionPageId,
  }
}

// Recipients must be members of the workspace: the legacy free-text address
// let anyone use the sender domain to mail arbitrary inboxes. Verified
// external recipients are a later addition (D-20).
async function assertRecipients(workspaceId: string, emails: string[]) {
  if (emails.length === 0) return
  const members = await db.select({ email: user.email }).from(workspaceMembers).innerJoin(user, eq(user.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, workspaceId))
  const allowed = new Set(members.map((m) => m.email.toLowerCase()))
  const bad = emails.filter((e) => !allowed.has(e.toLowerCase()))
  if (bad.length) throw badRequest(`Recipients must be workspace members: ${bad.join(', ')}`, 'RECIPIENT_NOT_ALLOWED')
}

export async function reportRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()
  const member = app.requireWorkspace
  const manage = app.requireWorkspaceRole(['owner', 'admin'])
  const base = '/workspaces/:workspaceId/reports'

  r.get(`${base}/schedule`, { preHandler: member, schema: { params } }, async (req) => {
    const [s] = await db.select().from(reportSchedules).where(eq(reportSchedules.workspaceId, req.workspace.id)).limit(1)
    return { schedule: s ? view(s) : null }
  })

  r.put(`${base}/schedule`, { preHandler: manage, schema: { params, body: scheduleBody } }, async (req) => {
    const b = req.body
    await assertRecipients(req.workspace.id, b.recipientEmails)
    if (b.slackWebhookUrl && !isSlackWebhookUrl(b.slackWebhookUrl)) throw badRequest('Slack webhook must be an https://hooks.slack.com/services/… URL', 'SLACK_URL')
    const secretSet = {
      ...(b.slackWebhookUrl !== undefined && { slackWebhookUrlEnc: b.slackWebhookUrl ? encryptSecret(b.slackWebhookUrl) : null }),
      ...(b.notionToken !== undefined && { notionTokenEnc: b.notionToken ? encryptSecret(b.notionToken) : null }),
    }
    const values = {
      reportType: b.reportType,
      cadence: b.cadence,
      weekday: b.cadence === 'weekly' ? (b.weekday ?? 0) : null,
      time: b.time,
      timezone: b.timezone,
      recipientEmails: b.recipientEmails,
      enabled: b.enabled && b.cadence !== 'off',
      notionPageId: b.notionPageId ?? null,
      ...secretSet,
    }
    const [s] = await db
      .insert(reportSchedules)
      .values({ workspaceId: req.workspace.id, ...values })
      .onConflictDoUpdate({ target: reportSchedules.workspaceId, set: { ...values, updatedAt: new Date() } })
      .returning()
    return { schedule: view(s!) }
  })

  // Delivers the report immediately to the saved targets (also validates them).
  r.post(`${base}/schedule/send-now`, { preHandler: manage, config: { rateLimit: { max: 3, timeWindow: '10 minutes' } }, schema: { params } }, async (req) => {
    const [s] = await db.select().from(reportSchedules).where(eq(reportSchedules.workspaceId, req.workspace.id)).limit(1)
    if (!s) throw notFound('Schedule')
    const result = await deliverSchedule(s)
    return result
  })

  // Generated reports (replaces localStorage history).
  const runOut = (x: typeof reportRuns.$inferSelect) => ({ id: x.id, reportType: x.reportType, periodStart: x.periodStart, periodEnd: x.periodEnd, data: x.data, createdAt: x.createdAt })
  r.get(`${base}/runs`, { preHandler: member, schema: { params } }, async (req) => {
    const rows = await db.select().from(reportRuns).where(eq(reportRuns.workspaceId, req.workspace.id)).orderBy(desc(reportRuns.createdAt)).limit(50)
    return { runs: rows.map(runOut) }
  })
  r.post(`${base}/runs`, { preHandler: member, schema: { params, body: z.object({ reportType: z.string().trim().min(1).max(40), periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), data: z.record(z.string(), z.unknown()) }) } }, async (req, reply) => {
    if (JSON.stringify(req.body.data).length > 512_000) throw badRequest('Report too large', 'TOO_LARGE')
    const [row] = await db.insert(reportRuns).values({ workspaceId: req.workspace.id, createdBy: req.auth!.user.id, ...req.body }).returning()
    // Keep the newest 50 per workspace.
    const extra = await db.select({ id: reportRuns.id }).from(reportRuns).where(eq(reportRuns.workspaceId, req.workspace.id)).orderBy(desc(reportRuns.createdAt)).offset(50)
    for (const e of extra) await db.delete(reportRuns).where(eq(reportRuns.id, e.id))
    return reply.status(201).send({ run: runOut(row!) })
  })
  r.delete(`${base}/runs/:id`, { preHandler: member, schema: { params: params.extend({ id: z.uuid() }) } }, async (req, reply) => {
    const d = await db.delete(reportRuns).where(and(eq(reportRuns.workspaceId, req.workspace.id), eq(reportRuns.id, req.params.id))).returning({ id: reportRuns.id })
    if (d.length === 0) throw notFound('Report')
    return reply.status(204).send()
  })
}

export const _decrypt = decryptSecret
