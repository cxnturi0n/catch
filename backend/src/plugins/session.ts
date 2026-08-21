import fp from 'fastify-plugin'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { auth } from '../auth/auth.js'

type SessionData = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

declare module 'fastify' {
  interface FastifyRequest {
    auth: SessionData | null
  }
}

// Resolves the session from the cookie on every request (null when absent)
// and exposes `requireSession` / `requireVerifiedEmail` guards for routes.
// A session that is still pending a second factor is not returned by
// getSession, so MFA can never be bypassed by calling the API directly.
export const sessionPlugin = fp(async (app) => {
  app.decorateRequest('auth', null)

  app.addHook('onRequest', async (req) => {
    const headers = new Headers()
    const cookie = req.headers.cookie
    if (!cookie) return
    headers.set('cookie', cookie)
    req.auth = await auth.api.getSession({ headers })
  })

  app.decorate('requireSession', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) {
      return reply.status(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } })
    }
  })

  app.decorate('requireVerifiedEmail', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) {
      return reply.status(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } })
    }
    if (!req.auth.user.emailVerified) {
      return reply.status(403).send({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email to continue' } })
    }
  })
})

declare module 'fastify' {
  interface FastifyInstance {
    requireSession: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>
    requireVerifiedEmail: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  }
}
