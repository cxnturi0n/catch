import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { discordMembershipSnapshots, discordMemberTenure } from '../db/schema/index.js'
import { discordFetch } from '../integrations/discord/rest.js'
import * as integrations from '../modules/integrations/repo.js'
import { publishMany } from '../lib/events.js'

// Pages the full member list (needs the privileged SERVER MEMBERS intent),
// records join dates and derives new/left counts against the previous run.
// Self-limited to once per 20 hours because it walks the whole guild.
const PAGE_SIZE = 1000
const MAX_PAGES = 20
const UPSERT_CHUNK = 500
export const MEMBERS_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000
const PRESENCE_TOLERANCE_MS = 5 * 60 * 1000

export type MembersResult =
  | { ok: true; total: number; new: number; left: number; truncated: boolean }
  | { ok: false; code: 'NOT_CONNECTED' | 'MISSING_MEMBERS_INTENT' | 'UPSTREAM' | 'THROTTLED'; message: string }

export const MISSING_INTENT_MESSAGE =
  'The bot needs the privileged "Server Members Intent" (Discord Developer Portal → Bot → Privileged Gateway Intents).'

export async function lastMembersRun(workspaceId: string): Promise<Date | null> {
  const [row] = await db.select({ at: discordMembershipSnapshots.capturedAt }).from(discordMembershipSnapshots).where(eq(discordMembershipSnapshots.workspaceId, workspaceId)).orderBy(desc(discordMembershipSnapshots.capturedAt)).limit(1)
  return row?.at ?? null
}

export async function syncDiscordMembers(workspaceId: string, opts: { force?: boolean } = {}): Promise<MembersResult> {
  const creds = await integrations.getCredentials<{ bot_token: string; server_id: string }>(workspaceId, 'discord')
  if (!creds) return { ok: false, code: 'NOT_CONNECTED', message: 'Discord is not connected' }
  if (!opts.force) {
    const last = await lastMembersRun(workspaceId)
    if (last && Date.now() - last.getTime() < MEMBERS_MIN_INTERVAL_MS) return { ok: false, code: 'THROTTLED', message: 'Member list was synced less than 20 hours ago' }
  }
  const seen = new Map<string, Date | null>()
  let after = '0'
  let truncated = false
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await discordFetch(creds.bot_token, `/guilds/${creds.server_id}/members?limit=${PAGE_SIZE}&after=${after}`)
    if (res.status === 401 || res.status === 403) return { ok: false, code: 'MISSING_MEMBERS_INTENT', message: MISSING_INTENT_MESSAGE }
    if (!res.ok) return { ok: false, code: 'UPSTREAM', message: `Discord API error (${res.status})` }
    const batch = (await res.json()) as Array<{ joined_at?: string; user?: { id: string; bot?: boolean } }>
    if (!Array.isArray(batch) || batch.length === 0) break
    let highest = after
    for (const m of batch) {
      const u = m.user
      if (!u?.id) continue
      if (BigInt(u.id) > BigInt(highest)) highest = u.id
      if (u.bot) continue
      seen.set(u.id, m.joined_at ? new Date(m.joined_at) : null)
    }
    if (batch.length < PAGE_SIZE || highest === after) break
    after = highest
    if (page === MAX_PAGES - 1) truncated = true
  }
  if (seen.size === 0) return { ok: false, code: 'UPSTREAM', message: 'Discord returned no members' }

  const runAt = new Date()
  const known = await db.select({ ref: discordMemberTenure.memberRef, lastSeen: discordMemberTenure.lastSeen }).from(discordMemberTenure).where(eq(discordMemberTenure.workspaceId, workspaceId))
  const knownMap = new Map(known.map((k) => [k.ref, k.lastSeen]))
  let previousRunMs = 0
  for (const ls of knownMap.values()) previousRunMs = Math.max(previousRunMs, ls.getTime())

  let newMembers = 0
  for (const ref of seen.keys()) if (!knownMap.has(ref)) newMembers++
  let leftMembers = 0
  if (previousRunMs > 0) {
    for (const [ref, ls] of knownMap) {
      const wasPresent = ls.getTime() >= previousRunMs - PRESENCE_TOLERANCE_MS
      if (wasPresent && !seen.has(ref)) leftMembers++
    }
  }

  const rows = [...seen.entries()].map(([memberRef, joinedAt]) => ({ workspaceId, memberRef, joinedAt, lastSeen: runAt }))
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      await tx
        .insert(discordMemberTenure)
        .values(rows.slice(i, i + UPSERT_CHUNK))
        .onConflictDoUpdate({
          target: [discordMemberTenure.workspaceId, discordMemberTenure.memberRef],
          // first_seen intentionally untouched; joined_at refreshed in case Discord now returns it.
          set: { lastSeen: runAt, joinedAt: sql`coalesce(excluded.joined_at, ${discordMemberTenure.joinedAt})` },
        })
    }
    await tx.insert(discordMembershipSnapshots).values({ workspaceId, capturedAt: runAt, totalMembers: seen.size, newMembers, leftMembers })
  })
  await publishMany(workspaceId, ['discord_member_tenure', 'discord_membership_snapshots'])
  return { ok: true, total: seen.size, new: newMembers, left: leftMembers, truncated }
}
