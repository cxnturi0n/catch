import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { channelActivity, messageActivity, platformChannels, platformMessages } from '../db/schema/index.js'
import { encryptSecret } from '../lib/crypto.js'
import { publishMany, publishThrottled } from '../lib/events.js'
import { recordMemberMessage, sanitizeName } from './memberMessages.js'

// Single entry point for every message collector (Discord gateway, Discord
// REST fallback and backfill, Telegram webhook, Telegram MTProto backfill).
// A message is stored once (unique on workspace, platform, message id) and
// the counters (member_messages, message_activity, channel_activity) are only
// incremented when the row was actually inserted, so overlapping sources
// never double count.

export type MessagePlatform = 'discord' | 'telegram'
export type IngestSource = 'gateway' | 'rest' | 'backfill' | 'webhook' | 'mtproto'

export interface IngestInput {
  workspaceId: string
  platform: MessagePlatform
  messageId: string
  channelId: string
  channelName?: string | null
  memberRef: string
  displayName: string | null
  isBot?: boolean
  content?: string | null
  replyToMessageId?: string | null
  sentAt: Date
  source: IngestSource
}

export type IngestOutcome = 'inserted' | 'duplicate' | 'skipped'
export interface IngestSummary {
  inserted: number
  duplicates: number
  skipped: number
}

export const MAX_CONTENT_CHARS = 4000
const CHUNK = 500
export const MESSAGE_TOPICS = ['message_activity', 'member_messages', 'platform_messages']

// Control characters other than newline (10) and tab (9) are dropped; length
// capped; empty becomes null. Built from code points so the source stays printable.
const C = String.fromCharCode
const CONTENT_CONTROL = new RegExp('[' + C(0) + '-' + C(8) + C(11) + '-' + C(31) + C(127) + ']', 'g')

export function sanitizeContent(raw: string | null | undefined): string | null {
  if (!raw) return null
  const clean = raw.replace(CONTENT_CONTROL, '').slice(0, MAX_CONTENT_CHARS).trim()
  return clean || null
}

export function hourBucket(date: Date): Date {
  const d = new Date(date)
  d.setUTCMinutes(0, 0, 0)
  return d
}

export async function bumpActivity(workspaceId: string, platform: MessagePlatform, bucket: Date, delta: number) {
  await db
    .insert(messageActivity)
    .values({ workspaceId, platform, bucketStart: bucket, messageCount: delta })
    .onConflictDoUpdate({
      target: [messageActivity.workspaceId, messageActivity.platform, messageActivity.bucketStart],
      set: { messageCount: sql`${messageActivity.messageCount} + ${delta}`, updatedAt: new Date() },
    })
}

export async function bumpChannelActivity(workspaceId: string, platform: MessagePlatform, channelId: string, day: string, delta: number) {
  await db
    .insert(channelActivity)
    .values({ workspaceId, platform, channelId, day, messageCount: delta })
    .onConflictDoUpdate({
      target: [channelActivity.workspaceId, channelActivity.platform, channelActivity.channelId, channelActivity.day],
      set: { messageCount: sql`${channelActivity.messageCount} + ${delta}`, updatedAt: new Date() },
    })
}

export interface ChannelInfo {
  name?: string | null
  type?: string | null
  parentId?: string | null
  position?: number | null
  isTracked?: boolean
  lastMessageAt?: Date | null
}

// Upsert a channel row; only the provided fields change.
export async function upsertChannel(workspaceId: string, platform: MessagePlatform, channelId: string, info: ChannelInfo) {
  const name = info.name === undefined ? undefined : sanitizeName(info.name)
  const last = info.lastMessageAt ?? null
  await db
    .insert(platformChannels)
    .values({ workspaceId, platform, channelId, name: name ?? null, type: info.type ?? null, parentId: info.parentId ?? null, position: info.position ?? null, isTracked: info.isTracked ?? true, lastMessageAt: last })
    .onConflictDoUpdate({
      target: [platformChannels.workspaceId, platformChannels.platform, platformChannels.channelId],
      set: {
        ...(name !== undefined && { name: sql`coalesce(${name}, ${platformChannels.name})` }),
        ...(info.type !== undefined && { type: info.type }),
        ...(info.parentId !== undefined && { parentId: info.parentId }),
        ...(info.position !== undefined && { position: info.position }),
        ...(info.isTracked !== undefined && { isTracked: info.isTracked }),
        ...(last && { lastMessageAt: sql`greatest(coalesce(${platformChannels.lastMessageAt}, ${last}), ${last})` }),
        updatedAt: new Date(),
      },
    })
}

function valid(i: IngestInput): boolean {
  return !i.isBot && !!i.memberRef && !!i.messageId && !!i.channelId && i.sentAt instanceof Date && !Number.isNaN(i.sentAt.getTime())
}

export type PublishMode = 'now' | 'throttled' | 'none'

