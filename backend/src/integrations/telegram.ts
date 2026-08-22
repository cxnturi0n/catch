import { PlatformError, upstreamFetch, type PlatformClient } from './types.js'

export interface TelegramCredentials extends Record<string, string> {
  bot_token: string
  chat_id: string
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

const TOKEN = /^\d+:[A-Za-z0-9_-]{30,}$/

async function call<T>(botToken: string, method: string, params: Record<string, string>): Promise<T> {
  if (!TOKEN.test(botToken)) throw new PlatformError('Invalid bot token format', 'INVALID_CREDENTIALS')
  const qs = new URLSearchParams(params).toString()
  const res = await upstreamFetch(`https://api.telegram.org/bot${botToken}/${method}?${qs}`)
  const body = (await res.json().catch(() => ({ ok: false }))) as TgResponse<T>
  if (!body.ok) {
    const d = body.description ?? ''
    if (/unauthorized/i.test(d)) throw new PlatformError('Invalid bot token', 'INVALID_CREDENTIALS', 401)
    if (/chat not found/i.test(d)) throw new PlatformError('Chat not found (is the bot a member?)', 'NOT_FOUND', 404)
    if (res.status === 429) throw new PlatformError('Telegram rate limit reached', 'RATE_LIMITED', 429)
    throw new PlatformError('Telegram API error', 'UPSTREAM', res.status)
  }
  return body.result as T
}

export const telegram: PlatformClient<TelegramCredentials, TelegramConnectInput> = {
  async connect({ botToken, chatId }) {
    const chat = await call<{ title?: string; type: string }>(botToken, 'getChat', { chat_id: chatId })
    const count = await call<number>(botToken, 'getChatMemberCount', { chat_id: chatId }).catch(() => 0)
    return { credentials: { bot_token: botToken, chat_id: chatId }, metadata: { group_name: chat.title ?? 'Telegram group', member_count: count } }
  },
  async sync({ bot_token, chat_id }) {
    const members = await call<number>(bot_token, 'getChatMemberCount', { chat_id })
    return { metrics: { members } }
  },
}
