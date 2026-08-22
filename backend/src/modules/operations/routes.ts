import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { contentSchedule, incidents, kols, meetings, moderators, PLATFORMS, tasks } from '../../db/schema/index.js'
import { badRequest, notFound } from '../../lib/errors.js'

// Tasks, meetings and the content schedule: plain workspace-scoped CRUD.

const params = z.object({ workspaceId: z.uuid() })
const idParams = params.extend({ id: z.uuid() })
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
const sinceQuery = z.object({ sinceDays: z.coerce.number().int().min(1).max(3650).default(60) })

const taskBody = z.object({
  title: z.string().trim().min(1).max(300),
  assignee: z.string().trim().max(120).nullish(),
  area: z.string().trim().max(60).nullish(),
  priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).default('Medium'),
  status: z.enum(['To Do', 'In Progress', 'Review', 'Done']).default('To Do'),
  startDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
})

const meetingBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).nullish(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    meetLink: z.url().max(500).nullish(),
    attendeeEmails: z.array(z.email()).max(100).default([]),
    attendeeModeratorIds: z.array(z.uuid()).max(200).default([]),
    provider: z.enum(['google', 'outlook', 'other']).default('google'),
  })
  .refine((m) => new Date(m.endsAt) > new Date(m.startsAt), { message: 'endsAt must be after startsAt', path: ['endsAt'] })

const incidentBody = z.object({
  date: isoDate.optional(),
  type: z.string().trim().min(1).max(60),
  channel: z.string().trim().min(1).max(60),
  actionTaken: z.string().trim().max(2000).nullish(),
  status: z.enum(['Open', 'Resolved', 'Escalated']).default('Open'),
})
const kolBody = z.object({
  name: z.string().trim().min(1).max(120),
  handle: z.string().trim().max(120).nullish(),
  channel: z.string().trim().max(40).nullish(),
  reach: z.number().int().min(0).max(1_000_000_000).default(0),
  status: z.string().trim().max(40).default('Pending'),
  lastActivity: isoDate.nullish(),
  notes: z.string().trim().max(5000).nullish(),
})

const contentBody = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullish(),
  platform: z.enum(PLATFORMS).nullish(),
  scheduledAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullish(),
  status: z.enum(['scheduled', 'published', 'cancelled']).default('scheduled'),
  assignedModeratorId: z.uuid().nullish(),
  notes: z.string().trim().max(5000).nullish(),
  attachments: z.array(z.object({ url: z.url().max(1000), label: z.string().trim().max(200).optional() })).max(50).default([]),
})

async function assertModerators(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return
  const rows = await db.select({ id: moderators.id }).from(moderators).where(and(eq(moderators.workspaceId, workspaceId), inArray(moderators.id, ids)))
  if (rows.length !== new Set(ids).size) throw badRequest('Unknown moderator for this workspace', 'MODERATOR_NOT_FOUND')
}

