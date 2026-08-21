import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { INTEGRATION_PLATFORMS } from '../../db/schema/index.js'
import * as repo from './repo.js'

const params = z.object({ workspaceId: z.uuid() })
const platformParams = params.extend({ platform: z.enum(INTEGRATION_PLATFORMS) })

const integrationOut = z.object({
  platform: z.enum(INTEGRATION_PLATFORMS),
  status: z.enum(['disconnected', 'connected', 'error']),
  metadata: z.record(z.string(), z.unknown()),
  lastSync: z.date().nullable(),
  lastError: z.string().nullable(),
})

// Connect endpoints (credential validation against each platform) arrive with
// the integration clients in the worker step; until then the API exposes
// status and disconnect only. Credentials are never part of any response —
// the output schema makes that structural, not a convention.
export async function integrationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get(
    '/workspaces/:workspaceId/integrations',
    { preHandler: app.requireWorkspace, schema: { params, response: { 200: z.object({ integrations: z.array(integrationOut) }) } } },
    async (req) => ({ integrations: await repo.listForWorkspace(req.workspace.id) }),
  )

  r.delete(
    '/workspaces/:workspaceId/integrations/:platform',
    { preHandler: app.requireWorkspaceRole(['owner', 'admin']), schema: { params: platformParams } },
    async (req, reply) => {
      await repo.disconnect(req.workspace.id, req.params.platform)
      return reply.status(204).send()
    },
  )
}
