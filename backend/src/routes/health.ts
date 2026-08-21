import type { FastifyInstance } from 'fastify'
import { pingDatabase } from '../db/client.js'

export async function healthRoutes(app: FastifyInstance) {
  // Liveness: process is up. Used by Docker healthcheck and uptime monitor.
  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ status: 'ok' }))

  // Readiness: dependencies reachable. Caddy/compose should only route traffic
  // once this returns 200.
  app.get('/readyz', { config: { rateLimit: false } }, async (_req, reply) => {
    const dbOk = await pingDatabase()
    if (!dbOk) return reply.status(503).send({ status: 'degraded', database: 'unreachable' })
    return { status: 'ok', database: 'ok' }
  })
}
