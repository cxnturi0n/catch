import { createAuthClient } from 'better-auth/client'
import { twoFactorClient } from 'better-auth/client/plugins'
import { API_URL } from './client'

// Better Auth browser client. The backend mounts auth at `${API_URL}/auth`.
// When baseURL carries a path, the client uses it as the full auth prefix.
const authBaseURL = `${API_URL.startsWith('http') ? API_URL : `${window.location.origin}${API_URL}`}/auth`

export const authClient = createAuthClient({
  baseURL: authBaseURL,
  plugins: [
    twoFactorClient({
      // When sign-in answers "second factor required", the app routes to the
      // challenge screen instead of the dashboard.
      onTwoFactorRedirect() {
        window.location.assign('/two-factor')
      },
    }),
  ],
})

export type SocialProvider = 'google' | 'discord' | 'facebook' | 'twitter'

export const PROVIDER_LABELS: Record<SocialProvider, string> = {
  google: 'Google',
  discord: 'Discord',
  facebook: 'Facebook',
  twitter: 'X',
}

/** Human-readable message for Better Auth / API failures. */
export function authErrorMessage(err: { message?: string; code?: string } | null | undefined, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback
  switch (err.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Incorrect email or password.'
    case 'EMAIL_NOT_VERIFIED':
      return 'Please verify your email before signing in. Check your inbox for the link.'
    case 'USER_ALREADY_EXISTS':
      return 'An account with this email already exists. Sign in instead.'
    case 'PASSWORD_TOO_SHORT':
      return 'Password must be at least 10 characters.'
    case 'INVALID_PASSWORD':
      return 'Incorrect password.'
    case 'INVALID_CODE':
    case 'INVALID_TOTP_CODE':
      return 'That code is not valid. Try again.'
    case 'TOO_MANY_ATTEMPTS':
      return 'Too many attempts. Please wait a few minutes.'
    default:
      return err.message || fallback
  }
}
