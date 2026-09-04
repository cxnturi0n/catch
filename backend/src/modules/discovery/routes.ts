import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { discoveryForms, discoveryResponses } from '../../db/schema/index.js'
import { actionEmail, sendEmail } from '../../email/sender.js'
import { logger } from '../../logger.js'
import { notFound } from '../../lib/errors.js'

// Public lead-capture form. Unauthenticated by design, so: strict shape,
// size caps, per-IP rate limit, and the form owner's contact email is never
// returned to the browser.
const slug = z.string().regex(/^[a-z0-9-]{1,64}$/)
const answers = z.record(z.string().max(80), z.string().max(4000)).refine((a) => Object.keys(a).length <= 60, 'too many answers')
const responseBody = z.object({
  respondentName: z.string().trim().max(120).nullish(),
  respondentEmail: z.email().max(200).nullish(),
  respondentRole: z.string().trim().max(60).nullish(),
  answers,
  completionMs: z.number().int().min(0).max(86_400_000).nullish(),
})

export async function discoveryRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get('/public/discovery/:slug', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { params: z.object({ slug }) } }, async (req) => {
    const [f] = await db.select({ id: discoveryForms.id, slug: discoveryForms.slug, contactName: discoveryForms.contactName, source: discoveryForms.source, isActive: discoveryForms.isActive }).from(discoveryForms).where(eq(discoveryForms.slug, req.params.slug)).limit(1)
    if (!f || !f.isActive) throw notFound('Form')
    return { form: f }
  })

  r.post('/public/discovery/:slug/responses', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }, schema: { params: z.object({ slug }), body: responseBody } }, async (req, reply) => {
    const [f] = await db.select({ id: discoveryForms.id, isActive: discoveryForms.isActive }).from(discoveryForms).where(eq(discoveryForms.slug, req.params.slug)).limit(1)
    // Unknown slug still records the answer (legacy behaviour: form_id null).
    const [row] = await db
      .insert(discoveryResponses)
      .values({
        formId: f?.isActive ? f.id : null,
        slugSnapshot: req.params.slug,
        respondentName: req.body.respondentName ?? null,
        respondentEmail: req.body.respondentEmail ?? null,
        respondentRole: req.body.respondentRole ?? null,
        answers: req.body.answers,
        completionMs: req.body.completionMs ?? null,
        userAgent: (req.headers['user-agent'] ?? '').slice(0, 300) || null,
      })
      .returning({ id: discoveryResponses.id })
    if (config.DISCOVERY_NOTIFY_TO) {
      const answered = Object.entries(req.body.answers).filter(([k, v]) => k !== 'variant' && !k.endsWith('__note') && v.trim()).length
      const name = req.body.respondentName?.trim() || 'Someone'
      sendEmail({
        to: config.DISCOVERY_NOTIFY_TO,
        subject: `${name} filled the discovery form (${answered} answers)`,
        ...actionEmail({ title: 'New discovery response', intro: `${name}${req.body.respondentEmail ? ` <${req.body.respondentEmail}>` : ''} submitted ${answered} answers on "${req.params.slug}".`, cta: 'Open responses', url: `${config.APP_URL}/dashboard/discovery-responses`, footer: 'Automatic notification from Catch.' }),
      }).catch((err) => logger.warn({ err }, 'discovery notification failed'))
    }
    return reply.status(201).send({ id: row!.id })
  })

  r.get('/admin/discovery/responses', { preHandler: app.requireAdmin }, async () => ({
    rows: await db.select().from(discoveryResponses).orderBy(desc(discoveryResponses.submittedAt)).limit(1000),
  }))

  // --- Forms (one per link; the questions live in the SPA) ------------------
  const formBody = z.object({
    slug,
    contactName: z.string().trim().max(120).nullish(),
    contactEmail: z.email().max(200).nullish(),
    source: z.string().trim().max(80).nullish(),
    isActive: z.boolean().optional(),
  })
  const formOut = (f: typeof discoveryForms.$inferSelect, responses = 0) => ({ id: f.id, slug: f.slug, contactName: f.contactName, contactEmail: f.contactEmail, source: f.source, isActive: f.isActive, createdAt: f.createdAt, responses })

  r.get('/admin/discovery/forms', { preHandler: app.requireAdmin }, async () => {
    const [forms, counts] = await Promise.all([
      db.select().from(discoveryForms).orderBy(desc(discoveryForms.createdAt)),
      db.select({ slug: discoveryResponses.slugSnapshot, n: sql<number>`count(*)::int` }).from(discoveryResponses).groupBy(discoveryResponses.slugSnapshot),
    ])
    const by = new Map(counts.map((c) => [c.slug, c.n]))
    return { forms: forms.map((f) => formOut(f, by.get(f.slug) ?? 0)) }
  })

  r.post('/admin/discovery/forms', { preHandler: app.requireAdmin, schema: { body: formBody } }, async (req, reply) => {
    const [existing] = await db.select({ id: discoveryForms.id }).from(discoveryForms).where(eq(discoveryForms.slug, req.body.slug)).limit(1)
    if (existing) return reply.status(409).send({ error: { code: 'SLUG_TAKEN', message: 'A form with this slug already exists' } })
    const [f] = await db.insert(discoveryForms).values({ slug: req.body.slug, contactName: req.body.contactName ?? null, contactEmail: req.body.contactEmail ?? null, source: req.body.source ?? null, isActive: req.body.isActive ?? true }).returning()
    return reply.status(201).send({ form: formOut(f!) })
  })

  r.patch('/admin/discovery/forms/:id', { preHandler: app.requireAdmin, schema: { params: z.object({ id: z.uuid() }), body: formBody.partial() } }, async (req) => {
    const patch: Partial<typeof discoveryForms.$inferInsert> = {}
    if (req.body.slug !== undefined) patch.slug = req.body.slug
    if (req.body.contactName !== undefined) patch.contactName = req.body.contactName ?? null
    if (req.body.contactEmail !== undefined) patch.contactEmail = req.body.contactEmail ?? null
    if (req.body.source !== undefined) patch.source = req.body.source ?? null
    if (req.body.isActive !== undefined) patch.isActive = req.body.isActive
    const [f] = await db.update(discoveryForms).set(patch).where(eq(discoveryForms.id, req.params.id)).returning()
    if (!f) throw notFound('Form')
    return { form: formOut(f) }
  })

  // Delete only forms without responses; otherwise deactivate.
  r.delete('/admin/discovery/forms/:id', { preHandler: app.requireAdmin, schema: { params: z.object({ id: z.uuid() }) } }, async (req, reply) => {
    const [f] = await db.select().from(discoveryForms).where(eq(discoveryForms.id, req.params.id)).limit(1)
    if (!f) throw notFound('Form')
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(discoveryResponses).where(and(eq(discoveryResponses.slugSnapshot, f.slug)))
    if ((c?.n ?? 0) > 0) return reply.status(409).send({ error: { code: 'HAS_RESPONSES', message: 'This form has responses; deactivate it instead' } })
    await db.delete(discoveryForms).where(eq(discoveryForms.id, f.id))
    return reply.status(204).send()
  })
}