// Stores what is new, then applies the counters for the inserted rows only.
export async function ingestBatch(items: IngestInput[], publish: PublishMode = 'now'): Promise<IngestSummary> {
  const out: IngestSummary = { inserted: 0, duplicates: 0, skipped: 0 }
  const byKey = new Map<string, IngestInput>()
  for (const i of items) {
    if (!valid(i)) {
      out.skipped++
      continue
    }
    const key = `${i.workspaceId}|${i.platform}|${i.messageId}`
    if (byKey.has(key)) out.duplicates++
    else byKey.set(key, i)
  }
  const list = [...byKey.values()]
  const insertedInputs: IngestInput[] = []
  for (let off = 0; off < list.length; off += CHUNK) {
    const chunk = list.slice(off, off + CHUNK)
    const rows = chunk.map((i) => {
      const content = sanitizeContent(i.content)
      return {
        workspaceId: i.workspaceId,
        platform: i.platform,
        messageId: i.messageId,
        channelId: i.channelId,
        memberRef: i.memberRef,
        displayName: sanitizeName(i.displayName),
        replyToMessageId: i.replyToMessageId ?? null,
        sentAt: i.sentAt,
        contentEnc: content ? encryptSecret(content) : null,
        hasContent: content !== null,
        source: i.source,
      }
    })
    const inserted = await db.insert(platformMessages).values(rows).onConflictDoNothing().returning({ workspaceId: platformMessages.workspaceId, platform: platformMessages.platform, messageId: platformMessages.messageId })
    const ok = new Set(inserted.map((r) => `${r.workspaceId}|${r.platform}|${r.messageId}`))
    for (const i of chunk) {
      if (ok.has(`${i.workspaceId}|${i.platform}|${i.messageId}`)) insertedInputs.push(i)
      else out.duplicates++
    }
  }
  out.inserted = insertedInputs.length
  if (out.inserted === 0) return out

  // Aggregate the deltas so a 100 message page costs a handful of upserts.
  const members = new Map<string, { ws: string; platform: MessagePlatform; ref: string; name: string | null; first: Date; last: Date; n: number }>()
  const hours = new Map<string, { ws: string; platform: MessagePlatform; bucket: Date; n: number }>()
  const channels = new Map<string, { ws: string; platform: MessagePlatform; channelId: string; day: string; name: string | null; last: Date; n: number }>()
  for (const i of insertedInputs) {
    const day = i.sentAt.toISOString().slice(0, 10)
    const mk = `${i.workspaceId}|${i.platform}|${i.memberRef}|${day}`
    const m = members.get(mk)
    if (m) {
      m.n++
      if (i.sentAt < m.first) m.first = i.sentAt
      if (i.sentAt > m.last) m.last = i.sentAt
      m.name ??= i.displayName
    } else members.set(mk, { ws: i.workspaceId, platform: i.platform, ref: i.memberRef, name: i.displayName, first: i.sentAt, last: i.sentAt, n: 1 })
    const bucket = hourBucket(i.sentAt)
    const hk = `${i.workspaceId}|${i.platform}|${bucket.getTime()}`
    const h = hours.get(hk)
    if (h) h.n++
    else hours.set(hk, { ws: i.workspaceId, platform: i.platform, bucket, n: 1 })
    const ck = `${i.workspaceId}|${i.platform}|${i.channelId}|${day}`
    const c = channels.get(ck)
    if (c) {
      c.n++
      if (i.sentAt > c.last) c.last = i.sentAt
      c.name ??= i.channelName ?? null
    } else channels.set(ck, { ws: i.workspaceId, platform: i.platform, channelId: i.channelId, day, name: i.channelName ?? null, last: i.sentAt, n: 1 })
  }
  for (const m of members.values()) await recordMemberMessage(m.ws, m.platform, m.ref, m.name, m.first, m.n, m.last)
  for (const h of hours.values()) await bumpActivity(h.ws, h.platform, h.bucket, h.n)
  const touched = new Map<string, { ws: string; platform: MessagePlatform; channelId: string; name: string | null; last: Date }>()
  for (const c of channels.values()) {
    await bumpChannelActivity(c.ws, c.platform, c.channelId, c.day, c.n)
    const tk = `${c.ws}|${c.platform}|${c.channelId}`
    const t = touched.get(tk)
    if (t) {
      if (c.last > t.last) t.last = c.last
      t.name ??= c.name
    } else touched.set(tk, { ws: c.ws, platform: c.platform, channelId: c.channelId, name: c.name, last: c.last })
  }
  for (const t of touched.values()) await upsertChannel(t.ws, t.platform, t.channelId, { name: t.name ?? undefined, lastMessageAt: t.last })

  if (publish !== 'none') {
    for (const ws of new Set(insertedInputs.map((i) => i.workspaceId))) {
      if (publish === 'now') await publishMany(ws, MESSAGE_TOPICS)
      else publishThrottled(ws, MESSAGE_TOPICS)
    }
  }
  return out
}

export async function ingestMessage(i: IngestInput, publish: PublishMode = 'now'): Promise<IngestOutcome> {
  const r = await ingestBatch([i], publish)
  return r.inserted ? 'inserted' : r.duplicates ? 'duplicate' : 'skipped'
}
