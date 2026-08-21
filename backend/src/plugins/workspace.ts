import fp from 'fastify-plugin'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { workspaceMembers, workspaces, type Workspace } from '../db/schema/index.js'

export type WorkspaceRole = 'owner' | 'admin' | 'member'

declare module 'fastify' {
  interface FastifyRequest {
    workspace: Workspace
    workspaceRole: WorkspaceRole
  }
  interface FastifyInstance {
    requireWorkspace: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>
    requireWorkspaceRole: (roles: WorkspaceRole[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  }
}

// Authorization boundary for everything under /workspaces/:workspaceId.
// Loads the workspace and the caller's membership in one query; a non-member
// gets 404 (never 403) so workspace ids cannot be probed for existence.
export const workspacePlugin = fp(async (app) => {
  app.decorateRequest('workspace', null as unknown as Workspace)
  app.decorateRequest('workspaceRole', 'member')

  app.decorate('requireWorkspace', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) {
      return reply.status(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } })
    }
    const { workspaceId } = req.params as { workspaceId?: string }
    if (!workspaceId || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } })
    }
    const rows = await db
      .select({ workspace: workspaces, role: workspaceMembers.role })
      .from(workspaces)
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, req.auth.user.id)))
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
    const row = rows[0]
    if (!row) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } })
    }
    req.workspace = row.workspace
    req.workspaceRole = row.role
  })

  app.decorate('requireWorkspaceRole', (roles: WorkspaceRole[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    await app.requireWorkspace(req, reply)
    if (reply.sent) return
    if (!roles.includes(req.workspaceRole)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Insufficient workspace role' } })
    }
  })
})
