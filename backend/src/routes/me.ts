import type { FastifyInstance } from 'fastify'

// First protected route: who am I. Exercises the session plugin end to end
// and gives the SPA a single call to bootstrap its auth state.
export async function meRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: app.requireSession }, async (req) => {
    const { user, session } = req.auth!
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image ?? null,
        twoFactorEnabled: user.twoFactorEnabled ?? false,
        role: (user as { role?: string }).role ?? 'user',
        plan: (user as { plan?: string }).plan ?? 'starter',
      },
      session: { id: session.id, expiresAt: session.expiresAt },
    }
  })
}
