import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { QuotaExceededError, quotaFor, type PlanTier } from '../../lib/quota.js'
import { downloadUrl, sanitizeFilename, storage } from '../../lib/storage/index.js'
import { config } from '../../config.js'
import * as repo from './repo.js'
import { moderatorBody, moderatorOut } from './schemas.js'
import { moderatorPerformance, recordShiftEvents, resolveModerator, workspaceIdentityIndex } from '../../jobs/moderatorPerformance.js'
import { recordResponseMetrics } from '../../jobs/responseMetrics.js'
import { moderatorActions } from '../../db/schema/index.js'
import { and, desc, eq, gte } from 'drizzle-orm'

const params = z.object({ workspaceId: z.uuid() })
const idParams = params.extend({ id: z.uuid() })
const sinceQuery = z.object({ sinceDays: z.coerce.number().int().min(1).max(365).default(30), moderatorId: z.uuid().optional() })

const CV_TYPES = new Set(['application/pdf'])

export async function moderatorRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()
  const manage = app.requireWorkspaceRole(['owner', 'admin'])

  r.get('/workspaces/:workspaceId/moderators', { preHandler: app.requireWorkspace, schema: { params, response: { 200: z.object({ moderators: z.array(moderatorOut), quota: z.any() }) } } }, async (req) => {
    const rows = await repo.list(req.workspace.id)
    const plan = (req.auth!.user.plan ?? 'starter') as PlanTier
    return { moderators: rows.map(repo.toOut), quota: quotaFor(plan, 'moderators', rows.length) }
  })

  r.post('/workspaces/:workspaceId/moderators', { preHandler: manage, schema: { params, body: moderatorBody, response: { 201: moderatorOut } } }, async (req, reply) => {
    const plan = (req.auth!.user.plan ?? 'starter') as PlanTier
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`moderators:${req.workspace.id}`}))`)
      const used = await repo.countIn(req.workspace.id, tx)
      const quota = quotaFor(plan, 'moderators', used)
      if (quota.reached) throw new QuotaExceededError(quota)
      return repo.create(req.workspace.id, req.body, tx)
    })
    return reply.status(201).send(repo.toOut(created))
  })

  r.get('/workspaces/:workspaceId/moderators/:id', { preHandler: app.requireWorkspace, schema: { params: idParams, response: { 200: moderatorOut } } }, async (req) => {
    const m = await repo.get(req.workspace.id, req.params.id)
    if (!m) throw notFound('Moderator')
    return repo.toOut(m)
  })

  r.patch('/workspaces/:workspaceId/moderators/:id', { preHandler: manage, schema: { params: idParams, body: moderatorBody.partial(), response: { 200: moderatorOut } } }, async (req) => {
    const m = await repo.update(req.workspace.id, req.params.id, req.body)
    if (!m) throw notFound('Moderator')
    return repo.toOut(m)
  })

  r.delete('/workspaces/:workspaceId/moderators/:id', { preHandler: manage, schema: { params: idParams } }, async (req, reply) => {
    const m = await repo.remove(req.workspace.id, req.params.id)
    if (!m) throw notFound('Moderator')
    if (m.cvStoragePath) await storage.delete(m.cvStoragePath).catch(() => undefined)
    return reply.status(204).send()
  })

  // --- CV (PDF) ------------------------------------------------------------
  r.post('/workspaces/:workspaceId/moderators/:id/cv', { preHandler: manage, schema: { params: idParams, response: { 200: moderatorOut } } }, async (req) => {
    const m = await repo.get(req.workspace.id, req.params.id)
    if (!m) throw notFound('Moderator')
    const file = await req.file({ limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } })
    if (!file) throw badRequest('A PDF file is required', 'FILE_REQUIRED')
    const data = await file.toBuffer()
    if (file.file.truncated) throw badRequest(`File exceeds ${Math.round(config.MAX_UPLOAD_BYTES / 1024 / 1024)} MB`, 'FILE_TOO_LARGE')
    // Trust the bytes, not the declared type.
    if (!CV_TYPES.has(file.mimetype) || data.subarray(0, 5).toString() !== '%PDF-') throw badRequest('Only PDF files are accepted', 'FILE_TYPE')
    const extractedText = (file.fields.extractedText as { value?: string } | undefined)?.value?.slice(0, 200_000) ?? null
    const key = `${req.workspace.id}/moderators/${m.id}/${Date.now()}_${sanitizeFilename(file.filename)}`
    await storage.put(key, data, 'application/pdf')
    if (m.cvStoragePath) await storage.delete(m.cvStoragePath).catch(() => undefined)
    const updated = await repo.setCv(req.workspace.id, m.id, { storagePath: key, filename: file.filename, extractedText })
    return repo.toOut(updated!)
  })

  r.get('/workspaces/:workspaceId/moderators/:id/cv', { preHandler: app.requireWorkspace, schema: { params: idParams } }, async (req) => {
    const m = await repo.get(req.workspace.id, req.params.id)
    if (!m?.cvStoragePath) throw notFound('CV')
    return { url: downloadUrl(m.cvStoragePath), filename: m.cvFilename, expiresIn: 300 }
  })

  r.delete('/workspaces/:workspaceId/moderators/:id/cv', { preHandler: manage, schema: { params: idParams, response: { 200: moderatorOut } } }, async (req) => {
    const m = await repo.get(req.workspace.id, req.params.id)
    if (!m) throw notFound('Moderator')
    if (m.cvStoragePath) await storage.delete(m.cvStoragePath).catch(() => undefined)
    const updated = await repo.setCv(req.workspace.id, m.id, { storagePath: null, filename: null, extractedText: null })
    return repo.toOut(updated!)
  })

  // --- Performance (derived from member_messages via handle matching) ------
  r.get('/workspaces/:workspaceId/moderators/performance', { preHandler: app.requireWorkspace, schema: { params, querystring: z.object({ sinceDays: z.coerce.number().int().min(1).max(365).default(30) }) } }, async (req) => ({
    sinceDays: req.query.sinceDays,
    rows: await moderatorPerformance(req.workspace.id, req.query.sinceDays),
  }))

  // Recompute punctuality for the last N days (the worker does yesterday nightly).
  r.post('/workspaces/:workspaceId/moderators/shift-events/recompute', { preHandler: manage, config: { rateLimit: { max: 3, timeWindow: '10 minutes' } }, schema: { params, body: z.object({ days: z.number().int().min(1).max(31).default(7) }).default({ days: 7 }) } }, async (req) => {
    let events = 0
    for (let i = 1; i <= req.body.days; i++) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - i)
      events += await recordShiftEvents(req.workspace.id, d.toISOString().slice(0, 10))
    }
    return { events }
  })

  // --- Shift events / response metrics ------------------------------------
  r.get('/workspaces/:workspaceId/moderators/shift-events', { preHandler: app.requireWorkspace, schema: { params, querystring: sinceQuery } }, async (req) => ({
    events: await repo.shiftEvents(req.workspace.id, req.query.sinceDays, req.query.moderatorId),
  }))

  r.get('/workspaces/:workspaceId/moderators/response-metrics', { preHandler: app.requireWorkspace, schema: { params, querystring: sinceQuery } }, async (req) => ({
    metrics: await repo.responseMetrics(req.workspace.id, req.query.sinceDays, req.query.moderatorId),
  }))

  // Recompute response metrics for the last N days (the worker does yesterday nightly).
  r.post('/workspaces/:workspaceId/moderators/response-metrics/recompute', { preHandler: manage, config: { rateLimit: { max: 3, timeWindow: '10 minutes' } }, schema: { params, body: z.object({ days: z.number().int().min(1).max(31).default(7) }).default({ days: 7 }) } }, async (req) => {
    let rows = 0
    for (let i = 0; i < req.body.days; i++) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - i)
      rows += await recordResponseMetrics(req.workspace.id, d.toISOString().slice(0, 10))
    }
    return { rows }
  })

  // --- Moderation actions (bans, kicks, timeouts, deletes, mutes) ----------
  // Raw counts per executor plus the attribution to roster moderators
  // (platform user id first, handle as fallback).
  r.get('/workspaces/:workspaceId/moderators/actions', { preHandler: app.requireWorkspace, schema: { params, querystring: sinceQuery } }, async (req) => {
    const since = new Date(Date.now() - req.query.sinceDays * 86_400_000)
    const rows = await db
      .select({ platform: moderatorActions.platform, executorRef: moderatorActions.executorRef, executorName: sql<string | null>`max(${moderatorActions.executorName})`, actionType: moderatorActions.actionType, n: sql<number>`count(*)::int`, last: sql<Date>`max(${moderatorActions.occurredAt})` })
      .from(moderatorActions)
      .where(and(eq(moderatorActions.workspaceId, req.workspace.id), gte(moderatorActions.occurredAt, since)))
      .groupBy(moderatorActions.platform, moderatorActions.executorRef, moderatorActions.actionType)
      .orderBy(desc(sql`count(*)`))
    const idx = await workspaceIdentityIndex(req.workspace.id)
    const byModerator = new Map<string, { moderatorId: string; bans: number; unbans: number; kicks: number; timeouts: number; untimeouts: number; deletes: number; mutes: number; unmutes: number }>()
    const field: Record<string, keyof Omit<NonNullable<ReturnType<typeof byModerator.get>>, 'moderatorId'>> = { ban: 'bans', unban: 'unbans', kick: 'kicks', timeout: 'timeouts', untimeout: 'untimeouts', delete_message: 'deletes', mute: 'mutes', unmute: 'unmutes' }
    for (const r of rows) {
      const modId = resolveModerator(idx, r.platform, r.executorRef, r.executorName)
      if (!modId) continue
      const m = byModerator.get(modId) ?? { moderatorId: modId, bans: 0, unbans: 0, kicks: 0, timeouts: 0, untimeouts: 0, deletes: 0, mutes: 0, unmutes: 0 }
      m[field[r.actionType]!] += r.n
      byModerator.set(modId, m)
    }
    return { sinceDays: req.query.sinceDays, rows, byModerator: [...byModerator.values()] }
  })
}
