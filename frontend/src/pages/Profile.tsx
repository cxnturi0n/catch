import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Globe, Loader2, LogOut, Search, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useTimezone } from '../context/TimezoneContext'
import { groupedZones, zoneCity, zoneShortOffset } from '../lib/timezones'
import { formatTimeInTz } from '../lib/formatTime'
import { FormField, inputClass } from '../components/ui/FormControls'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Profile() {
  const { user, updateProfile, logout } = useAuth()
  const { showToast } = useToast()
  const { timezone, setTimezone } = useTimezone()

  const [name, setName] = useState(user?.name ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [tzQuery, setTzQuery] = useState('')

  // A ticking "now" so the live-time preview stays current without a heavy timer.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const zoneGroups = useMemo(() => groupedZones(tzQuery), [tzQuery])

  function handleTimezoneChange(tz: string) {
    setTimezone(tz)
    showToast(`Timezone set to ${zoneCity(tz)} (${zoneShortOffset(tz)})`)
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSavingProfile(true)
    try {
      await updateProfile(name.trim())
      showToast('Profile updated successfully')
    } catch {
      showToast('Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  function handleLogout() {
    void logout()
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="glass rounded-2xl p-6">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1e3a8a] to-[#2f7cf6] text-xl font-bold text-white">
            {initialsOf(user?.name ?? '?')}
          </div>
          <div>
            <div className="text-lg font-semibold text-white">{user?.name}</div>
            <div className="text-sm text-slate-400">{user?.email}</div>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
          <FormField label="Full Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Email">
            <input className={`${inputClass} cursor-not-allowed opacity-60`} value={user?.email ?? ''} readOnly />
          </FormField>
          <div>
            <button
              type="submit"
              disabled={savingProfile}
              className="gradient-bar-emerald sheen flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:shadow-[var(--glow-emerald-strong)] disabled:opacity-60"
            >
              {savingProfile && <Loader2 size={14} className="animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>

      <div className="glass rounded-2xl p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]">
            <Globe size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--text-primary)]">Account timezone</div>
            <div className="text-xs text-[var(--text-secondary)]">
              Used to display every time, date, calendar and schedule across Catch. Data itself stays in UTC — this only changes what you read.
            </div>
          </div>
        </div>

        <FormField label="Timezone">
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                className={`${inputClass} pl-9`}
                placeholder="Search country, city or GMT offset…"
                value={tzQuery}
                onChange={(e) => setTzQuery(e.target.value)}
              />
            </div>
            <select
              className={inputClass}
              value={timezone}
              onChange={(e) => handleTimezoneChange(e.target.value)}
              size={1}
            >
              {zoneGroups.length === 0 && <option value={timezone}>No match — {zoneCity(timezone)}</option>}
              {zoneGroups.map((g) => (
                <optgroup key={g.region} label={g.region}>
                  {g.zones.map((z) => (
                    <option key={z} value={z}>
                      {zoneCity(z)} ({zoneShortOffset(z, new Date(now))}) — {z}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </FormField>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--text-secondary)]">Local time now:</span>
          <span className="rounded-lg bg-[var(--accent-emerald)]/12 px-2.5 py-1 font-mono font-semibold text-[var(--accent-emerald-bright)]">
            {formatTimeInTz(now, timezone)} · {zoneShortOffset(timezone, new Date(now))}
          </span>
          <span className="text-[var(--text-muted)]">{zoneCity(timezone)}</span>
        </div>
      </div>

      <div className="glass flex items-center gap-3 rounded-2xl p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]">
          <ShieldCheck size={18} />
        </div>
        <div>
          <div className="text-sm font-medium text-white">Account security</div>
          <div className="text-xs text-[var(--text-secondary)]">
            Password, two-factor authentication, devices and linked accounts live in{' '}
            <Link to="/dashboard/security" className="text-[var(--accent-emerald-bright)] hover:underline">Security</Link>.
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.03] p-6">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 rounded-xl border border-red-500/40 px-4 py-2.5 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/10"
        >
          <LogOut size={16} /> Log out
        </button>
      </div>
    </div>
  )
}
