import type { FastifyInstance } from 'fastify'
import { createHash, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { processTelegramUpdate, type TgUpdate } from '../jobs/telegramUpdate.js'
import { getWebhookTarget } from '../modules/integrations/repo.js'
import { integrationLog } from '../lib/integrationLog.js'

function secretMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Inbound webhooks.
//
// Telegram v2: every integration has its own URL and secret, registered by
// the connect flow (setWebhook). The header secret is hashed and compared
// with the stored hash, so no credential is decrypted on the hot path.
//
// Legacy: /webhooks/telegram with the global TELEGRAM_WEBHOOK_SECRET and a
// chat id scan, kept for bots registered by hand before v2.
export async function webhookRoutes(app: FastifyInstance) {
  const limit = { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }

  app.post<{ Body: TgUpdate; Params: { integrationId: string } }>('/webhooks/telegram/:integrationId', limit, async (req, reply) => {
    const { integrationId } = req.params
    const header = req.headers['x-telegram-bot-api-secret-token'] as string | undefined
    const row = UUID.test(integrationId) ? await getWebhookTarget(integrationId) : null
    // Rows in 'error' (bot removed) still accept updates: that is how the
    // bot being added back is noticed. Disconnected rows have no hash.
    if (!row || !row.webhookSecretHash || !header || !secretMatches(sha256(header), row.webhookSecretHash) || row.status === 'disconnected') {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Bad webhook secret' } })
    }
    try {
      const chatId = row.metadata.chat_numeric_id ? String(row.metadata.chat_numeric_id) : null
      const outcome = await processTelegramUpdate(req.body ?? {}, { workspaceId: row.workspaceId, chatId })
      if (outcome !== 'ignored' && outcome !== 'duplicate') integrationLog('telegram.update', { workspaceId: row.workspaceId, outcome })
    } catch (err) {
      req.log.error({ err }, 'telegram update failed')
    }
    return { ok: true }
  })

  app.post<{ Body: TgUpdate }>('/webhooks/telegram', limit, async (req, reply) => {
    if (!secretMatches(req.headers['x-telegram-bot-api-secret-token'] as string | undefined, config.TELEGRAM_WEBHOOK_SECRET)) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Bad webhook secret' } })
    }
    // Always 200 to Telegram once authenticated; failures are logged, never
    // retried by re-delivery storms.
    try {
      const outcome = await processTelegramUpdate(req.body ?? {})
      if (outcome !== 'ignored' && outcome !== 'duplicate') req.log.info({ outcome }, 'telegram update')
    } catch (err) {
      req.log.error({ err }, 'telegram update failed')
    }
    return { ok: true }
  })
}
