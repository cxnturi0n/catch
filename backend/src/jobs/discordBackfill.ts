import { eq, and } from 'drizzle-orm'
import { db } from '../db/client.js'
import { discordChannelCursors } from '../db/schema/index.js'
import { snowflakeToDate, type AuditLogPage } from '../integrations/discord/client.js'
import { discordFetch } from '../integrations/discord/rest.js'
import { auditUserNames, mapAuditEntry } from '../integrations/discord/auditLog.js'
import { channelType } from '../integrations/discord/gatewayEvents.js'
import * as integrations from '../modules/integrations/repo.js'
import { publish, publishMany } from '../lib/events.js'
import { integrationLog } from '../lib/integrationLog.js'
import { ingestBatch, MESSAGE_TOPICS, upsertChannel, type IngestInput } from './ingest.js'
import { toIngest, type DiscordRestMessage } from './discordActivity.js'
import { recordModeratorActions } from './moderatorActions.js'
import { PlatformError } from '../integrations/types.js'

// One-off history import after connect: walks every text channel and active
// thread newest first until the cutoff, then the audit log. Everything goes
// through the shared ingest, so a restart or an overlap with the gateway
// never double counts. Progress lives in integrations.metadata.backfill so
// the Integrations card can show it.

export const BACKFILL_DAYS = 30
export const BACKFILL_MAX_MESSAGES = 50_000
export const PAGE_LIMIT = 100
export const MAX_PAGES_PER_CHANNEL = 500
export const AUDIT_MAX_ENTRIES = 2_000
const TEXT_TYPES = new Set([0, 5])

export interface BackfillProgress {
  status: 'queued' | 'running' | 'done' | 'partial' | 'failed' | 'skipped'
  channelsDone: number
  channelsTotal: number
  channelsSkipped: number
  messages: number
  actions?: number
  startedAt: string
  finishedAt?: string
  error?: string
  reason?: string
}

interface RestChannel {
  id: string
  type?: number
  name?: string
  parent_id?: string | null
  position?: number
}

