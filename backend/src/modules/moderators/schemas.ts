import { z } from 'zod'

export const warningSchema = z.object({
  id: z.string().min(1).max(64),
  date: z.string().min(1).max(32),
  reason: z.string().trim().min(1).max(1000),
  severity: z.enum(['Low', 'Medium', 'High']),
  issuedBy: z.string().trim().max(120).default(''),
})

const hour = z.number().int().min(0).max(23)
const strList = (max = 30) => z.array(z.string().trim().min(1).max(60)).max(max)

export const moderatorBody = z.object({
  fullName: z.string().trim().min(1).max(120),
  discordHandle: z.string().trim().max(80).nullish(),
  telegramHandle: z.string().trim().max(80).nullish(),
  platforms: strList(10).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  contractType: z.string().trim().max(40).optional(),
  timezone: z.string().trim().max(64).nullish(),
  country: z.string().trim().max(8).nullish(),
  status: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(5000).nullish(),
  warnings: z.array(warningSchema).max(200).optional(),
  bio: z.string().trim().max(5000).nullish(),
  skills: strList().optional(),
  languages: strList().optional(),
  platformsKnown: strList().optional(),
  externalSource: z.string().trim().max(200).nullish(),
  profilePhotoUrl: z.url().max(500).nullish(),
  shiftStartUtc: hour.nullish(),
  shiftEndUtc: hour.nullish(),
  shiftDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
})

export type ModeratorBody = z.infer<typeof moderatorBody>

export const moderatorOut = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  fullName: z.string(),
  discordHandle: z.string().nullable(),
  telegramHandle: z.string().nullable(),
  platforms: z.array(z.string()),
  startDate: z.string().nullable(),
  contractType: z.string(),
  timezone: z.string().nullable(),
  country: z.string().nullable(),
  status: z.string(),
  notes: z.string().nullable(),
  warnings: z.array(warningSchema.partial({ issuedBy: true })),
  bio: z.string().nullable(),
  skills: z.array(z.string()),
  languages: z.array(z.string()),
  platformsKnown: z.array(z.string()),
  externalSource: z.string().nullable(),
  profilePhotoUrl: z.string().nullable(),
  cvFilename: z.string().nullable(),
  hasCv: z.boolean(),
  cvExtractedText: z.string().nullable(),
  shiftStartUtc: z.number().nullable(),
  shiftEndUtc: z.number().nullable(),
  shiftDays: z.array(z.number()),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type ModeratorOut = z.infer<typeof moderatorOut>
