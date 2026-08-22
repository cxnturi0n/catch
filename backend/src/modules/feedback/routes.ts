import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { feedback } from '../../db/schema/index.js'
import { notFound } from '../../lib/errors.js'

const PUBLIC_STATUSES = ['planned', 'in_progress', 'shipped'] as const
const body = z.object({
  category: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  rating: z.number().int().min(1).max(5).nullish(),
  role: z.string().trim().max(60).nullish(),
})
const out = (f: typeof feedback.$inferSelect) => ({ id: f.id, category: f.category, title: f.title, description: f.description, rating: f.rating, role: f.role, status: f.status, createdAt: f.createdAt })

// CatchLab: users submit ideas; admins triage; everyone sees the roadmap.
export async function feedbackRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.post('/feedback', { preHandler: app.requireVerifiedEmail, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }, schema: { body } }, async (req, reply) => {
    const [f] = await db.insert(feedback).values({ userId: req.auth!.user.id, ...req.body }).returning()
    return reply.status(201).send({ feedback: out(f!) })
  })

  r.get('/feedback/roadmap', { preHandler: app.requireSession }, async () => ({
    items: (await db.select().from(feedback).where(inArray(feedback.status, [...PUBLIC_STATUSES])).orderBy(desc(feedback.createdAt)).limit(200)).map(out),
  }))

  r.get('/admin/feedback', { preHandler: app.requireAdmin }, async () => ({
    items: (await db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(500)).map(out),
  }))

  r.patch('/admin/feedback/:id', { preHandler: app.requireAdmin, schema: { params: z.object({ id: z.uuid() }), body: z.object({ status: z.enum(['pending', 'planned', 'in_progress', 'shipped', 'declined']) }) } }, async (req) => {
    const [f] = await db.update(feedback).set({ status: req.body.status }).where(eq(feedback.id, req.params.id)).returning()
    if (!f) throw notFound('Feedback')
    return { feedback: out(f) }
  })
}
