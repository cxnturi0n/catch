import Fastify, { type FastifyError } from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import sensible from '@fastify/sensible'
import { config } from './config.js'
import { logger } from './logger.js'
import { healthRoutes } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { meRoutes } from './routes/me.js'
import { sessionPlugin } from './plugins/session.js'

// Builds the Fastify instance without listening — reused by api.ts and by tests.
export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true, // behind Caddy
  })

  await app.register(sensible)
  await app.register(helmet, {
    // The SPA is served by Caddy with its own CSP; the API only returns JSON.
    contentSecurityPolicy: false,
  })
  await app.register(cors, {
    origin: [config.APP_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  })

  await app.register(sessionPlugin)
  await app.register(healthRoutes)
  await app.register(authRoutes)
  await app.register(meRoutes)

  // Uniform error envelope: { error: { code, message } }. Validation and
  // sensible's http errors already carry a statusCode; everything else is 500
  // and never leaks internals to the client.
  app.setErrorHandler((error: unknown, req, reply) => {
    const err = error as Partial<FastifyError> & { message?: string }
    const status = err.statusCode ?? 500
    if (status >= 500) req.log.error({ err }, 'unhandled error')
    reply.status(status).send({
      error: {
        code: err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
        message: status >= 500 ? 'Internal server error' : err.message,
      },
    })
  })

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  return app
}
