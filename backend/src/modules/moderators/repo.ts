import { and, count, desc, eq, gte } from 'drizzle-orm'
import { db, type DbOrTx } from '../../db/client.js'
import { moderatorResponseMetrics, moderatorShiftEvents, moderators, type Moderator } from '../../db/schema/index.js'
import type { ModeratorBody, ModeratorOut } from './schemas.js'

export function toOut(m: Moderator): ModeratorOut {
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    fullName: m.fullName,
    discordHandle: m.discordHandle,
    telegramHandle: m.telegramHandle,
    discordUserId: m.discordUserId,
    telegramUserId: m.telegramUserId,
    platforms: m.platforms,
    startDate: m.startDate,
    contractType: m.contractType,
    timezone: m.timezone,
    country: m.country,
    status: m.status,
    notes: m.notes,
    warnings: m.warnings as ModeratorOut['warnings'],
    bio: m.bio,
    skills: m.skills,
    languages: m.languages,
    platformsKnown: m.platformsKnown,
    externalSource: m.externalSource,
    profilePhotoUrl: m.profilePhotoUrl,
    cvFilename: m.cvFilename,
    hasCv: m.cvStoragePath !== null,
    cvExtractedText: m.cvExtractedText,
    shiftStartUtc: m.shiftStartUtc,
    shiftEndUtc: m.shiftEndUtc,
    shiftDays: m.shiftDays,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }
}

// Maps validated body fields onto columns; `undefined` = leave unchanged.
function toColumns(b: Partial<ModeratorBody>) {
  const c: Partial<typeof moderators.$inferInsert> = {}
  if (b.fullName !== undefined) c.fullName = b.fullName
  if (b.discordHandle !== undefined) c.discordHandle = b.discordHandle || null
  if (b.telegramHandle !== undefined) c.telegramHandle = b.telegramHandle || null
  if (b.discordUserId !== undefined) c.discordUserId = b.discordUserId || null
  if (b.telegramUserId !== undefined) c.telegramUserId = b.telegramUserId || null
  if (b.platforms !== undefined) c.platforms = b.platforms
  if (b.startDate !== undefined) c.startDate = b.startDate
  if (b.contractType !== undefined) c.contractType = b.contractType
  if (b.timezone !== undefined) c.timezone = b.timezone || null
  if (b.country !== undefined) c.country = b.country || null
  if (b.status !== undefined) c.status = b.status
  if (b.notes !== undefined) c.notes = b.notes || null
  if (b.warnings !== undefined) c.warnings = b.warnings
  if (b.bio !== undefined) c.bio = b.bio || null
  if (b.skills !== undefined) c.skills = b.skills
  if (b.languages !== undefined) c.languages = b.languages
  if (b.platformsKnown !== undefined) c.platformsKnown = b.platformsKnown
  if (b.externalSource !== undefined) c.externalSource = b.externalSource || null
  if (b.profilePhotoUrl !== undefined) c.profilePhotoUrl = b.profilePhotoUrl || null
  if (b.shiftStartUtc !== undefined) c.shiftStartUtc = b.shiftStartUtc
  if (b.shiftEndUtc !== undefined) c.shiftEndUtc = b.shiftEndUtc
  if (b.shiftDays !== undefined) c.shiftDays = b.shiftDays
  return c
}

export async function list(workspaceId: string): Promise<Moderator[]> {
  return db.select().from(moderators).where(eq(moderators.workspaceId, workspaceId)).orderBy(moderators.createdAt)
}

export async function get(workspaceId: string, id: string): Promise<Moderator | undefined> {
  const [m] = await db
    .select()
    .from(moderators)
    .where(and(eq(moderators.workspaceId, workspaceId), eq(moderators.id, id)))
    .limit(1)
  return m
}

export async function countIn(workspaceId: string, tx: DbOrTx = db): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(moderators).where(eq(moderators.workspaceId, workspaceId))
  return r?.n ?? 0
}

export async function create(workspaceId: string, body: ModeratorBody, tx: DbOrTx = db): Promise<Moderator> {
  const [m] = await tx
    .insert(moderators)
    .values({ workspaceId, ...toColumns(body), fullName: body.fullName })
    .returning()
  return m!
}

export async function update(workspaceId: string, id: string, body: Partial<ModeratorBody>): Promise<Moderator | undefined> {
  const cols = toColumns(body)
  if (Object.keys(cols).length === 0) return get(workspaceId, id)
  const [m] = await db
    .update(moderators)
    .set(cols)
    .where(and(eq(moderators.workspaceId, workspaceId), eq(moderators.id, id)))
    .returning()
  return m
}

export async function setCv(
  workspaceId: string,
  id: string,
  cv: { storagePath: string | null; filename: string | null; extractedText: string | null },
): Promise<Moderator | undefined> {
  const [m] = await db
    .update(moderators)
    .set({ cvStoragePath: cv.storagePath, cvFilename: cv.filename, cvExtractedText: cv.extractedText })
    .where(and(eq(moderators.workspaceId, workspaceId), eq(moderators.id, id)))
    .returning()
  return m
}

export async function remove(workspaceId: string, id: string): Promise<Moderator | undefined> {
  const [m] = await db
    .delete(moderators)
    .where(and(eq(moderators.workspaceId, workspaceId), eq(moderators.id, id)))
    .returning()
  return m
}

function sinceDate(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

export async function shiftEvents(workspaceId: string, sinceDays: number, moderatorId?: string) {
  const where = [eq(moderatorShiftEvents.workspaceId, workspaceId), gte(moderatorShiftEvents.day, sinceDate(sinceDays))]
  if (moderatorId) where.push(eq(moderatorShiftEvents.moderatorId, moderatorId))
  return db
    .select({
      moderatorId: moderatorShiftEvents.moderatorId,
      day: moderatorShiftEvents.day,
      expectedStartUtc: moderatorShiftEvents.expectedStartUtc,
      expectedEndUtc: moderatorShiftEvents.expectedEndUtc,
      firstActivityUtc: moderatorShiftEvents.firstActivityUtc,
      wasOnTime: moderatorShiftEvents.wasOnTime,
    })
    .from(moderatorShiftEvents)
    .where(and(...where))
    .orderBy(desc(moderatorShiftEvents.day))
}

export async function responseMetrics(workspaceId: string, sinceDays: number, moderatorId?: string) {
  const where = [eq(moderatorResponseMetrics.workspaceId, workspaceId), gte(moderatorResponseMetrics.day, sinceDate(sinceDays))]
  if (moderatorId) where.push(eq(moderatorResponseMetrics.moderatorId, moderatorId))
  return db
    .select({
      moderatorId: moderatorResponseMetrics.moderatorId,
      platform: moderatorResponseMetrics.platform,
      day: moderatorResponseMetrics.day,
      responsesCount: moderatorResponseMetrics.responsesCount,
      avgResponseSeconds: moderatorResponseMetrics.avgResponseSeconds,
    })
    .from(moderatorResponseMetrics)
    .where(and(...where))
    .orderBy(desc(moderatorResponseMetrics.day))
}
