import * as integrations from '../modules/integrations/repo.js'
import { getSharedClient, withMtprotoLock, type MtprotoClientLike } from '../integrations/telegram/mtproto.js'
import { publish, publishMany } from '../lib/events.js'
import { integrationLog } from '../lib/integrationLog.js'
import { ingestBatch, MESSAGE_TOPICS, type IngestInput } from './ingest.js'
import type { BackfillProgress } from './discordBackfill.js'

// History import for public Telegram groups and channels through the MTProto
// client. Same progress shape as Discord (integrations.metadata.backfill).
// Message ids are shared between the Bot API and MTProto, so rows the webhook
// already stored are simply duplicates.

export const TELEGRAM_BACKFILL_DAYS = 30
export const TELEGRAM_BACKFILL_MAX = 50_000

export async function runTelegramBackfill(workspaceId: string, opts: { client?: MtprotoClientLike | null; now?: Date } = {}): Promise<BackfillProgress | null> {
  const row = await integrations.getRow(workspaceId, 'telegram')
  if (!row || row.status !== 'connected') return null
  const now = opts.now ?? new Date()
  const progress: BackfillProgress = { status: 'running', channelsDone: 0, channelsTotal: 1, channelsSkipped: 0, messages: 0, startedAt: now.toISOString() }
  const save = async () => {
    await integrations.patchMetadata(workspaceId, 'telegram', { backfill: progress })
    await publish(workspaceId, 'integrations')
  }
  const username = typeof row.metadata.username === 'string' ? row.metadata.username : null
  const client = opts.client === undefined ? getSharedClient() : opts.client
  if (!username || !client) {
    progress.status = 'skipped'
    progress.reason = !client ? 'not_configured' : 'private_group'
    progress.finishedAt = new Date().toISOString()
    await save()
    return progress
  }
  await save()
  integrationLog('backfill.start', { workspaceId, platform: 'telegram', username })
  const chatId = String(row.metadata.chat_numeric_id ?? '')
  const groupName = typeof row.metadata.group_name === 'string' ? row.metadata.group_name : null
  const sinceUnix = Math.floor(now.getTime() / 1000) - TELEGRAM_BACKFILL_DAYS * 86_400
  try {
    await withMtprotoLock(async () => {
      const chat = await client.resolvePublicChat(username)
      if (!chat.isPublic) throw new Error('Group is not public')
      const prefix = chatId || `-100${chat.id}`
      let seen = 0
      for await (const page of client.iterHistory(username, { sinceUnix, max: TELEGRAM_BACKFILL_MAX })) {
        const batch: IngestInput[] = []
        for (const m of page) {
          seen++
          if (!m.senderId) continue // anonymous admins, channel posts
          batch.push({
            workspaceId,
            platform: 'telegram',
            messageId: `${prefix}:${m.id}`,
            channelId: m.topicId ? String(m.topicId) : prefix,
            channelName: m.topicId ? null : groupName,
            memberRef: m.senderId,
            displayName: m.senderName,
            isBot: m.isBot,
            content: m.text,
            replyToMessageId: m.replyToId ? `${prefix}:${m.replyToId}` : null,
            sentAt: new Date(m.date * 1000),
            source: 'mtproto',
          })
        }
        if (batch.length) progress.messages += (await ingestBatch(batch, 'none')).inserted
        await save()
      }
      progress.channelsDone = 1
      progress.status = seen >= TELEGRAM_BACKFILL_MAX ? 'partial' : 'done'
    })
    progress.finishedAt = new Date().toISOString()
    await save()
    await publishMany(workspaceId, [...MESSAGE_TOPICS, 'platform_channels'])
    integrationLog('backfill.done', { workspaceId, platform: 'telegram', ...progress })
    return progress
  } catch (err) {
    progress.status = 'failed'
    progress.error = err instanceof Error ? err.message : 'Backfill failed'
    progress.finishedAt = new Date().toISOString()
    await save()
    integrationLog('backfill.failed', { workspaceId, platform: 'telegram', error: progress.error })
    throw err
  }
}
