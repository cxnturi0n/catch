import type { CommunityMember, WorkspaceId } from '../types'

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function daysAgoDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function initials(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 2).toUpperCase()
  return parts || 'U'
}

const DISCORD_NAMES = [
  'arb_maxi', 'defi_degen', 'crypto_monk', 'nft_wave', 'web3_builder',
  'on_chain_01', 'layer2_lord', 'eth_lurker', 'arbitrageur', 'dao_voter',
  'gwei_saver', 'rollup_fan', 'yield_hunter', 'block_scout', 'zk_believer',
  'alpha_seeker', 'rugged_once', 'ngmi_never', 'wagmi_always', 'based_chad',
]

const TELEGRAM_NAMES = [
  'tg_whale', 'moon_math', 'shill_stopper', 'fud_fighter', 'gem_hunter',
  'rug_detector', 'alpha_leak', 'dyor_bro', 'apeing_in', 'ser_wen',
  'pump_notic3r', 'bear_market_vet', 'bull_run_ready', 'stack_sats',
  'not_financial_advice', 'hodl_king', 'liquidated_again', 'leverage_ape',
]

export function getLeaderboard(workspaceId: WorkspaceId): CommunityMember[] {
  const rand = mulberry32(hashStr(workspaceId))
  const members: CommunityMember[] = []

  const discordCount = 12
  const telegramCount = 8

  for (let i = 0; i < discordCount; i++) {
    const name = DISCORD_NAMES[i % DISCORD_NAMES.length]
    const suffix = Math.floor(rand() * 900 + 100)
    const username = `${name}_${suffix}`
    const messages = Math.floor(rand() * 1800 + 200)
    const reactions = Math.floor(rand() * messages * 0.6)
    const daysActive = Math.floor(rand() * 25 + 5)
    const joinedDaysAgo = Math.floor(rand() * 300 + 30)
    members.push({
      id: `discord-${i}`,
      username,
      platform: 'Discord',
      avatarInitials: initials(username),
      messagesCount: messages,
      reactionsReceived: reactions,
      daysActive,
      joinedDate: daysAgoDate(joinedDaysAgo),
      engagementScore: messages + reactions * 3 + daysActive * 2,
    })
  }

  for (let i = 0; i < telegramCount; i++) {
    const name = TELEGRAM_NAMES[i % TELEGRAM_NAMES.length]
    const suffix = Math.floor(rand() * 900 + 100)
    const username = `${name}_${suffix}`
    const messages = Math.floor(rand() * 1400 + 100)
    const reactions = Math.floor(rand() * messages * 0.5)
    const daysActive = Math.floor(rand() * 22 + 3)
    const joinedDaysAgo = Math.floor(rand() * 250 + 20)
    members.push({
      id: `telegram-${i}`,
      username,
      platform: 'Telegram',
      avatarInitials: initials(username),
      messagesCount: messages,
      reactionsReceived: reactions,
      daysActive,
      joinedDate: daysAgoDate(joinedDaysAgo),
      engagementScore: messages + reactions * 3 + daysActive * 2,
    })
  }

  return members.sort((a, b) => b.engagementScore - a.engagementScore)
}
