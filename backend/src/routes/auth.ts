import type { FastifyInstance, FastifyRequest } from 'fastify'
import { auth, enabledProviders } from '../auth/auth.js'
import { config } from '../config.js'

// Bridges Fastify to Better Auth's WHATWG handler. Everything under /auth/*
// (sign-in, sign-up, OAuth callbacks, 2FA, sessions…) is served by Better
// Auth; Fastify's own rate limiter is bypassed here because Better Auth
// applies its own per-route rules with database storage.
function toWebRequest(req: FastifyRequest): Request {
  // Rebuild the PUBLIC url: the edge proxy strips the /api prefix, while
  // Better Auth matches routes against API_URL + basePath.
  const url = new URL(config.API_URL.replace(/\/$/, '') + req.url)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined,
  })
}

export async function authRoutes(app: FastifyInstance) {
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    config: { rateLimit: false },
    handler: async (req, reply) => {
      const res = await auth.handler(toWebRequest(req))
      reply.status(res.status)
      res.headers.forEach((value, key) => {
        // Multiple Set-Cookie headers must not be joined.
        if (key.toLowerCase() === 'set-cookie') return
        reply.header(key, value)
      })
      const cookies = res.headers.getSetCookie()
      if (cookies.length) reply.header('set-cookie', cookies)
      const body = res.body ? Buffer.from(await res.arrayBuffer()) : null
      return reply.send(body)
    },
  })

  // Lets the SPA render only the sign-in buttons that are actually configured.
  app.get('/auth-providers', async () => ({ providers: enabledProviders }))
}
