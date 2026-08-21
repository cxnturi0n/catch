import fp from 'fastify-plugin'
import type { FastifyReply, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  }
}

// Platform admin = user.role === 'admin' (set in the database), replacing the
// hard-coded e-mail comparison of the legacy code.
export const adminPlugin = fp(async (app) => {
  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) {
      return reply.status(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } })
    }
    if (req.auth.user.role !== 'admin') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
    }
  })
})
