import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { getProfile, updateProfileName } from '../lib/db'
import { isPlanTier, type PlanTier } from '../lib/plan'

export interface AuthUser {
  id: string
  name: string
  email: string
  plan: PlanTier
}

interface AuthResult {
  ok: boolean
  error?: string
}

interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  hasOnboarded: boolean
  login: (email: string, password: string) => Promise<AuthResult>
  signup: (name: string, email: string, password: string) => Promise<AuthResult>
  signInWithGoogle: () => Promise<AuthResult>
  logout: () => void
  completeOnboarding: () => void
  updateProfile: (name: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<AuthResult>
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  return (
    local
      .split(/[._-]/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(' ') || 'Community Manager'
  )
}

async function userFromSession(session: Session | null): Promise<AuthUser | null> {
  const authUser = session?.user
  if (!authUser) return null

  let fullName: string | null = null
  let email: string | null = null
  let plan: PlanTier = 'starter'
  try {
    const profile = await getProfile(authUser.id)
    fullName = profile?.full_name ?? null
    email = profile?.email ?? null
    if (isPlanTier(profile?.plan)) plan = profile.plan
  } catch {
    // profiles row may not have been created yet (trigger lag) — fall back below
  }

  return {
    id: authUser.id,
    name: fullName || (authUser.user_metadata?.full_name as string | undefined) || nameFromEmail(authUser.email ?? ''),
    email: email ?? authUser.email ?? '',
    plan,
  }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasOnboarded, setHasOnboarded] = useState(false)

  useEffect(() => {
    // No Supabase project configured (e.g. env vars missing on this
    // deployment) — stay in guest mode permanently, never touch the client.
    if (!isSupabaseConfigured) {
      setUser(null)
      setIsLoading(false)
      return
    }

    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      userFromSession(data.session).then((u) => {
        if (!cancelled) {
          setUser(u)
          setIsLoading(false)
        }
      })
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void userFromSession(session).then((u) => {
        if (!cancelled) setUser(u)
      })
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  async function login(email: string, password: string): Promise<AuthResult> {
    if (!isSupabaseConfigured) return { ok: false, error: 'Sign-in is not available on this deployment.' }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  async function signup(name: string, email: string, password: string): Promise<AuthResult> {
    if (!isSupabaseConfigured) return { ok: false, error: 'Sign-up is not available on this deployment.' }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name.trim() } },
    })
    if (error) return { ok: false, error: error.message }
    setHasOnboarded(false)
    return { ok: true }
  }

  async function signInWithGoogle(): Promise<AuthResult> {
    if (!isSupabaseConfigured) return { ok: false, error: 'Sign-in is not available on this deployment.' }
    // Redirect back to the dashboard on this same origin (localhost in dev, the
    // deployed host in prod). This URL must be in Supabase's redirect allow-list.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  function logout() {
    void supabase.auth.signOut()
    setHasOnboarded(false)
    // Hard navigation — no need to await signOut(), the reload drops all client state anyway.
    window.location.href = '/'
  }

  function completeOnboarding() {
    setHasOnboarded(true)
  }

  async function updateProfile(name: string): Promise<void> {
    if (!user) return
    const trimmed = name.trim()
    await updateProfileName(user.id, trimmed)
    setUser((prev) => (prev ? { ...prev, name: trimmed } : prev))
  }

  async function updatePassword(newPassword: string): Promise<AuthResult> {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      hasOnboarded,
      login,
      signup,
      signInWithGoogle,
      logout,
      completeOnboarding,
      updateProfile,
      updatePassword,
    }),
    [user, isLoading, hasOnboarded],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
