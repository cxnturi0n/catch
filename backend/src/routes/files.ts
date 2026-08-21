import type { FastifyInstance } from 'fastify'
import { storage, verifyDownload } from '../lib/storage/index.js'

// Serves files behind a signed, expiring token (issued by the owning module
// after the workspace check). No session needed: the token is the grant.
export async function fileRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string } }>('/files/:token', { config: { rateLimit: false } }, async (req, reply) => {
    const key = verifyDownload(req.params.token)
    if (!key) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'File not found' } })
    const file = await storage.get(key)
    if (!file) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'File not found' } })
    const filename = key.split('/').pop() ?? 'file'
    return reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`)
      .header('Cache-Control', 'private, max-age=60')
      .send(file.data)
  })
}
