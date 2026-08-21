import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, isApiError } from '../lib/api/client'
import { authClient, authErrorMessage, type SocialProvider } from '../lib/api/auth'
import type { PlanTier } from '../lib/plan'

export interface AuthUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  twoFactorEnabled: boolean
  role: 'user' | 'admin'
  plan: PlanTier
}

export interface AuthResult {
  ok: boolean
  error?: string
  /** Sign-in succeeded but a second factor is required. */
  twoFactorRequired?: boolean
}

interface MeResponse {
  user: AuthUser
  session: { id: string; expiresAt: string }
}

interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  providers: SocialProvider[]
  refresh: () => Promise<AuthUser | null>
  login: (email: string, password: string) => Promise<AuthResult>
  signup: (name: string, email: string, password: string) => Promise<AuthResult>
  signInWithProvider: (provider: SocialProvider, redirectTo?: string) => Promise<AuthResult>
  logout: () => Promise<void>
  updateProfile: (name: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [providers, setProviders] = useState<SocialProvider[]>([])

  // Session bootstrap: one call to /me. 401 simply means signed out.
  const refresh = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const me = await api<MeResponse>('/me')
      setUser(me.user)
      return me.user
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        setUser(null)
        return null
      }
      // Network/server error: keep whatever we had rather than bouncing to login.
      return user
    }
  }, [user])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api<MeResponse>('/me').then((m) => m.user).catch(() => null),
      api<{ providers: SocialProvider[] }>('/auth-providers').then((r) => r.providers).catch(() => [] as SocialProvider[]),
    ]).then(([u, p]) => {
      if (cancelled) return
      setUser(u)
      setProviders(p)
      setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function login(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await authClient.signIn.email({ email, password })
    if (error) return { ok: false, error: authErrorMessage(error) }
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return { ok: true, twoFactorRequired: true }
    await refresh()
    return { ok: true }
  }

  async function signup(name: string, email: string, password: string): Promise<AuthResult> {
    const { error } = await authClient.signUp.email({ name: name.trim(), email, password, callbackURL: `${window.location.origin}/onboarding` })
    if (error) return { ok: false, error: authErrorMessage(error) }
    // Email verification is mandatory: no session yet.
    return { ok: true }
  }

  async function signInWithProvider(provider: SocialProvider, redirectTo = '/dashboard'): Promise<AuthResult> {
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: `${window.location.origin}${redirectTo}`,
      errorCallbackURL: `${window.location.origin}/login?error=oauth`,
      newUserCallbackURL: `${window.location.origin}/onboarding`,
    })
    if (error) return { ok: false, error: authErrorMessage(error) }
    return { ok: true } // browser is being redirected
  }

  async function logout() {
    await authClient.signOut().catch(() => undefined)
    setUser(null)
    window.location.href = '/'
  }

  async function updateProfile(name: string) {
    const { error } = await authClient.updateUser({ name: name.trim() })
    if (error) throw new Error(authErrorMessage(error))
    setUser((prev) => (prev ? { ...prev, name: name.trim() } : prev))
  }

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: user !== null, isLoading, providers, refresh, login, signup, signInWithProvider, logout, updateProfile }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, isLoading, providers, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
