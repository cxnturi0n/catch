import type { FastifyInstance } from 'fastify'
import { isProduction } from '../config.js'
import { emailOutbox } from '../email/sender.js'

// Development/test helpers. Never registered in production builds.
export async function devRoutes(app: FastifyInstance) {
  if (isProduction) return
  app.get<{ Querystring: { to?: string } }>('/dev/outbox', async (req) => {
    const to = req.query.to?.toLowerCase()
    const items = emailOutbox.filter((m) => !to || m.to.toLowerCase() === to)
    return { emails: items.slice(-20) }
  })
}
