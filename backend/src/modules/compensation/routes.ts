import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { compensationConfigs, conversionConfig, moderatorMetrics, moderators, payments, pointsConfig } from '../../db/schema/index.js'
import { badRequest, notFound } from '../../lib/errors.js'

const params = z.object({ workspaceId: z.uuid() })
const money = z.number().finite().min(0).max(1_000_000_000)
const currency = z.enum(['USD', 'EUR', 'USDT'])

const pointsBody = z.object({ metricKey: z.string().trim().min(1).max(60), label: z.string().trim().min(1).max(120), points: z.number().finite().min(-100_000).max(100_000) })
const conversionBody = z.object({ rate: z.number().finite().min(0).max(1_000_000), currency })
const metricBody = z.object({ moderatorId: z.uuid(), metricKey: z.string().trim().min(1).max(60), value: z.number().finite(), period: z.string().trim().min(1).max(40).default('current') })
const compConfigBody = z.object({
  kind: z.enum(['fixed', 'variable', 'both']),
  fixedAmount: money.nullish(),
  fixedCurrency: currency.nullish(),
  fixedPeriod: z.enum(['monthly', 'weekly', 'hourly']).nullish(),
  variableNotes: z.string().trim().max(2000).nullish(),
})
const paymentBody = z.object({
  moderatorId: z.uuid(),
  amount: money,
  currency: z.string().trim().min(1).max(10),
  period: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(2000).nullish(),
  paidAt: z.iso.datetime().optional(),
})

const num = (v: string | number) => Number(v)

// Every moderator id in a body must belong to the workspace; the composite FK
// enforces it too, but a clean 400 beats a constraint error.
async function assertModerators(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return
  const rows = await db.select({ id: moderators.id }).from(moderators).where(and(eq(moderators.workspaceId, workspaceId), inArray(moderators.id, ids)))
  if (rows.length !== new Set(ids).size) throw badRequest('Unknown moderator for this workspace', 'MODERATOR_NOT_FOUND')
}

