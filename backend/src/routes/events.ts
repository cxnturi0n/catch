import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { subscribe } from '../lib/events.js'

const HEARTBEAT_MS = 25_000

// Server-Sent Events per workspace. Clients receive `change` events with the
// topic that changed and refetch; the SPA keeps its polling as a floor.
export async function eventRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()
  r.get('/workspaces/:workspaceId/events', { preHandler: app.requireWorkspace, config: { rateLimit: false }, schema: { params: z.object({ workspaceId: z.uuid() }) } }, async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write(`retry: 5000\nevent: ready\ndata: {}\n\n`)

    const unsubscribe = await subscribe(req.workspace.id, (e) => {
      reply.raw.write(`event: change\ndata: ${JSON.stringify({ topic: e.topic, at: e.at })}\n\n`)
    })
    const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), HEARTBEAT_MS)

    const close = () => {
      clearInterval(heartbeat)
      unsubscribe()
    }
    req.raw.on('close', close)
    req.raw.on('error', close)
    // Hand the socket to the SSE loop; Fastify must not try to send a body.
    await new Promise<void>((resolve) => req.raw.on('close', () => resolve()))
    return reply
  })
}
