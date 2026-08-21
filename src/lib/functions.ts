import { supabase } from './supabase'

export interface ConnectResult {
  success: boolean
  server_name?: string
  group_name?: string
  name?: string
  member_count?: number
  followers?: number
  campaign_count?: number
  error?: string
}

export interface SyncResult {
  success: boolean
  members?: number
  bans_7d?: number
  total_xp?: number
  followers?: number
  campaigns?: number
  participants?: number
  error?: string
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (error) {
    // supabase-js hides the function's real error behind a generic
    // "non-2xx status code" message — dig the actual {error} out of the body.
    let message = error.message
    try {
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context
      if (ctx?.json) {
        const parsed = await ctx.json()
        if (parsed?.error) message = parsed.error
      }
    } catch {
      /* keep the generic message */
    }
    throw new Error(message)
  }
  if (!data) throw new Error(`No response from ${name}.`)
  return data
}

export function discordConnect(workspaceId: string, botToken: string, serverId: string): Promise<ConnectResult> {
  return invoke<ConnectResult>('discord-connect', { workspace_id: workspaceId, bot_token: botToken, server_id: serverId })
}

export function discordSync(workspaceId: string): Promise<SyncResult> {
  return invoke<SyncResult>('discord-sync', { workspace_id: workspaceId })
}

export function telegramConnect(workspaceId: string, botToken: string, chatId: string): Promise<ConnectResult> {
  return invoke<ConnectResult>('telegram-connect', { workspace_id: workspaceId, bot_token: botToken, chat_id: chatId })
}

export function telegramSync(workspaceId: string): Promise<SyncResult> {
  return invoke<SyncResult>('telegram-sync', { workspace_id: workspaceId })
}

export function zealyConnect(workspaceId: string, subdomain: string, apiKey: string): Promise<ConnectResult> {
  return invoke<ConnectResult>('zealy-connect', { workspace_id: workspaceId, subdomain, api_key: apiKey })
}

export function zealySync(workspaceId: string): Promise<SyncResult> {
  return invoke<SyncResult>('zealy-sync', { workspace_id: workspaceId })
}

export function galxeConnect(workspaceId: string, alias: string): Promise<ConnectResult> {
  return invoke<ConnectResult>('galxe-connect', { workspace_id: workspaceId, alias })
}

export function galxeSync(workspaceId: string): Promise<SyncResult> {
  return invoke<SyncResult>('galxe-sync', { workspace_id: workspaceId })
}
