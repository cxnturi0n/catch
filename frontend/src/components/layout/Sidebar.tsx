import { useMemo, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BarChart2, BookOpen, CheckSquare, ChevronDown, FileText, FlaskConical, FolderOpen, Gauge, Gem, Inbox, MessageSquare, Plug, Radar, Send, ShieldCheck, Trophy, Users, type LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { CatchLabGlyph, SECTION_GLYPH } from './sectionIcons'
import { CatchMark } from '../brand/CatchMark'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { OWNER_EMAIL } from '../../lib/adminAnalytics'
import type { IntegrationKey } from '../../types'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  // Analytics platform drill-down (/dashboard/analytics?platform=<key>).
  platform?: IntegrationKey
  // The bare Analytics dashboard, active only when NO ?platform param is set.
  isDashboard?: boolean
}
interface NavGroup {
  label: string
  items: NavItem[]
}

// Analytics sub-items: one per live platform. Order is fixed; only Connected
// platforms are rendered (see buildGroups). Icons mirror the Integrations page.
const PLATFORM_NAV: { key: IntegrationKey; label: string; icon: LucideIcon }[] = [
  { key: 'discord', label: 'Discord', icon: MessageSquare },
  { key: 'telegram', label: 'Telegram', icon: Send },
  { key: 'galxe', label: 'Galxe', icon: Gem },
  { key: 'zealy', label: 'Zealy', icon: Trophy },
]

// Standalone top-level link (sits under the fixed groups).
const CATCHLAB: NavItem = { to: '/dashboard/catchlab', label: 'CatchLab', icon: FlaskConical }

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Active state accounts for the ?platform= search param, which NavLink ignores. */
function isItemActive(item: NavItem, pathname: string, platformParam: string | null): boolean {
  if (item.platform) {
    return pathname === '/dashboard/analytics' && platformParam === item.platform
  }
  if (item.isDashboard) {
    return pathname === '/dashboard/analytics' && !platformParam
  }
  return pathname === item.to || pathname.startsWith(item.to + '/')
}

/** One nav row, icon + label, with the sliding active pill. In collapsed mode
 *  the label is hidden and the icon is centered, with a native tooltip. */
function NavRow({ item, active, collapsed, onClose }: { item: NavItem; active: boolean; collapsed: boolean; onClose?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      onClick={onClose}
      title={collapsed ? item.label : undefined}
      className={`group relative flex items-center overflow-hidden rounded-xl py-2.5 text-[13.5px] font-medium transition-colors ${
        collapsed ? 'justify-center px-0' : 'gap-3 pl-3 pr-3'
      } ${active ? 'text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--raise-hover)] hover:text-[var(--text-primary)]'}`}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active-bg"
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          className="absolute inset-0 rounded-xl border border-[color:rgba(91,140,255,0.30)] bg-gradient-to-r from-[color:rgba(47,107,255,0.26)] to-[color:rgba(47,107,255,0.06)]"
        />
      )}
      <Icon size={17} className={`relative shrink-0 transition-colors ${active ? 'text-[color:rgba(147,180,255,0.95)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'}`} />
      {!collapsed && <span className="relative truncate">{item.label}</span>}
    </NavLink>
  )
}

