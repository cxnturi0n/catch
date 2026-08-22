import type { FastifyInstance } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { processTelegramUpdate, type TgUpdate } from '../jobs/telegramUpdate.js'

function secretMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Inbound webhooks. Telegram: register the bot with
//   setWebhook?url=https://<host>/api/webhooks/telegram
//             &secret_token=<TELEGRAM_WEBHOOK_SECRET>
//             &allowed_updates=["message","chat_member"]
// `chat_member` is opt-in: without it join/leave events are silently absent.
export async function webhookRoutes(app: FastifyInstance) {
  app.post<{ Body: TgUpdate }>('/webhooks/telegram', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
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
