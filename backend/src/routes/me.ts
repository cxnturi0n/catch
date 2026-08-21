import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { userProfiles } from '../db/schema/index.js'

const profileBody = z.object({
  jobRole: z.string().trim().max(60).nullish(),
  managesMultiple: z.boolean().nullish(),
  communitySize: z.string().trim().max(40).nullish(),
  primaryPlatforms: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  timezone: z.string().trim().max(64).nullish(),
  onboarded: z.boolean().optional(),
  layoutPromptSeen: z.boolean().optional(),
})

// Who am I + the non-auth profile fields collected during onboarding.
export async function meRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get('/me', { preHandler: app.requireSession }, async (req) => {
    const { user, session } = req.auth!
    const profile = await db.query.userProfiles.findFirst({ where: eq(userProfiles.userId, user.id) })
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image ?? null,
        twoFactorEnabled: user.twoFactorEnabled ?? false,
        role: user.role ?? 'user',
        plan: user.plan ?? 'starter',
      },
      profile: profile
        ? {
            jobRole: profile.jobRole,
            managesMultiple: profile.managesMultiple,
            communitySize: profile.communitySize,
            primaryPlatforms: profile.primaryPlatforms,
            timezone: profile.timezone,
            onboardedAt: profile.onboardedAt,
            layoutPromptSeenAt: profile.layoutPromptSeenAt,
          }
        : null,
      session: { id: session.id, expiresAt: session.expiresAt },
    }
  })

  r.patch('/me/profile', { preHandler: app.requireSession, schema: { body: profileBody } }, async (req) => {
    const b = req.body
    const now = new Date()
    const values = {
      ...(b.jobRole !== undefined && { jobRole: b.jobRole }),
      ...(b.managesMultiple !== undefined && { managesMultiple: b.managesMultiple }),
      ...(b.communitySize !== undefined && { communitySize: b.communitySize }),
      ...(b.primaryPlatforms !== undefined && { primaryPlatforms: b.primaryPlatforms }),
      ...(b.timezone !== undefined && { timezone: b.timezone }),
      ...(b.onboarded && { onboardedAt: now }),
      ...(b.layoutPromptSeen && { layoutPromptSeenAt: now }),
    }
    await db
      .insert(userProfiles)
      .values({ userId: req.auth!.user.id, ...values })
      .onConflictDoUpdate({ target: userProfiles.userId, set: { ...values, updatedAt: now } })
    return { ok: true }
  })
}