export function Sidebar({
  mobileOpen = false,
  onClose,
  collapsed = false,
  onResize,
}: {
  mobileOpen?: boolean
  onClose?: () => void
  collapsed?: boolean
  onResize?: (rawWidth: number) => void
}) {
  const { user } = useAuth()
  const { getWorkspaceIntegrations, activeWorkspaceId } = useWorkspace()
  const { pathname, search } = useLocation()
  const platformParam = new URLSearchParams(search).get('platform')

  // Build the nav tree, the Analytics group lists one item per Connected platform.
  const navGroups = useMemo<NavGroup[]>(() => {
    const integrations = getWorkspaceIntegrations(activeWorkspaceId)
    const connected = PLATFORM_NAV.filter((p) => integrations[p.key]?.status === 'Connected')
    return [
      {
        label: 'Community Analytics',
        items: [
          { to: '/dashboard/analytics', label: 'Overview', icon: BarChart2, isDashboard: true },
          ...connected.map<NavItem>((p) => ({
            to: `/dashboard/analytics?platform=${p.key}`,
            label: p.label,
            icon: p.icon,
            platform: p.key,
          })),
          { to: '/dashboard/listening', label: 'Listening', icon: Radar },
          { to: '/dashboard/report', label: 'Report', icon: FileText },
        ],
      },
      {
        label: 'Team',
        items: [
          { to: '/dashboard/moderators', label: 'Moderators', icon: ShieldCheck },
          { to: '/dashboard/kol', label: 'KOLs', icon: Users },
        ],
      },
      {
        label: 'Operations',
        items: [
          { to: '/dashboard/tasks', label: 'Task Manager', icon: CheckSquare },
          { to: '/dashboard/resources', label: 'Resources', icon: FolderOpen },
        ],
      },
      {
        label: 'Setup',
        items: [
          { to: '/dashboard/integrations', label: 'Integrations', icon: Plug },
          { to: '/dashboard/members', label: 'Members', icon: Users },
          { to: '/dashboard/instructions', label: 'Catch Instructions', icon: BookOpen },
          // Owner-only pages, the routes/RLS also enforce this.
          ...(user?.email?.toLowerCase() === OWNER_EMAIL
            ? [
                { to: '/dashboard/admin', label: 'Platform Analytics', icon: Gauge } as NavItem,
                { to: '/dashboard/discovery-responses', label: 'Discovery Responses', icon: Inbox } as NavItem,
              ]
            : []),
        ],
      },
    ]
  }, [getWorkspaceIntegrations, activeWorkspaceId, user])

  const planName = user?.plan ? user.plan[0].toUpperCase() + user.plan.slice(1) : 'Starter'

  // Collapsible macro groups (all expanded by default). Search now lives in the topbar.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const toggle = (label: string) => setCollapsedGroups((c) => ({ ...c, [label]: !c[label] }))

  // ── Drag-to-resize (desktop only). The handle reports the raw pointer x so
  //    MainLayout can snap it to the collapsed rail or a clamped width. ──
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)

  function startResize(e: React.PointerEvent) {
    if (!onResize) return
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return
      onResize(ev.clientX)
    }
    const onUp = () => {
      draggingRef.current = false
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <aside
      className={`fixed left-0 top-0 z-40 flex h-screen w-[240px] flex-col border-r border-[var(--border-card)] bg-[var(--bg-card)] lg:w-[var(--sidebar-w)] ${
        dragging ? '' : 'transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
      } lg:translate-x-0 ${mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}
    >
      {/* Thin sapphire edge-light down the right border */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-[var(--accent-emerald)]/25 to-transparent" />

      {/* Drag-to-resize handle, desktop only, sits on the right edge. */}
      {onResize && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={startResize}
          className="group absolute inset-y-0 -right-1 z-50 hidden w-2 cursor-col-resize lg:block"
        >
          <div className={`absolute inset-y-0 right-1 w-px transition-colors ${dragging ? 'bg-[var(--accent-emerald)]' : 'bg-transparent group-hover:bg-[var(--accent-emerald)]/50'}`} />
        </div>
      )}

      <div className={`flex items-center py-5 ${collapsed ? 'justify-center px-0' : 'gap-2 px-5'}`}>
        <CatchMark size={collapsed ? 34 : 40} play={false} />
        {!collapsed && <span className="text-shine text-2xl font-extrabold tracking-tight">Catch</span>}
      </div>

      {!collapsed && (
        <div className="px-3">
          <WorkspaceSwitcher />
        </div>
      )}

      {/* Catch AI, its own section, marked by the gold "C". */}
      <div className={`mt-3 ${collapsed ? 'px-2' : 'px-3'}`}>
        <NavLink
          to="/dashboard/catch"
          onClick={onClose}
          title={collapsed ? 'Catch' : undefined}
          className={({ isActive }) =>
            `group relative flex items-center overflow-hidden rounded-xl border py-2.5 transition-colors ${
              collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5'
            } ${
              isActive
                ? 'border-[color:rgba(230,184,77,0.45)] bg-[color:rgba(230,184,77,0.12)]'
                : 'border-[color:rgba(230,184,77,0.20)] bg-[color:rgba(230,184,77,0.05)] hover:bg-[color:rgba(230,184,77,0.10)]'
            }`
          }
        >
          <CatchMark size={collapsed ? 22 : 24} variant="gold" play={false} />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-[color:rgba(243,214,148,0.98)]">Catch</span>
              <span className="block font-mono text-[9.5px] uppercase tracking-[0.14em] text-[color:rgba(230,184,77,0.6)]">
                you throw, I catch
              </span>
            </span>
          )}
        </NavLink>
      </div>

      {!collapsed && <div className="mx-3 mt-3 h-px bg-[var(--border-card)]" />}

      {/* Collapsible macro groups. Header = distinct uppercase mono eyebrow with a
          chevron; click toggles. Sub-items are the larger NavRow entries.
          When collapsed, headers are hidden and items render as an icon rail. */}
      <nav className={`mt-3 flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden pb-2 ${collapsed ? 'items-stretch px-2' : 'px-3'}`}>
        {navGroups.map((group, gi) => {
          const Glyph = SECTION_GLYPH[group.label]
          const isCollapsed = collapsedGroups[group.label] ?? false
          if (collapsed) {
            return (
              <div key={group.label} className="flex flex-col">
                {gi > 0 && <div className="mx-2 my-1.5 h-px bg-[var(--border-card)]" />}
                {group.items.map((item) => (
                  <NavRow key={item.to} item={item} collapsed active={isItemActive(item, pathname, platformParam)} onClose={onClose} />
                ))}
              </div>
            )
          }
          return (
            <div key={group.label} className="mb-1.5 flex flex-col">
              <button
                type="button"
                onClick={() => toggle(group.label)}
                aria-expanded={!isCollapsed}
                className="flex items-center justify-between px-3 pb-1 pt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
              >
                <span className="flex items-center gap-1.5">
                  {Glyph && <Glyph size={12} className="shrink-0 opacity-70" />}
                  {group.label}
                </span>
                <ChevronDown size={12} className={`shrink-0 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`} />
              </button>
              {!isCollapsed && (
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <NavRow key={item.to} item={item} collapsed={false} active={isItemActive(item, pathname, platformParam)} onClose={onClose} />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Standalone CatchLab. */}
        {collapsed ? (
          <div className="flex flex-col">
            <div className="mx-2 my-1.5 h-px bg-[var(--border-card)]" />
            <NavRow item={CATCHLAB} collapsed active={isItemActive(CATCHLAB, pathname, platformParam)} onClose={onClose} />
          </div>
        ) : (
          <div className="mb-1.5 flex flex-col">
            <button
              type="button"
              onClick={() => toggle('Lab')}
              aria-expanded={!(collapsedGroups['Lab'] ?? false)}
              className="flex items-center justify-between px-3 pb-1 pt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
            >
              <span className="flex items-center gap-1.5">
                <CatchLabGlyph size={12} className="shrink-0 opacity-70" />
                Lab
              </span>
              <ChevronDown size={12} className={`shrink-0 transition-transform duration-200 ${(collapsedGroups['Lab'] ?? false) ? '-rotate-90' : ''}`} />
            </button>
            {!(collapsedGroups['Lab'] ?? false) && (
              <NavRow item={CATCHLAB} collapsed={false} active={isItemActive(CATCHLAB, pathname, platformParam)} onClose={onClose} />
            )}
          </div>
        )}
      </nav>

      {/* Plan card + upgrade CTA, hidden in the collapsed rail. */}
      {!collapsed && (
        <div className="mx-3 mb-3 mt-1">
          <div
            className="sf-sweep relative overflow-hidden rounded-2xl border border-[color:rgba(120,160,255,0.22)] p-3.5"
            style={{ background: 'linear-gradient(150deg, rgba(47,107,255,0.22), rgba(88,60,232,0.14))' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-bold text-white">{planName} plan</span>
              <span className="rounded-full bg-white/[0.12] px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--accent-emerald-bright)]">
                PRO
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-[color:rgba(223,231,251,0.75)]">
              Unlock more moderator seats and advanced features.
            </p>
            <button
              type="button"
              className="mt-2.5 w-full rounded-lg bg-gradient-to-r from-[#3F7BFF] to-[#2050E6] py-2 text-[12px] font-semibold text-white shadow-[0_8px_18px_-8px_rgba(47,107,255,0.6)] transition hover:brightness-110"
            >
              Upgrade to PRO
            </button>
          </div>
        </div>
      )}

      <div className="mx-3 mb-2 h-px bg-[var(--border-card)]" />

      <NavLink
        to="/dashboard/profile"
        onClick={onClose}
        title={collapsed ? (user?.name ?? 'Guest') : undefined}
        className={({ isActive }) =>
          `mx-3 mb-4 flex items-center rounded-xl py-2.5 transition-colors ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} ${
            isActive ? 'bg-[var(--raise-hover-strong)]' : 'hover:bg-[var(--raise-hover)]'
          }`
        }
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-emerald)] text-xs font-bold text-white shadow-[var(--glow-soft)]">
          {initialsOf(user?.name ?? 'Guest')}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--text-primary)]">{user?.name ?? 'Guest'}</div>
            <div className="truncate text-xs text-[var(--text-secondary)]">{user?.email ?? 'Not signed in'}</div>
          </div>
        )}
      </NavLink>
    </aside>
  )
}
