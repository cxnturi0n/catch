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
import { workspacePlugin } from './plugins/workspace.js'
import { adminPlugin } from './plugins/admin.js'
import { workspaceRoutes } from './modules/workspaces/routes.js'
import { integrationRoutes } from './modules/integrations/routes.js'
import { adminRoutes } from './modules/admin/routes.js'
import { moderatorRoutes } from './modules/moderators/routes.js'
import { compensationRoutes } from './modules/compensation/routes.js'
import { operationsRoutes } from './modules/operations/routes.js'
import { resourceRoutes } from './modules/resources/routes.js'
import { metricsRoutes } from './modules/metrics/routes.js'
import { reportRoutes } from './modules/reports/routes.js'
import { feedbackRoutes } from './modules/feedback/routes.js'
import { discoveryRoutes } from './modules/discovery/routes.js'
import { aiRoutes } from './modules/ai/routes.js'
import { memberRoutes } from './modules/members/routes.js'
import { fileRoutes } from './routes/files.js'
import { webhookRoutes } from './routes/webhooks.js'
import { eventRoutes } from './routes/events.js'
import { devRoutes } from './routes/dev.js'
import multipart from '@fastify/multipart'
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { captureException } from './lib/sentry.js'

// Builds the Fastify instance without listening — reused by api.ts and by tests.
export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true, // behind Caddy
    maxParamLength: 512, // signed download tokens are long
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

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
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } })
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  })

  // Uniform error envelope: { error: { code, message } }. Validation and
  // sensible's http errors already carry a statusCode; everything else is 500
  // and never leaks internals to the client.
  app.setErrorHandler((error: unknown, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          issues: error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      })
    }
    const err = error as Partial<FastifyError> & { message?: string }
    const status = err.statusCode ?? 500
    if (status >= 500) {
      req.log.error({ err }, 'unhandled error')
      captureException(error, { url: req.url, method: req.method })
    }
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


  await app.register(sessionPlugin)
  await app.register(workspacePlugin)
  await app.register(adminPlugin)
  await app.register(healthRoutes)
  await app.register(authRoutes)
  await app.register(meRoutes)
  await app.register(workspaceRoutes)
  await app.register(integrationRoutes)
  await app.register(adminRoutes)
  await app.register(moderatorRoutes)
  await app.register(compensationRoutes)
  await app.register(operationsRoutes)
  await app.register(resourceRoutes)
  await app.register(metricsRoutes)
  await app.register(reportRoutes)
  await app.register(feedbackRoutes)
  await app.register(discoveryRoutes)
  await app.register(aiRoutes)
  await app.register(memberRoutes)
  await app.register(fileRoutes)
  await app.register(webhookRoutes)
  await app.register(eventRoutes)
  await app.register(devRoutes)

  return app
}
