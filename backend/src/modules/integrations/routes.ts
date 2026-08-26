import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { INTEGRATION_PLATFORMS } from '../../db/schema/index.js'
import { PlatformError } from '../../integrations/index.js'
import { HttpError } from '../../lib/errors.js'
import * as repo from './repo.js'
import * as service from './service.js'
import { syncDiscordMembers } from '../../jobs/discordMembers.js'
import { syncDiscordActivity } from '../../jobs/discordActivity.js'

const params = z.object({ workspaceId: z.uuid() })
const platformParams = params.extend({ platform: z.enum(INTEGRATION_PLATFORMS) })

const integrationOut = z.object({
  platform: z.enum(INTEGRATION_PLATFORMS),
  status: z.enum(['disconnected', 'connected', 'error']),
  metadata: z.record(z.string(), z.unknown()),
  lastSync: z.date().nullable(),
  lastError: z.string().nullable(),
  health: z.record(z.string(), z.unknown()),
})

// One body schema per platform; the union is discriminated by the URL.
const connectBodies = {
  discord: z.object({ botToken: z.string().trim().min(20).max(200), serverId: z.string().trim().regex(/^\d{15,22}$/) }),
  telegram: z.object({ botToken: z.string().trim().min(20).max(200), chatId: z.string().trim().regex(/^-?\d{1,20}$|^@[A-Za-z0-9_]{5,64}$/) }),
  zealy: z.object({ subdomain: z.string().trim().min(2).max(64), apiKey: z.string().trim().min(8).max(200) }),
  galxe: z.object({ alias: z.string().trim().min(1).max(64), accessToken: z.string().trim().max(500).optional() }),
} as const

function toHttp(err: unknown): never {
  if (err instanceof PlatformError) {
    const status = err.code === 'INVALID_CREDENTIALS' ? 400 : err.code === 'NOT_FOUND' ? 400 : err.code === 'RATE_LIMITED' ? 429 : 502
    throw new HttpError(status, `PLATFORM_${err.code}`, err.message)
  }
  throw err
}

// Credentials are validated against the platform before being stored
// (encrypted); they never appear in any response.
export async function integrationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()
  const manage = app.requireWorkspaceRole(['owner', 'admin'])

  r.get(
    '/workspaces/:workspaceId/integrations',
    { preHandler: app.requireWorkspace, schema: { params, response: { 200: z.object({ integrations: z.array(integrationOut) }) } } },
    async (req) => ({ integrations: await repo.listForWorkspace(req.workspace.id) }),
  )

  r.post(
    '/workspaces/:workspaceId/integrations/:platform/connect',
    { preHandler: manage, config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { params: platformParams, body: z.unknown() } },
    async (req) => {
      const { platform } = req.params
      const parsed = connectBodies[platform].safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
      const metadata = await service.connect(req.workspace.id, platform, parsed.data).catch(toHttp)
      // First sync right away so the dashboard has a data point.
      const sync = await service.syncPlatform(req.workspace.id, platform)
      return { platform, metadata, firstSync: sync.ok ? sync.metrics : null }
    },
  )

  r.post(
    '/workspaces/:workspaceId/integrations/:platform/sync',
    { preHandler: manage, config: { rateLimit: { max: 6, timeWindow: '1 minute' } }, schema: { params: platformParams } },
    async (req) => {
      const out = await service.syncPlatform(req.workspace.id, req.params.platform)
      if (!out.ok) {
        const status = out.code === 'NOT_CONNECTED' ? 400 : out.code === 'RATE_LIMITED' ? 429 : out.code === 'INVALID_CREDENTIALS' ? 400 : 502
        throw new HttpError(status, `PLATFORM_${out.code}`, out.error ?? 'Sync failed')
      }
      return { platform: req.params.platform, metrics: out.metrics }
    },
  )

  // Manual Discord member-list sync (otherwise daily in the worker).
  r.post(
    '/workspaces/:workspaceId/integrations/discord/members-sync',
    { preHandler: manage, config: { rateLimit: { max: 3, timeWindow: '10 minutes' } }, schema: { params } },
    async (req) => {
      const out = await syncDiscordMembers(req.workspace.id, { force: true })
      if (!out.ok) {
        const status = out.code === 'NOT_CONNECTED' ? 400 : out.code === 'MISSING_MEMBERS_INTENT' ? 422 : 502
        throw new HttpError(status, out.code, out.message)
      }
      return out
    },
  )

  r.post(
    '/workspaces/:workspaceId/integrations/discord/activity-sync',
    { preHandler: manage, config: { rateLimit: { max: 6, timeWindow: '1 minute' } }, schema: { params } },
    async (req) => {
      const out = await syncDiscordActivity(req.workspace.id)
      if (!out) throw new HttpError(400, 'NOT_CONNECTED', 'Discord is not connected')
      return out
    },
  )

  // Re-run the history import (30 days). Picked up by the worker tick.
  r.post(
    '/workspaces/:workspaceId/integrations/:platform/backfill',
    { preHandler: manage, config: { rateLimit: { max: 2, timeWindow: '10 minutes' } }, schema: { params: params.extend({ platform: z.enum(['discord', 'telegram']) }) } },
    async (req) => {
      const meta = await repo.getMetadata(req.workspace.id, req.params.platform)
      const creds = await repo.getCredentials(req.workspace.id, req.params.platform)
      if (!meta || !creds) throw new HttpError(400, 'NOT_CONNECTED', `${req.params.platform} is not connected`)
      const current = (meta.backfill as { status?: string } | undefined)?.status
      if (current === 'running' || current === 'queued') throw new HttpError(409, 'BACKFILL_RUNNING', 'A history import is already in progress')
      await repo.patchMetadata(req.workspace.id, req.params.platform, { backfill: { status: 'queued', requestedAt: new Date().toISOString() } })
      return { platform: req.params.platform, backfill: { status: 'queued' } }
    },
  )

  r.delete(
    '/workspaces/:workspaceId/integrations/:platform',
    { preHandler: manage, schema: { params: platformParams } },
    async (req, reply) => {
      await service.disconnect(req.workspace.id, req.params.platform)
      return reply.status(204).send()
    },
  )
}
