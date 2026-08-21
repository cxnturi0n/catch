import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { getProfile, updateProfileTimezone } from '../lib/db'
import { detectBrowserTimeZone, isValidTimeZone } from '../lib/timezones'

interface TimezoneContextValue {
  /** Active IANA zone used to render every time/date across the app. */
  timezone: string
  /** True while the account's saved zone is being loaded from the profile. */
  loading: boolean
  /** Whether the user has ever explicitly chosen a zone (vs. auto-detected). */
  isExplicit: boolean
  setTimezone: (tz: string) => void
}

const STORAGE_KEY = 'catch:timezone'

const TimezoneContext = createContext<TimezoneContextValue | null>(null)

function readStored(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v && isValidTimeZone(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Account-level display timezone. Resolution order:
 *   1. the zone saved on the user's profile (authoritative, cross-device)
 *   2. the last zone chosen on this browser (localStorage) — also used for guests
 *   3. the browser's auto-detected zone
 * Choosing a zone writes it to localStorage immediately and, when signed in,
 * best-effort to the profile so it follows the account. Display-only: no stored
 * data is reinterpreted, times are just rendered in this zone.
 */
export function TimezoneProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [timezone, setTz] = useState<string>(() => readStored() ?? detectBrowserTimeZone())
  const [isExplicit, setIsExplicit] = useState<boolean>(() => readStored() !== null)
  const [loading, setLoading] = useState<boolean>(false)

  // When a user signs in, reconcile the profile zone with the local one.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const profile = await getProfile(user.id)
        if (cancelled) return
        const saved = profile?.timezone
        if (saved && isValidTimeZone(saved)) {
          // Profile wins — adopt it everywhere.
          setTz(saved)
          setIsExplicit(true)
          try { window.localStorage.setItem(STORAGE_KEY, saved) } catch { /* ignore */ }
        } else if (readStored()) {
          // No profile zone yet, but this browser has an explicit choice → persist it up.
          void updateProfileTimezone(user.id, timezone).catch(() => {})
        }
      } catch {
        /* profile unavailable — keep the locally-resolved zone */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const setTimezone = useCallback((tz: string) => {
    if (!isValidTimeZone(tz)) return
    setTz(tz)
    setIsExplicit(true)
    try { window.localStorage.setItem(STORAGE_KEY, tz) } catch { /* ignore */ }
    if (user?.id) void updateProfileTimezone(user.id, tz).catch(() => {})
  }, [user?.id])

  return (
    <TimezoneContext.Provider value={{ timezone, loading, isExplicit, setTimezone }}>
      {children}
    </TimezoneContext.Provider>
  )
}

export function useTimezone(): TimezoneContextValue {
  const ctx = useContext(TimezoneContext)
  if (!ctx) throw new Error('useTimezone must be used within TimezoneProvider')
  return ctx
}