export async function compensationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()
  const manage = app.requireWorkspaceRole(['owner', 'admin'])
  const base = '/workspaces/:workspaceId/compensation'

  // --- points catalogue ----------------------------------------------------
  r.get(`${base}/points`, { preHandler: app.requireWorkspace, schema: { params } }, async (req) => {
    const rows = await db.select().from(pointsConfig).where(eq(pointsConfig.workspaceId, req.workspace.id)).orderBy(pointsConfig.createdAt)
    return { metrics: rows.map((p) => ({ id: p.id, metricKey: p.metricKey, label: p.label, points: num(p.points) })) }
  })

  r.put(`${base}/points`, { preHandler: manage, schema: { params, body: z.object({ metrics: z.array(pointsBody).min(1).max(100) }) } }, async (req) => {
    const values = req.body.metrics.map((m) => ({ workspaceId: req.workspace.id, metricKey: m.metricKey, label: m.label, points: String(m.points) }))
    const rows = await db
      .insert(pointsConfig)
      .values(values)
      .onConflictDoUpdate({ target: [pointsConfig.workspaceId, pointsConfig.metricKey], set: { label: sqlExcluded('label'), points: sqlExcluded('points') } })
      .returning()
    return { metrics: rows.map((p) => ({ id: p.id, metricKey: p.metricKey, label: p.label, points: num(p.points) })) }
  })

  r.delete(`${base}/points/:id`, { preHandler: manage, schema: { params: params.extend({ id: z.uuid() }) } }, async (req, reply) => {
    const del = await db.delete(pointsConfig).where(and(eq(pointsConfig.workspaceId, req.workspace.id), eq(pointsConfig.id, req.params.id))).returning({ id: pointsConfig.id })
    if (del.length === 0) throw notFound('Metric')
    return reply.status(204).send()
  })

  // --- conversion rate -----------------------------------------------------
  r.get(`${base}/conversion`, { preHandler: app.requireWorkspace, schema: { params } }, async (req) => {
    const [c] = await db.select().from(conversionConfig).where(eq(conversionConfig.workspaceId, req.workspace.id)).limit(1)
    return { conversion: c ? { rate: num(c.rate), currency: c.currency } : null }
  })

  r.put(`${base}/conversion`, { preHandler: manage, schema: { params, body: conversionBody } }, async (req) => {
    const [c] = await db
      .insert(conversionConfig)
      .values({ workspaceId: req.workspace.id, rate: String(req.body.rate), currency: req.body.currency })
      .onConflictDoUpdate({ target: conversionConfig.workspaceId, set: { rate: String(req.body.rate), currency: req.body.currency, updatedAt: new Date() } })
      .returning()
    return { conversion: { rate: num(c!.rate), currency: c!.currency } }
  })

  // --- per-moderator metric values ----------------------------------------
  r.get(`${base}/metrics`, { preHandler: app.requireWorkspace, schema: { params, querystring: z.object({ period: z.string().trim().max(40).default('current') }) } }, async (req) => {
    const rows = await db.select().from(moderatorMetrics).where(and(eq(moderatorMetrics.workspaceId, req.workspace.id), eq(moderatorMetrics.period, req.query.period)))
    return { metrics: rows.map((m) => ({ moderatorId: m.moderatorId, metricKey: m.metricKey, value: num(m.value), period: m.period })) }
  })

  r.put(`${base}/metrics`, { preHandler: manage, schema: { params, body: metricBody } }, async (req) => {
    await assertModerators(req.workspace.id, [req.body.moderatorId])
    await db
      .insert(moderatorMetrics)
      .values({ workspaceId: req.workspace.id, moderatorId: req.body.moderatorId, metricKey: req.body.metricKey, value: String(req.body.value), period: req.body.period })
      .onConflictDoUpdate({
        target: [moderatorMetrics.workspaceId, moderatorMetrics.moderatorId, moderatorMetrics.metricKey, moderatorMetrics.period],
        set: { value: String(req.body.value), updatedAt: new Date() },
      })
    return { ok: true }
  })

  // --- fixed/variable configuration per moderator -------------------------
  const compOut = (c: typeof compensationConfigs.$inferSelect) => ({
    moderatorId: c.moderatorId,
    workspaceId: c.workspaceId,
    kind: c.kind,
    fixedAmount: c.fixedAmount === null ? null : num(c.fixedAmount),
    fixedCurrency: c.fixedCurrency,
    fixedPeriod: c.fixedPeriod,
    variableNotes: c.variableNotes,
    updatedAt: c.updatedAt,
  })

  r.get(`${base}/configs`, { preHandler: app.requireWorkspace, schema: { params } }, async (req) => {
    const rows = await db.select().from(compensationConfigs).where(eq(compensationConfigs.workspaceId, req.workspace.id))
    return { configs: rows.map(compOut) }
  })

  r.put(`${base}/configs/:moderatorId`, { preHandler: manage, schema: { params: params.extend({ moderatorId: z.uuid() }), body: compConfigBody } }, async (req) => {
    await assertModerators(req.workspace.id, [req.params.moderatorId])
    const set = { kind: req.body.kind, fixedAmount: req.body.fixedAmount == null ? null : String(req.body.fixedAmount), fixedCurrency: req.body.fixedCurrency ?? null, fixedPeriod: req.body.fixedPeriod ?? null, variableNotes: req.body.variableNotes ?? null }
    const [c] = await db
      .insert(compensationConfigs)
      .values({ workspaceId: req.workspace.id, moderatorId: req.params.moderatorId, ...set })
      .onConflictDoUpdate({ target: [compensationConfigs.workspaceId, compensationConfigs.moderatorId], set: { ...set, updatedAt: new Date() } })
      .returning()
    return { config: compOut(c!) }
  })

  r.post(`${base}/configs/apply-all`, { preHandler: manage, schema: { params, body: compConfigBody.extend({ moderatorIds: z.array(z.uuid()).min(1).max(500) }) } }, async (req) => {
    const { moderatorIds, ...cfg } = req.body
    await assertModerators(req.workspace.id, moderatorIds)
    const set = { kind: cfg.kind, fixedAmount: cfg.fixedAmount == null ? null : String(cfg.fixedAmount), fixedCurrency: cfg.fixedCurrency ?? null, fixedPeriod: cfg.fixedPeriod ?? null, variableNotes: cfg.variableNotes ?? null }
    await db
      .insert(compensationConfigs)
      .values(moderatorIds.map((moderatorId) => ({ workspaceId: req.workspace.id, moderatorId, ...set })))
      .onConflictDoUpdate({ target: [compensationConfigs.workspaceId, compensationConfigs.moderatorId], set: { ...set, updatedAt: new Date() } })
    return { ok: true, updated: moderatorIds.length }
  })

  // --- payments ------------------------------------------------------------
  const paymentOut = (p: typeof payments.$inferSelect) => ({ id: p.id, moderatorId: p.moderatorId, amount: num(p.amount), currency: p.currency, period: p.period, note: p.note, paidAt: p.paidAt })

  r.get(`${base}/payments`, { preHandler: app.requireWorkspace, schema: { params } }, async (req) => {
    const rows = await db.select().from(payments).where(eq(payments.workspaceId, req.workspace.id)).orderBy(desc(payments.paidAt))
    return { payments: rows.map(paymentOut) }
  })

  r.post(`${base}/payments`, { preHandler: manage, schema: { params, body: paymentBody } }, async (req, reply) => {
    await assertModerators(req.workspace.id, [req.body.moderatorId])
    const [p] = await db
      .insert(payments)
      .values({ workspaceId: req.workspace.id, moderatorId: req.body.moderatorId, amount: String(req.body.amount), currency: req.body.currency, period: req.body.period ?? null, note: req.body.note ?? null, paidAt: req.body.paidAt ? new Date(req.body.paidAt) : new Date() })
      .returning()
    return reply.status(201).send({ payment: paymentOut(p!) })
  })

  r.delete(`${base}/payments/:id`, { preHandler: manage, schema: { params: params.extend({ id: z.uuid() }) } }, async (req, reply) => {
    const del = await db.delete(payments).where(and(eq(payments.workspaceId, req.workspace.id), eq(payments.id, req.params.id))).returning({ id: payments.id })
    if (del.length === 0) throw notFound('Payment')
    return reply.status(204).send()
  })
}

import { sql } from 'drizzle-orm'
function sqlExcluded(col: string) {
  return sql.raw(`excluded."${col}"`)
}
