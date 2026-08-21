import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { config, isProduction } from '../config.js'
import { db } from '../db/client.js'
import * as schema from '../db/schema/index.js'
import { actionEmail, sendEmail } from '../email/sender.js'
import { logger } from '../logger.js'
import { recordSecurityEvent, type SecurityEventType } from './security-events.js'

// A social provider is enabled only when both credentials are present, so
// Facebook and X can be switched on by configuration once their apps are
// approved, without a code change. Adding a provider = one entry here.
function providerIf(id: string | undefined, secret: string | undefined) {
  return id && secret ? { clientId: id, clientSecret: secret } : undefined
}

const socialProviders = {
  ...(providerIf(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET) && {
    google: { ...providerIf(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET)!, prompt: 'select_account' as const },
  }),
  ...(providerIf(config.DISCORD_CLIENT_ID, config.DISCORD_CLIENT_SECRET) && {
    discord: providerIf(config.DISCORD_CLIENT_ID, config.DISCORD_CLIENT_SECRET)!,
  }),
  ...(providerIf(config.FACEBOOK_CLIENT_ID, config.FACEBOOK_CLIENT_SECRET) && {
    facebook: providerIf(config.FACEBOOK_CLIENT_ID, config.FACEBOOK_CLIENT_SECRET)!,
  }),
  ...(providerIf(config.TWITTER_CLIENT_ID, config.TWITTER_CLIENT_SECRET) && {
    twitter: providerIf(config.TWITTER_CLIENT_ID, config.TWITTER_CLIENT_SECRET)!,
  }),
}

export const enabledProviders = Object.keys(socialProviders)

// API_URL may carry a path prefix (https://host/api behind the edge proxy).
// Better Auth wants the origin in baseURL and the full prefix in basePath.
const apiUrl = new URL(config.API_URL)
export const authBasePath = `${apiUrl.pathname.replace(/\/$/, '')}/auth`

export const auth = betterAuth({
  appName: 'Catch',
  baseURL: apiUrl.origin,
  basePath: authBasePath,
  secret: config.AUTH_SECRET,
  trustedOrigins: [config.APP_URL],
  database: drizzleAdapter(db, { provider: 'pg', schema }),

  advanced: {
    database: { generateId: 'uuid' },
    useSecureCookies: isProduction,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh expiry at most once a day
    freshAge: 60 * 10, // "sudo mode": sensitive actions need auth within 10 min
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Reset your Catch password',
        ...actionEmail({
          title: 'Reset your password',
          intro: 'We received a request to reset the password for your Catch account. The link is valid for one hour.',
          cta: 'Choose a new password',
          url,
        }),
      })
    },
    onPasswordReset: async ({ user }) => {
      await recordSecurityEvent({ userId: user.id, type: 'password_reset' })
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Verify your email for Catch',
        ...actionEmail({
          title: 'Confirm your email address',
          intro: 'Thanks for signing up. Confirm this address to activate your Catch account. The link is valid for one hour.',
          cta: 'Verify email',
          url,
        }),
      })
    },
  },

  socialProviders,

  account: {
    // Stored provider tokens (used later for nothing yet) are encrypted at rest.
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      // Implicit linking on sign-in only for providers that assert a verified
      // email, and only onto a locally verified user (Better Auth default).
      trustedProviders: ['google', 'discord', 'facebook', 'email-password'],
      // Explicit linking from the settings page may attach an account whose
      // provider email differs (X returns none): the user is already
      // authenticated, which is the ownership proof.
      allowDifferentEmails: true,
      allowUnlinkingAll: false,
    },
  },

  user: {
    // Exposed on the session user; never writable from sign-up/update-user.
    additionalFields: {
      role: { type: 'string', required: false, defaultValue: 'user', input: false },
      plan: { type: 'string', required: false, defaultValue: 'starter', input: false },
    },
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        // Confirmation goes to the CURRENT address: changing email must be
        // approved by whoever owns the account today.
        await sendEmail({
          to: user.email,
          subject: 'Confirm your new Catch email address',
          ...actionEmail({
            title: 'Confirm email change',
            intro: `A request was made to change your Catch email to ${newEmail}. Confirm to proceed.`,
            cta: 'Confirm change',
            url,
            footer: 'If you did not request this, change your password now: someone may have access to your account.',
          }),
        })
      },
    },
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Confirm deletion of your Catch account',
          ...actionEmail({
            title: 'Delete your account',
            intro: 'This permanently deletes your account, workspaces and all associated data. The link is valid for one hour.',
            cta: 'Delete my account',
            url,
          }),
        })
      },
      afterDelete: async (user) => {
        logger.info({ userId: user.id }, 'user deleted')
      },
    },
  },

  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 60,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/request-password-reset': { window: 60, max: 3 },
      '/two-factor/verify-totp': { window: 60, max: 5 },
      '/two-factor/verify-backup-code': { window: 60, max: 3 },
    },
  },

  hooks: {
    // Sign-out destroys the session before `after` runs: record it up front.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-out') return
      const session = await getSessionFromCtx(ctx).catch(() => null)
      const userId = session?.user.id
      if (userId) await recordSecurityEvent({ userId, type: 'logout' })
    }),
    // Audit trail for sensitive endpoints. Runs only on success (after).
    after: createAuthMiddleware(async (ctx) => {
      const map: Record<string, SecurityEventType> = {
        '/change-password': 'password_changed',
        '/two-factor/enable': 'mfa_enabled',
        '/two-factor/disable': 'mfa_disabled',
        '/two-factor/generate-backup-codes': 'backup_codes_regenerated',
        '/link-social': 'account_linked',
        '/unlink-account': 'account_unlinked',
        '/revoke-session': 'session_revoked',
        '/revoke-sessions': 'session_revoked',
        '/revoke-other-sessions': 'session_revoked',
        '/delete-user': 'account_deleted',
      }
      const type = map[ctx.path]
      const userId = ctx.context.session?.user.id
      if (!type || !userId) return
      await recordSecurityEvent({
        userId,
        type,
        ipAddress: ctx.request?.headers.get('x-forwarded-for') ?? null,
        userAgent: ctx.request?.headers.get('user-agent') ?? null,
        metadata: ctx.path.includes('link') ? { provider: (ctx.body as { provider?: string; providerId?: string })?.provider ?? (ctx.body as { providerId?: string })?.providerId } : undefined,
      })
    }),
  },

  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          await recordSecurityEvent({
            userId: session.userId,
            type: 'login_success',
            ipAddress: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
          })
        },
      },
    },
  },

  plugins: [
    twoFactor({
      issuer: 'Catch',
      // Enabling requires a TOTP code first: a user can never be locked out
      // by enabling 2FA with a mis-scanned secret.
      skipVerificationOnEnable: false,
      twoFactorCookieMaxAge: 60 * 5,
      trustDeviceMaxAge: 60 * 60 * 24 * 30,
      backupCodeOptions: { amount: 10, length: 10 },
      accountLockout: { enabled: true },
    }),
  ],
})

export type Auth = typeof auth
