import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { RecapPopup } from '../RecapPopup'
import { CatchBar } from '../CatchBar'
import { SectionTutorial } from '../SectionTutorial'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'

function LayoutFallback() {
  return (
    <div className="ambient-field flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-card)] border-t-[var(--accent-emerald)] shadow-[var(--glow-soft)]" />
    </div>
  )
}

// Sidebar width bounds. Dragging below COLLAPSE_AT snaps to the icons-only rail.
const SIDEBAR_MIN = 208
const SIDEBAR_MAX = 360
const SIDEBAR_DEFAULT = 240
const SIDEBAR_COLLAPSED = 72
const SIDEBAR_COLLAPSE_AT = 168
const SIDEBAR_STORAGE_KEY = 'catch:sidebarWidth'

function loadSidebarWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT
  const raw = Number(window.localStorage.getItem(SIDEBAR_STORAGE_KEY))
  if (!Number.isFinite(raw) || raw === 0) return SIDEBAR_DEFAULT
  if (raw <= SIDEBAR_COLLAPSED) return SIDEBAR_COLLAPSED
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, raw))
}

export function MainLayout() {
  const { user } = useAuth()
  const { workspaces, workspacesLoading } = useWorkspace()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth)
  const location = useLocation()

  const collapsed = sidebarWidth <= SIDEBAR_COLLAPSED
  const effectiveWidth = collapsed ? SIDEBAR_COLLAPSED : sidebarWidth

  // Snap a raw drag x-position to either the collapsed rail or a clamped width,
  // then persist it so the choice survives reloads.
  function handleResize(rawWidth: number) {
    const next = rawWidth < SIDEBAR_COLLAPSE_AT ? SIDEBAR_COLLAPSED : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, rawWidth))
    setSidebarWidth(next)
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next))
    } catch {
      /* storage unavailable — width still applies for this session */
    }
  }

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  if (workspacesLoading) return <LayoutFallback />
  // Only signed-in users are forced through onboarding — guests can freely
  // explore the dashboard shell without ever creating a workspace.
  if (user && workspaces.length === 0) return <Navigate to="/onboarding" replace />

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] print:bg-white print:text-black"
      style={{ ['--sidebar-w' as string]: `${effectiveWidth}px` }}
    >
      {/* Sapphire ambient — three slow blurred lights + vignette, the signature
          background element. Kept inside .shell-ambient so day-mode dimming applies. */}
      <div aria-hidden="true" className="shell-ambient pointer-events-none fixed inset-0 z-0 print:hidden">
        <div className="sf-ambient absolute inset-0">
          <div className="sf-light sf-light-a" />
          <div className="sf-light sf-light-b" />
          <div className="sf-light sf-light-c" />
          <div className="sf-vignette" />
        </div>
      </div>

      {/* Mobile drawer scrim */}
      <div
        aria-hidden="true"
        onClick={() => setMobileNavOpen(false)}
        className={`fixed inset-0 z-30 bg-black/60 transition-opacity duration-300 lg:hidden print:hidden ${
          mobileNavOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <div className="relative z-40 print:hidden">
        <Sidebar
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          collapsed={collapsed}
          onResize={handleResize}
        />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col lg:ml-[var(--sidebar-w)] print:ml-0">
        <div className="print:hidden">
          <TopBar onMenuClick={() => setMobileNavOpen(true)} />
        </div>

        {/* Bottom padding tracks the fixed Catch bar's real height (set by CatchBar),
            so the end of every page stays readable even with its answer panel open. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 print:overflow-visible print:p-0" style={{ paddingBottom: 'calc(var(--catch-bar-h, 96px) + 1.5rem)' }}>
          {/* No route transition — content swaps instantly (no "jump on itself"). */}
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Catch Intelligence — the always-present bar along the bottom of the shell. */}
      <CatchBar />

      {/* Cross-platform recap — self-manages visibility (at most once / 2h, on return). */}
      <RecapPopup />

      {/* First-visit tutorial — one small floating card per macro section. */}
      <SectionTutorial />
    </div>
  )
}
