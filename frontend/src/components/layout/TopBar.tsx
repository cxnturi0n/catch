import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Bell, Clock, Menu, Moon, Search, Sun } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useTheme } from '../../context/ThemeContext'
import { useTimezone } from '../../context/TimezoneContext'
import { fetchShiftEvents } from '../../lib/dbPlatformV2'
import { fetchModerators } from '../../lib/db'
import { buildShiftNotifications, type AppNotification } from '../../lib/notifications'
import { formatRelativeTime } from '../../lib/format'
import { formatTimeInTz } from '../../lib/formatTime'
import { zoneCity, zoneShortOffset } from '../../lib/timezones'
import { useRealtimeTables } from '../../hooks/useRealtimeTables'
import { CatchMark } from '../brand/CatchMark'
import { StatusUpdatePanel } from '../StatusUpdatePanel'

const ALERT_REFRESH_MS = 5 * 60 * 1000
const SHIFT_TABLES = ['moderator_shift_events'] as const

// Breadcrumb: the macro section (nav group) + the current sub-section, rendered
// as "Group / Sub" in the topbar (mirrors the sidebar grouping).
export const CRUMB: Record<string, { group: string; sub: string }> = {
  '/dashboard/analytics': { group: 'Community Analytics', sub: 'Overview' },
  '/dashboard/listening': { group: 'Community Analytics', sub: 'Listening' },
  '/dashboard/report': { group: 'Community Analytics', sub: 'Report' },
  '/dashboard/moderators': { group: 'Team', sub: 'Moderators' },
  '/dashboard/kol': { group: 'Team', sub: 'KOLs' },
  '/dashboard/payments': { group: 'Team', sub: 'Payments' },
  '/dashboard/leaderboard': { group: 'Team', sub: 'Leaderboard' },
  '/dashboard/tasks': { group: 'Operations', sub: 'Task Manager' },
  '/dashboard/resources': { group: 'Operations', sub: 'Resources' },
  '/dashboard/meetings': { group: 'Operations', sub: 'Meetings' },
  '/dashboard/integrations': { group: 'Setup', sub: 'Integrations' },
  '/dashboard/instructions': { group: 'Setup', sub: 'Catch Instructions' },
  '/dashboard/admin': { group: 'Setup', sub: 'Platform Analytics' },
  '/dashboard/discovery-responses': { group: 'Setup', sub: 'Discovery Responses' },
  '/dashboard/catchlab': { group: 'Lab', sub: 'CatchLab' },
  '/dashboard/profile': { group: 'Account', sub: 'Profile' },
  '/dashboard/security': { group: 'Account', sub: 'Security' },
  '/dashboard/members': { group: 'Workspace', sub: 'Members' },
}
const PLATFORM_SUB: Record<string, string> = { discord: 'Discord', telegram: 'Telegram', galxe: 'Galxe', zealy: 'Zealy' }

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function NotificationIcon({ kind }: { kind: AppNotification['kind'] }) {
  if (kind === 'no_show') return <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
  if (kind === 'late') return <Clock size={15} className="mt-0.5 shrink-0 text-amber-400" />
  return <Bell size={15} className="mt-0.5 shrink-0 text-[var(--accent-emerald)]" />
}

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  const { theme, toggleTheme } = useTheme()
  const { timezone } = useTimezone()
  const location = useLocation()
  const [bellOpen, setBellOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [now, setNow] = useState(() => Date.now())
  const bellRef = useRef<HTMLDivElement>(null)

  // Live clock in the account's timezone — updates each minute.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Pull the CM's real alerts (shift no-shows / lateness) for the active
  // workspace. Guests never have shift events, so this stays empty for them.
  // `alertToken` is what any refresh path (interval, realtime) bumps to re-pull.
  const [alertToken, setAlertToken] = useState(0)
  useEffect(() => {
    if (!user || !activeWorkspaceId) {
      setNotifications([])
      return
    }
    let cancelled = false
    async function load() {
      try {
        const [events, mods] = await Promise.all([
          fetchShiftEvents(activeWorkspaceId, 14).catch(() => []),
          fetchModerators(activeWorkspaceId).catch(() => []),
        ])
        if (!cancelled) setNotifications(buildShiftNotifications(events, mods))
      } catch {
        if (!cancelled) setNotifications([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [user, activeWorkspaceId, alertToken])

  // Floor for the alert feed: even with Realtime down, a no-show logged while
  // the tab sat open surfaces within a few minutes rather than never.
  useEffect(() => {
    if (!user || !activeWorkspaceId) return
    const id = window.setInterval(() => setAlertToken((t) => t + 1), ALERT_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [user, activeWorkspaceId])

  // Fast path: a shift event landing in the DB pops the bell immediately.
  useRealtimeTables(activeWorkspaceId, SHIFT_TABLES, () => setAlertToken((t) => t + 1))

  const platformParam = new URLSearchParams(location.search).get('platform')
  const crumb = CRUMB[location.pathname] ?? { group: 'Catch', sub: 'Dashboard' }
  const subLabel =
    location.pathname === '/dashboard/analytics' && platformParam ? PLATFORM_SUB[platformParam] ?? crumb.sub : crumb.sub

  // Global section search (topbar). Filters known sections; ⌘K focuses the field.
  const [q, setQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const searchResults = q.trim()
    ? Object.entries(CRUMB)
        .map(([to, c]) => ({ to, ...c }))
        .filter((s) => `${s.sub} ${s.group}`.toLowerCase().includes(q.trim().toLowerCase()))
        .slice(0, 6)
    : []

  const unread = notifications.length
  const badgeLabel = unread > 9 ? '9+' : String(unread)

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--border-card)] bg-[var(--bg-primary)]/80 px-4 backdrop-blur-md transition-colors sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          aria-label="Open navigation"
          className="focus-ring flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--raise-hover)] hover:text-[var(--text-primary)] lg:hidden"
        >
          <Menu size={18} />
        </button>
        {/* Section name reveals quickly on each navigation, before the content settles */}
        <motion.div
          key={location.pathname + (platformParam ?? '')}
          initial={{ x: -12 }}
          animate={{ x: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-2.5"
        >
          <span className="h-5 w-[3px] rounded-full bg-gradient-to-b from-[var(--accent-cyan)] to-[var(--accent-emerald)] shadow-[var(--glow-emerald)]" />
          <div className="flex items-center gap-2">
            <span className="hidden text-[13px] font-medium text-[var(--text-muted)] sm:inline">{crumb.group}</span>
            <span className="hidden text-[var(--text-muted)] sm:inline" aria-hidden>/</span>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">{subLabel}</h1>
          </div>
        </motion.div>
      </div>

      <div className="flex items-center gap-3">
        {/* Global section search */}
        <div className="relative hidden md:block">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
            placeholder="Search anything…"
            aria-label="Search sections"
            className="h-10 w-56 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] pl-9 pr-11 text-[13px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[color:var(--sf-hover-border)]"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-[var(--border-card)] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">⌘K</span>
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-full overflow-hidden rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1 shadow-2xl">
              {searchResults.map((r) => (
                <Link
                  key={r.to}
                  to={r.to}
                  onClick={() => { setQ(''); setSearchOpen(false) }}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors hover:bg-[var(--raise-hover)]"
                >
                  <span className="text-[var(--text-muted)]">{r.group}</span>
                  <span className="text-[var(--text-muted)]">/</span>
                  <span className="font-medium text-[var(--text-primary)]">{r.sub}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* One-press briefing: real numbers + a written summary, for the moment
            before a call. Re-reads on every open. */}
        <button
          onClick={() => setStatusOpen(true)}
          title="A quick overview of your community right now"
          className="focus-ring hidden h-10 items-center gap-2 rounded-xl border border-[color:rgba(230,184,77,0.3)] bg-[color:rgba(230,184,77,0.08)] px-3 text-[color:rgba(243,214,148,0.95)] transition-colors hover:bg-[color:rgba(230,184,77,0.14)] md:flex"
        >
          <CatchMark size={18} variant="gold" play={false} />
          <span className="text-[13px] font-semibold">Status Update</span>
        </button>

        <Link
          to="/dashboard/profile"
          title={`Times shown in ${zoneCity(timezone)} (${timezone}). Click to change.`}
          className="focus-ring hidden h-10 items-center gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3 text-[var(--text-secondary)] transition-colors hover:bg-[var(--raise-hover)] hover:text-[var(--text-primary)] sm:flex"
        >
          <Clock size={15} className="text-[var(--accent-emerald)]" />
          <span className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">{formatTimeInTz(now, timezone)}</span>
          <span className="text-[11px] font-medium text-[var(--text-muted)]">{zoneShortOffset(timezone, new Date(now))}</span>
        </Link>

        <button
          onClick={toggleTheme}
          aria-label={theme === 'night' ? 'Switch to day mode' : 'Switch to night mode'}
          title={theme === 'night' ? 'Switch to day mode' : 'Switch to night mode'}
          className="focus-ring flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--raise-hover)] hover:text-[var(--text-primary)]"
        >
          {theme === 'night' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <div ref={bellRef} className="relative">
          <button
            onClick={() => setBellOpen((o) => !o)}
            aria-label="Notifications"
            className="focus-ring relative flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--raise-hover)] hover:text-[var(--text-primary)]"
          >
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-[0_0_10px_rgba(239,68,68,0.6)]">
                {badgeLabel}
              </span>
            )}
          </button>
          <AnimatePresence>
            {bellOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.14 }}
                className="glow absolute right-0 top-[calc(100%+8px)] w-80 overflow-hidden rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-2"
              >
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Notifications</span>
                  {unread > 0 && (
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">{unread} active</span>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-[var(--text-secondary)]">
                    You&apos;re all caught up — no shift issues.
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.map((n) => (
                      <Link
                        key={n.id}
                        to="/dashboard/moderators"
                        onClick={() => setBellOpen(false)}
                        className="flex gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--raise-hover)]"
                      >
                        <NotificationIcon kind={n.kind} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--text-primary)]">{n.title}</div>
                          <div className="text-xs text-[var(--text-secondary)]">{n.detail}</div>
                          <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{formatRelativeTime(n.at)}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Link
          to="/dashboard/profile"
          aria-label="Profile"
          className="focus-ring flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-emerald)] text-sm font-bold text-white shadow-[var(--glow-soft)] transition-all hover:brightness-110"
        >
          {initialsOf(user?.name ?? '?')}
        </Link>
      </div>

      <StatusUpdatePanel open={statusOpen} onClose={() => setStatusOpen(false)} />
    </header>
  )
}
