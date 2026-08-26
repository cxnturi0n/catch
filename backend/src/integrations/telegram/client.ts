import { randomBytes } from 'node:crypto'
import { config } from '../../config.js'
import { PlatformError, upstreamFetch, type PlatformClient, type SyncContext } from '../types.js'
import * as repo from '../../modules/integrations/repo.js'
import { integrationLog } from '../../lib/integrationLog.js'

export interface TelegramCredentials extends Record<string, string> {
  bot_token: string
  chat_id: string
  /** Per-integration webhook secret (absent on rows connected before v2). */
  webhook_secret: string
}
export interface TelegramConnectInput {
  botToken: string
  chatId: string
}

interface TgResponse<T> {
  ok: boolean
  result?: T
  description?: string
}
interface TgUser {
  id: number
  is_bot?: boolean
  username?: string
  first_name?: string
  can_read_all_group_messages?: boolean
}

const TOKEN = /^\d+:[A-Za-z0-9_-]{30,}$/
export const WEBHOOK_ALLOWED_UPDATES = ['message', 'edited_message', 'chat_member', 'my_chat_member']
const WEBHOOK_CHECK_MS = 60 * 60_000

// Every Bot API method as a JSON POST; the token only ever appears in the URL
// and upstreamFetch never echoes it.
export async function tgCall<T>(botToken: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!TOKEN.test(botToken)) throw new PlatformError('Invalid bot token format', 'INVALID_CREDENTIALS')
  const res = await upstreamFetch(`https://api.telegram.org/bot${botToken}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })
  const body = (await res.json().catch(() => ({ ok: false }))) as TgResponse<T>
  if (!body.ok) {
    const d = body.description ?? ''
    if (/unauthorized/i.test(d)) throw new PlatformError('Invalid bot token', 'INVALID_CREDENTIALS', 401)
    if (/chat not found/i.test(d)) throw new PlatformError('Chat not found (is the bot a member?)', 'NOT_FOUND', 404)
    if (res.status === 429) throw new PlatformError('Telegram rate limit reached', 'RATE_LIMITED', 429)
    throw new PlatformError(d ? `Telegram: ${d.slice(0, 120)}` : 'Telegram API error', 'UPSTREAM', res.status)
  }
  return body.result as T
}

/** Public webhook URL for an integration, or null when the API is not served over https (local dev). */
export function webhookUrlFor(integrationId: string): string | null {
  if (!config.API_URL.startsWith('https://')) return null
  return `${config.API_URL.replace(/\/$/, '')}/webhooks/telegram/${integrationId}`
}

export async function registerWebhook(botToken: string, url: string, secret: string): Promise<void> {
  await tgCall(botToken, 'setWebhook', { url, secret_token: secret, allowed_updates: WEBHOOK_ALLOWED_UPDATES, drop_pending_updates: false })
}
export async function removeWebhook(botToken: string): Promise<void> {
  await tgCall(botToken, 'deleteWebhook', { drop_pending_updates: false })
}
export async function webhookInfo(botToken: string): Promise<{ url?: string; last_error_message?: string; pending_update_count?: number }> {
  return tgCall(botToken, 'getWebhookInfo')
}

const isAdmin = (status: string | undefined) => status === 'administrator' || status === 'creator'

export const telegram: PlatformClient<TelegramCredentials, TelegramConnectInput> = {
  async connect({ botToken, chatId }) {
    const me = await tgCall<TgUser>(botToken, 'getMe')
    const chat = await tgCall<{ id?: number; title?: string; type: string; username?: string }>(botToken, 'getChat', { chat_id: chatId })
    const count = await tgCall<number>(botToken, 'getChatMemberCount', { chat_id: chatId }).catch(() => 0)
    const membership = await tgCall<{ status?: string }>(botToken, 'getChatMember', { chat_id: chatId, user_id: me.id }).catch(() => null)
    const admins = await tgCall<Array<{ user: TgUser; status: string }>>(botToken, 'getChatAdministrators', { chat_id: chatId }).catch(() => [])
    const chatNumericId = typeof chat.id === 'number' ? String(chat.id) : /^-?\d+$/.test(chatId) ? chatId : null
    return {
      credentials: { bot_token: botToken, chat_id: chatId, webhook_secret: randomBytes(32).toString('base64url') },
      metadata: {
        group_name: chat.title ?? 'Telegram group',
        member_count: count,
        chat_numeric_id: chatNumericId,
        chat_type: chat.type,
        username: chat.username ?? null,
        bot_username: me.username ?? null,
        bot_id: me.id,
        // Privacy mode on means the bot only sees commands and replies; admin bots see everything.
        privacy_mode: me.can_read_all_group_messages !== true,
        bot_is_admin: isAdmin(membership?.status ?? undefined),
        admins: admins
          .filter((a) => !a.user.is_bot)
          .slice(0, 50)
          .map((a) => ({ id: String(a.user.id), username: a.user.username ?? null, first_name: a.user.first_name ?? null, status: a.status })),
      },
    }
  },
  async sync({ bot_token, chat_id, webhook_secret }, ctx?: SyncContext) {
    const members = await tgCall<number>(bot_token, 'getChatMemberCount', { chat_id })
    // Self healing webhook: once an hour make sure Telegram still points at us.
    if (ctx && webhook_secret) {
      const row = await repo.getRow(ctx.workspaceId, 'telegram')
      const checkedAt = row ? Date.parse(String(row.metadata.webhook_checked_at ?? '')) : NaN
      if (row && !(checkedAt > Date.now() - WEBHOOK_CHECK_MS)) {
        const expected = webhookUrlFor(row.id)
        if (expected) {
          const info = await webhookInfo(bot_token).catch(() => null)
          let webhook = row.metadata.webhook
          if (info && info.url !== expected) {
            webhook = await registerWebhook(bot_token, expected, webhook_secret)
              .then(() => 'set')
              .catch(() => 'failed')
            integrationLog('telegram.webhook_reregistered', { workspaceId: ctx.workspaceId, ok: webhook === 'set' })
          }
          await repo.patchMetadata(ctx.workspaceId, 'telegram', { webhook, webhook_checked_at: new Date().toISOString(), ...(info?.last_error_message && { webhook_last_error: info.last_error_message.slice(0, 200) }) })
        }
      }
    }
    return { metrics: { members } }
  },
}
