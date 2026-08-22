import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { user, workspaceInvites, workspaceMembers, workspaces } from '../../db/schema/index.js'
import { actionEmail, sendEmail } from '../../email/sender.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { recordSecurityEvent } from '../../auth/security-events.js'

// Workspace members and e-mail invitations (B2B multi-user). Roles:
// owner (one, cannot be removed/demoted here) · admin (manage data + members)
// · member (use the workspace). Accepting requires a signed-in account whose
// verified e-mail matches the invitation.

const params = z.object({ workspaceId: z.uuid() })
const INVITE_TTL_MS = 7 * 86_400_000
const hash = (t: string) => createHash('sha256').update(t).digest('hex')

export async function memberRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()
  const manage = app.requireWorkspaceRole(['owner', 'admin'])
  const base = '/workspaces/:workspaceId/members'

  r.get(base, { preHandler: app.requireWorkspace, schema: { params } }, async (req) => {
    const members = await db
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role, name: user.name, email: user.email, image: user.image, joinedAt: workspaceMembers.createdAt })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, req.workspace.id))
    const invites = await db
      .select({ id: workspaceInvites.id, email: workspaceInvites.email, role: workspaceInvites.role, expiresAt: workspaceInvites.expiresAt, createdAt: workspaceInvites.createdAt })
      .from(workspaceInvites)
      .where(and(eq(workspaceInvites.workspaceId, req.workspace.id), isNull(workspaceInvites.acceptedAt), gt(workspaceInvites.expiresAt, new Date())))
    return { members, invites, me: { userId: req.auth!.user.id, role: req.workspaceRole } }
  })

  r.post(`${base}/invites`, { preHandler: manage, config: { rateLimit: { max: 20, timeWindow: '1 hour' } }, schema: { params, body: z.object({ email: z.email().max(200), role: z.enum(['admin', 'member']).default('member') }) } }, async (req, reply) => {
    const email = req.body.email.toLowerCase()
    const already = await db.select({ id: user.id }).from(workspaceMembers).innerJoin(user, eq(user.id, workspaceMembers.userId)).where(and(eq(workspaceMembers.workspaceId, req.workspace.id), eq(user.email, email))).limit(1)
    if (already.length) throw conflict('Already a member of this workspace')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
    // Re-inviting the same address refreshes the token and expiry.
    await db
      .insert(workspaceInvites)
      .values({ workspaceId: req.workspace.id, email, role: req.body.role, tokenHash: hash(token), invitedBy: req.auth!.user.id, expiresAt })
      .onConflictDoUpdate({ target: [workspaceInvites.workspaceId, workspaceInvites.email], set: { role: req.body.role, tokenHash: hash(token), invitedBy: req.auth!.user.id, expiresAt, acceptedAt: null } })
    const url = `${config.APP_URL}/invite/${token}`
    await sendEmail({
      to: email,
      subject: `${req.auth!.user.name} invited you to "${req.workspace.name}" on Catch`,
      ...actionEmail({
        title: `Join ${req.workspace.name}`,
        intro: `${req.auth!.user.name} invited you to collaborate on the "${req.workspace.name}" workspace as ${req.body.role}. The invitation is valid for 7 days. Sign in (or create an account) with this e-mail address to accept.`,
        cta: 'Accept invitation',
        url,
      }),
    })
    return reply.status(201).send({ ok: true, email, role: req.body.role, expiresAt })
  })

  r.delete(`${base}/invites/:id`, { preHandler: manage, schema: { params: params.extend({ id: z.uuid() }) } }, async (req, reply) => {
    const d = await db.delete(workspaceInvites).where(and(eq(workspaceInvites.workspaceId, req.workspace.id), eq(workspaceInvites.id, req.params.id))).returning({ id: workspaceInvites.id })
    if (d.length === 0) throw notFound('Invitation')
    return reply.status(204).send()
  })

  r.patch(`${base}/:userId`, { preHandler: app.requireWorkspaceRole(['owner']), schema: { params: params.extend({ userId: z.uuid() }), body: z.object({ role: z.enum(['admin', 'member']) }) } }, async (req) => {
    if (req.params.userId === req.workspace.ownerId) throw badRequest('The owner role cannot be changed', 'OWNER_LOCKED')
    const [m] = await db.update(workspaceMembers).set({ role: req.body.role }).where(and(eq(workspaceMembers.workspaceId, req.workspace.id), eq(workspaceMembers.userId, req.params.userId))).returning()
    if (!m) throw notFound('Member')
    return { member: m }
  })

  // Admins can remove members; anyone can leave; the owner can do neither.
  r.delete(`${base}/:userId`, { preHandler: app.requireWorkspace, schema: { params: params.extend({ userId: z.uuid() }) } }, async (req, reply) => {
    const target = req.params.userId
    const self = target === req.auth!.user.id
    if (target === req.workspace.ownerId) throw badRequest('The owner cannot be removed. Delete the workspace instead.', 'OWNER_LOCKED')
    if (!self && !['owner', 'admin'].includes(req.workspaceRole)) throw forbidden()
    const d = await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, req.workspace.id), eq(workspaceMembers.userId, target))).returning({ userId: workspaceMembers.userId })
    if (d.length === 0) throw notFound('Member')
    return reply.status(204).send()
  })

  // --- invitation links (token-addressed) ---------------------------------
  const tokenParams = z.object({ token: z.string().min(20).max(200) })

  r.get('/invites/:token', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } }, schema: { params: tokenParams } }, async (req) => {
    const [inv] = await db
      .select({ email: workspaceInvites.email, role: workspaceInvites.role, expiresAt: workspaceInvites.expiresAt, acceptedAt: workspaceInvites.acceptedAt, workspace: workspaces.name })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
      .where(eq(workspaceInvites.tokenHash, hash(req.params.token)))
      .limit(1)
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw notFound('Invitation')
    // Mask the address: the link alone must not disclose who was invited.
    const [local, domain] = inv.email.split('@')
    return { workspace: inv.workspace, role: inv.role, emailHint: `${local!.slice(0, 2)}***@${domain}`, expiresAt: inv.expiresAt }
  })

  r.post('/invites/:token/accept', { preHandler: app.requireVerifiedEmail, schema: { params: tokenParams } }, async (req) => {
    const [inv] = await db.select().from(workspaceInvites).where(eq(workspaceInvites.tokenHash, hash(req.params.token))).limit(1)
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw notFound('Invitation')
    if (inv.email !== req.auth!.user.email.toLowerCase()) throw forbidden('This invitation was sent to a different e-mail address')
    await db.transaction(async (tx) => {
      await tx.insert(workspaceMembers).values({ workspaceId: inv.workspaceId, userId: req.auth!.user.id, role: inv.role }).onConflictDoNothing()
      await tx.update(workspaceInvites).set({ acceptedAt: new Date() }).where(eq(workspaceInvites.id, inv.id))
    })
    await recordSecurityEvent({ userId: req.auth!.user.id, type: 'account_linked', metadata: { workspaceId: inv.workspaceId, via: 'invite' } })
    return { workspaceId: inv.workspaceId, role: inv.role }
  })
}
