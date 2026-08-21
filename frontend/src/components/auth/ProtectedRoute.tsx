import { useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

function AuthGateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-card)] border-t-[var(--accent-purple)]" />
    </div>
  )
}

// Auth gate: the dashboard is for signed-in users only. While the session is
// still restoring we show a loader (never redirect mid-restore); once we know
// the user is not authenticated, send them to Google sign-in. No guest access.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <AuthGateFallback />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

// Guards direct navigation to /login or /signup while a session already
// exists (e.g. a restored localStorage session). Captures isAuthenticated
// only at mount rather than reacting to it live — login/signup flip
// isAuthenticated true *during* their own submit handler, which already
// navigates explicitly; reacting to that here would race the explicit
// navigate() call and could redirect to the wrong place mid-transition.
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const [wasAuthenticatedOnMount, setWasAuthenticatedOnMount] = useState<boolean | null>(isLoading ? null : isAuthenticated)

  // Session restoration is async — if we're still loading on first render,
  // capture the flag once loading finishes instead of at mount.
  if (wasAuthenticatedOnMount === null && !isLoading) {
    setWasAuthenticatedOnMount(isAuthenticated)
  }

  if (isLoading || wasAuthenticatedOnMount === null) return <AuthGateFallback />

  if (wasAuthenticatedOnMount) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