export async function runDiscordBackfill(workspaceId: string, opts: { now?: Date } = {}): Promise<BackfillProgress | null> {
  const creds = await integrations.getCredentials<{ bot_token: string; server_id: string }>(workspaceId, 'discord')
  if (!creds) return null
  const now = opts.now ?? new Date()
  const cutoff = now.getTime() - BACKFILL_DAYS * 86_400_000
  const progress: BackfillProgress = { status: 'running', channelsDone: 0, channelsTotal: 0, channelsSkipped: 0, messages: 0, startedAt: now.toISOString() }
  const save = async () => {
    await integrations.patchMetadata(workspaceId, 'discord', { backfill: progress })
    await publish(workspaceId, 'integrations')
  }
  await save()
  integrationLog('backfill.start', { workspaceId, platform: 'discord' })

  try {
    const [chRes, thRes] = await Promise.all([discordFetch(creds.bot_token, `/guilds/${creds.server_id}/channels`), discordFetch(creds.bot_token, `/guilds/${creds.server_id}/threads/active`)])
    if (chRes.status === 401 || chRes.status === 403) throw new PlatformError('Bot cannot list channels', 'MISSING_PERMISSION', chRes.status)
    if (!chRes.ok) throw new PlatformError(`Discord API error (${chRes.status})`, 'UPSTREAM', chRes.status)
    const all = (await chRes.json()) as RestChannel[]
    const threads = thRes.ok ? (((await thRes.json()) as { threads?: RestChannel[] }).threads ?? []) : []
    for (const c of [...all, ...threads]) await upsertChannel(workspaceId, 'discord', c.id, { name: c.name ?? null, type: channelType(c.type), parentId: c.parent_id ?? null, position: c.position ?? null, isTracked: true })
    const targets = [...all.filter((c) => TEXT_TYPES.has(c.type ?? -1)), ...threads]
    progress.channelsTotal = targets.length
    await save()

    const cursorRows = await db.select({ channelId: discordChannelCursors.channelId }).from(discordChannelCursors).where(eq(discordChannelCursors.workspaceId, workspaceId))
    const anchored = new Set(cursorRows.map((r) => r.channelId))
    let seen = 0
    let capped = false

    for (const channel of targets) {
      if (capped) break
      let before: string | null = null
      let pages = 0
      let newest: string | null = null
      let reachedCutoff = false
      let skipped = false
      while (pages < MAX_PAGES_PER_CHANNEL && !reachedCutoff && !capped) {
        const res = await discordFetch(creds.bot_token, `/channels/${channel.id}/messages?limit=${PAGE_LIMIT}${before ? `&before=${before}` : ''}`)
        if (res.status === 403 || res.status === 404) {
          skipped = true
          break
        }
        if (!res.ok) throw new PlatformError(`Discord API error (${res.status}) reading channel ${channel.id}`, 'UPSTREAM', res.status)
        const messages = (await res.json()) as DiscordRestMessage[]
        pages++
        if (messages.length === 0) break
        newest ??= messages[0]!.id
        const batch: IngestInput[] = []
        for (const m of messages) {
          if (snowflakeToDate(m.id).getTime() < cutoff) {
            reachedCutoff = true
            break
          }
          const i = toIngest(workspaceId, m, channel.id, 'backfill')
          if (i) {
            i.channelName = channel.name ?? null
            batch.push(i)
          }
          seen++
          if (seen >= BACKFILL_MAX_MESSAGES) {
            capped = true
            break
          }
        }
        if (batch.length) progress.messages += (await ingestBatch(batch, 'none')).inserted
        before = messages[messages.length - 1]!.id
        if (messages.length < PAGE_LIMIT) break
      }
      if (skipped) progress.channelsSkipped++
      else progress.channelsDone++
      // Anchor the REST fallback so it never re-walks what the backfill covered.
      if (newest && !anchored.has(channel.id)) {
        await db.insert(discordChannelCursors).values({ workspaceId, channelId: channel.id, lastMessageId: newest }).onConflictDoNothing()
        anchored.add(channel.id)
      }
      integrationLog('backfill.channel', { workspaceId, channelId: channel.id, pages, messages: progress.messages, skipped })
      await save()
    }

    // Audit log (last 30 days, executor known): bans, kicks, timeouts, deletes.
    let actions = 0
    let auditBefore: string | null = null
    let auditSeen = 0
    for (;;) {
      const res = await discordFetch(creds.bot_token, `/guilds/${creds.server_id}/audit-logs?limit=100${auditBefore ? `&before=${auditBefore}` : ''}`)
      if (res.status === 403) {
        await integrations.patchMetadata(workspaceId, 'discord', { audit_log: 'forbidden' })
        break
      }
      if (!res.ok) break
      const page = (await res.json()) as AuditLogPage
      const entries = page.audit_log_entries ?? []
      if (entries.length === 0) break
      const names = auditUserNames(page.users)
      const inWindow = entries.filter((e) => snowflakeToDate(e.id).getTime() >= cutoff)
      actions += await recordModeratorActions(inWindow.map((e) => mapAuditEntry(workspaceId, e, names)).filter((a) => a !== null))
      auditSeen += entries.length
      if (inWindow.length < entries.length || entries.length < 100 || auditSeen >= AUDIT_MAX_ENTRIES) break
      auditBefore = entries[entries.length - 1]!.id
    }
    if (actions || progress.channelsDone) await integrations.patchMetadata(workspaceId, 'discord', { audit_log: 'ok' })
    progress.actions = actions
    progress.status = capped ? 'partial' : 'done'
    progress.finishedAt = new Date().toISOString()
    await save()
    await publishMany(workspaceId, [...MESSAGE_TOPICS, 'moderator_actions', 'platform_channels'])
    integrationLog('backfill.done', { workspaceId, platform: 'discord', ...progress })
    return progress
  } catch (err) {
    progress.status = 'failed'
    progress.error = err instanceof Error ? err.message : 'Backfill failed'
    progress.finishedAt = new Date().toISOString()
    await save()
    integrationLog('backfill.failed', { workspaceId, platform: 'discord', error: progress.error })
    throw err
  }
}

export const _and = and
