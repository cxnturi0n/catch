import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { desc, eq } from 'drizzle-orm'
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
}
