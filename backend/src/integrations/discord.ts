import { PlatformError, upstreamFetch, type PlatformClient } from './types.js'

export interface DiscordCredentials extends Record<string, string> {
  bot_token: string
  server_id: string
}
export interface DiscordConnectInput {
  botToken: string
  serverId: string
}

const API = 'https://discord.com/api/v10'
const DISCORD_EPOCH = 1_420_070_400_000
const SNOWFLAKE = /^\d{15,22}$/

export function snowflakeToDate(id: string): Date {
  return new Date(Number(BigInt(id) >> 22n) + DISCORD_EPOCH)
}

async function guild(botToken: string, serverId: string) {
  if (!SNOWFLAKE.test(serverId)) throw new PlatformError('Server id must be a numeric Discord id', 'NOT_FOUND')
  const res = await upstreamFetch(`${API}/guilds/${serverId}?with_counts=true`, { headers: { Authorization: `Bot ${botToken}` } })
  if (res.status === 401 || res.status === 403) throw new PlatformError('Invalid bot token', 'INVALID_CREDENTIALS', res.status)
  if (res.status === 404) throw new PlatformError('Bot is not in that server', 'NOT_FOUND', 404)
  if (res.status === 429) throw new PlatformError('Discord rate limit reached', 'RATE_LIMITED', 429)
  if (!res.ok) throw new PlatformError(`Discord API error (${res.status})`, 'UPSTREAM', res.status)
  return (await res.json()) as { name: string; icon: string | null; approximate_member_count?: number }
}

export const discord: PlatformClient<DiscordCredentials, DiscordConnectInput> = {
  async connect({ botToken, serverId }) {
    const g = await guild(botToken, serverId)
    return {
      credentials: { bot_token: botToken, server_id: serverId },
      metadata: { server_name: g.name, member_count: g.approximate_member_count ?? 0, icon: g.icon },
    }
  },
  async sync({ bot_token, server_id }) {
    const g = await guild(bot_token, server_id)
    const members = g.approximate_member_count ?? 0
    let bans_7d: number | undefined
    // Ban count needs "View Audit Log"; silently absent when the bot lacks it.
    const audit = await upstreamFetch(`${API}/guilds/${server_id}/audit-logs?action_type=22&limit=100`, { headers: { Authorization: `Bot ${bot_token}` } })
    if (audit.ok) {
      const log = (await audit.json()) as { audit_log_entries: Array<{ id: string }> }
      const since = Date.now() - 7 * 86_400_000
      bans_7d = log.audit_log_entries.filter((e) => snowflakeToDate(e.id).getTime() >= since).length
    }
    return { metrics: { members, ...(bans_7d !== undefined && { bans_7d }) } }
  },
}
