import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { PLAN_LIMITS, quotaFor, type PlanTier } from '../../lib/quota.js'
import { forbidden, notFound } from '../../lib/errors.js'
import * as repo from './repo.js'
import { createWorkspace } from './service.js'

const workspaceBody = z.object({
  name: z.string().trim().min(1).max(120),
  projectType: z.string().trim().max(80).nullish(),
  communitySize: z.string().trim().max(40).nullish(),
  platforms: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
})

const workspaceOut = z.object({
  id: z.uuid(),
  name: z.string(),
  projectType: z.string().nullable(),
  communitySize: z.string().nullable(),
  platforms: z.array(z.string()),
  role: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

const params = z.object({ workspaceId: z.uuid() })

export async function workspaceRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get(
    '/workspaces',
    { preHandler: app.requireVerifiedEmail, schema: { response: { 200: z.object({ workspaces: z.array(workspaceOut), quota: z.any() }) } } },
    async (req) => {
      const user = { id: req.auth!.user.id, plan: (req.auth!.user.plan ?? 'starter') as PlanTier }
      const list = await repo.listForUser(user.id)
      const owned = list.filter((w) => w.role === 'owner').length
      return { workspaces: list, quota: quotaFor(user.plan, 'workspaces', owned) }
    },
  )

  r.post(
    '/workspaces',
    { preHandler: app.requireVerifiedEmail, schema: { body: workspaceBody, response: { 201: workspaceOut } } },
    async (req, reply) => {
      const user = { id: req.auth!.user.id, plan: (req.auth!.user.plan ?? 'starter') as PlanTier }
      const ws = await createWorkspace(user, req.body)
      return reply.status(201).send({ ...ws, role: 'owner' })
    },
  )

  r.get('/workspaces/:workspaceId', { preHandler: app.requireWorkspace, schema: { params, response: { 200: workspaceOut } } }, async (req) => ({
    ...req.workspace,
    role: req.workspaceRole,
  }))

  r.patch(
    '/workspaces/:workspaceId',
    { preHandler: app.requireWorkspaceRole(['owner', 'admin']), schema: { params, body: workspaceBody.partial(), response: { 200: workspaceOut } } },
    async (req) => {
      const ws = await repo.update(req.workspace.id, req.body)
      if (!ws) throw notFound('Workspace')
      return { ...ws, role: req.workspaceRole }
    },
  )

  r.delete('/workspaces/:workspaceId', { preHandler: app.requireWorkspaceRole(['owner']), schema: { params } }, async (req, reply) => {
    const ok = await repo.remove(req.workspace.id, req.auth!.user.id)
    if (!ok) throw forbidden('Only the owner can delete a workspace')
    return reply.status(204).send()
  })

  // Plan limits, for display in the SPA (enforcement is server-side).
  r.get('/plans', async () => ({ plans: PLAN_LIMITS }))
}