export async function operationsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()
  const member = app.requireWorkspace
  const ws = '/workspaces/:workspaceId'

  // --- tasks ---------------------------------------------------------------
  r.get(`${ws}/tasks`, { preHandler: member, schema: { params } }, async (req) => ({
    tasks: await db.select().from(tasks).where(eq(tasks.workspaceId, req.workspace.id)).orderBy(desc(tasks.createdAt)),
  }))

  r.post(`${ws}/tasks`, { preHandler: member, schema: { params, body: taskBody } }, async (req, reply) => {
    const [t] = await db.insert(tasks).values({ workspaceId: req.workspace.id, ...req.body }).returning()
    return reply.status(201).send({ task: t })
  })

  r.patch(`${ws}/tasks/:id`, { preHandler: member, schema: { params: idParams, body: taskBody.partial() } }, async (req) => {
    const [t] = await db.update(tasks).set(req.body).where(and(eq(tasks.workspaceId, req.workspace.id), eq(tasks.id, req.params.id))).returning()
    if (!t) throw notFound('Task')
    return { task: t }
  })

  r.delete(`${ws}/tasks/:id`, { preHandler: member, schema: { params: idParams } }, async (req, reply) => {
    const d = await db.delete(tasks).where(and(eq(tasks.workspaceId, req.workspace.id), eq(tasks.id, req.params.id))).returning({ id: tasks.id })
    if (d.length === 0) throw notFound('Task')
    return reply.status(204).send()
  })

  // --- meetings ------------------------------------------------------------
  r.get(`${ws}/meetings`, { preHandler: member, schema: { params, querystring: sinceQuery } }, async (req) => {
    const since = new Date(Date.now() - req.query.sinceDays * 86_400_000)
    return { meetings: await db.select().from(meetings).where(and(eq(meetings.workspaceId, req.workspace.id), gte(meetings.startsAt, since))).orderBy(asc(meetings.startsAt)) }
  })

  r.post(`${ws}/meetings`, { preHandler: member, schema: { params, body: meetingBody } }, async (req, reply) => {
    await assertModerators(req.workspace.id, req.body.attendeeModeratorIds)
    const [m] = await db
      .insert(meetings)
      .values({ workspaceId: req.workspace.id, createdBy: req.auth!.user.id, ...req.body, startsAt: new Date(req.body.startsAt), endsAt: new Date(req.body.endsAt) })
      .returning()
    return reply.status(201).send({ meeting: m })
  })

  r.delete(`${ws}/meetings/:id`, { preHandler: member, schema: { params: idParams } }, async (req, reply) => {
    const d = await db.delete(meetings).where(and(eq(meetings.workspaceId, req.workspace.id), eq(meetings.id, req.params.id))).returning({ id: meetings.id })
    if (d.length === 0) throw notFound('Meeting')
    return reply.status(204).send()
  })

  // --- content schedule ----------------------------------------------------
  r.get(`${ws}/content`, { preHandler: member, schema: { params, querystring: sinceQuery } }, async (req) => {
    const since = new Date(Date.now() - req.query.sinceDays * 86_400_000)
    return { items: await db.select().from(contentSchedule).where(and(eq(contentSchedule.workspaceId, req.workspace.id), gte(contentSchedule.scheduledAt, since))).orderBy(asc(contentSchedule.scheduledAt)) }
  })

  r.post(`${ws}/content`, { preHandler: member, schema: { params, body: contentBody } }, async (req, reply) => {
    if (req.body.assignedModeratorId) await assertModerators(req.workspace.id, [req.body.assignedModeratorId])
    const [c] = await db
      .insert(contentSchedule)
      .values({
        workspaceId: req.workspace.id,
        ownerUserId: req.auth!.user.id,
        ...req.body,
        scheduledAt: new Date(req.body.scheduledAt),
        publishedAt: req.body.publishedAt ? new Date(req.body.publishedAt) : null,
      })
      .returning()
    return reply.status(201).send({ item: c })
  })

  r.patch(`${ws}/content/:id`, { preHandler: member, schema: { params: idParams, body: contentBody.partial() } }, async (req) => {
    if (req.body.assignedModeratorId) await assertModerators(req.workspace.id, [req.body.assignedModeratorId])
    const { scheduledAt, publishedAt, ...rest } = req.body
    const [c] = await db
      .update(contentSchedule)
      .set({
        ...rest,
        ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }),
        ...(publishedAt !== undefined && { publishedAt: publishedAt ? new Date(publishedAt) : null }),
      })
      .where(and(eq(contentSchedule.workspaceId, req.workspace.id), eq(contentSchedule.id, req.params.id)))
      .returning()
    if (!c) throw notFound('Content item')
    return { item: c }
  })

  r.delete(`${ws}/content/:id`, { preHandler: member, schema: { params: idParams } }, async (req, reply) => {
    const d = await db.delete(contentSchedule).where(and(eq(contentSchedule.workspaceId, req.workspace.id), eq(contentSchedule.id, req.params.id))).returning({ id: contentSchedule.id })
    if (d.length === 0) throw notFound('Content item')
    return reply.status(204).send()
  })

  // --- incidents -----------------------------------------------------------
  r.get(`${ws}/incidents`, { preHandler: member, schema: { params } }, async (req) => ({
    incidents: await db.select().from(incidents).where(eq(incidents.workspaceId, req.workspace.id)).orderBy(desc(incidents.date), desc(incidents.createdAt)),
  }))
  r.post(`${ws}/incidents`, { preHandler: member, schema: { params, body: incidentBody } }, async (req, reply) => {
    const [i] = await db.insert(incidents).values({ workspaceId: req.workspace.id, ...req.body }).returning()
    return reply.status(201).send({ incident: i })
  })
  r.patch(`${ws}/incidents/:id`, { preHandler: member, schema: { params: idParams, body: incidentBody.partial() } }, async (req) => {
    const [i] = await db.update(incidents).set(req.body).where(and(eq(incidents.workspaceId, req.workspace.id), eq(incidents.id, req.params.id))).returning()
    if (!i) throw notFound('Incident')
    return { incident: i }
  })
  r.delete(`${ws}/incidents/:id`, { preHandler: member, schema: { params: idParams } }, async (req, reply) => {
    const d = await db.delete(incidents).where(and(eq(incidents.workspaceId, req.workspace.id), eq(incidents.id, req.params.id))).returning({ id: incidents.id })
    if (d.length === 0) throw notFound('Incident')
    return reply.status(204).send()
  })

  // --- KOLs ----------------------------------------------------------------
  r.get(`${ws}/kols`, { preHandler: member, schema: { params } }, async (req) => ({
    kols: await db.select().from(kols).where(eq(kols.workspaceId, req.workspace.id)).orderBy(desc(kols.createdAt)),
  }))
  r.post(`${ws}/kols`, { preHandler: member, schema: { params, body: kolBody } }, async (req, reply) => {
    const [k] = await db.insert(kols).values({ workspaceId: req.workspace.id, ...req.body }).returning()
    return reply.status(201).send({ kol: k })
  })
  r.patch(`${ws}/kols/:id`, { preHandler: member, schema: { params: idParams, body: kolBody.partial() } }, async (req) => {
    const [k] = await db.update(kols).set(req.body).where(and(eq(kols.workspaceId, req.workspace.id), eq(kols.id, req.params.id))).returning()
    if (!k) throw notFound('KOL')
    return { kol: k }
  })
  r.delete(`${ws}/kols/:id`, { preHandler: member, schema: { params: idParams } }, async (req, reply) => {
    const d = await db.delete(kols).where(and(eq(kols.workspaceId, req.workspace.id), eq(kols.id, req.params.id))).returning({ id: kols.id })
    if (d.length === 0) throw notFound('KOL')
    return reply.status(204).send()
  })
}
