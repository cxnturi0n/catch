import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Loader2, Plus, Upload, User, X } from 'lucide-react'
import type { Moderator } from '../../../types'
import {
  deleteModeratorCv,
  getCvSignedUrl,
  updateModeratorProfile,
  uploadModeratorCv,
} from '../../../lib/dbPlatformV2'
import { extractPdfText } from '../../../lib/cvParser'
import { useWorkspace } from '../../../context/WorkspaceContext'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'

// ── shift helpers ────────────────────────────────────────────────────────────
const TIMEZONES = ['UTC', 'GMT', 'CET', 'EET', 'EST', 'CST', 'MST', 'PST', 'BRT', 'IST', 'SGT', 'KST', 'JST']
const WEEKDAYS: { key: number; short: string }[] = [
  { key: 1, short: 'Mon' }, { key: 2, short: 'Tue' }, { key: 3, short: 'Wed' },
  { key: 4, short: 'Thu' }, { key: 5, short: 'Fri' }, { key: 6, short: 'Sat' }, { key: 0, short: 'Sun' },
]
const pad = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`
const arrEq = (a: string[] = [], b: string[] = []) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

const PLATFORM_DOT: Record<string, string> = {
  discord: '#7EA6FF', telegram: '#5FD8F5', zealy: '#FF8F7F', galxe: '#B0A2FF', twitter: '#8E9BBA',
}

function monthsInTeam(startDate?: string): number | null {
  if (!startDate) return null
  const d = new Date(startDate)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()))
}

// ── chip editor ──────────────────────────────────────────────────────────────
function ChipEditor({
  items, onChange, tone = 'sapphire', dotted = false, placeholder = 'Name…',
}: {
  items: string[]
  onChange: (next: string[]) => void
  tone?: 'sapphire' | 'green'
  dotted?: boolean
  placeholder?: string
}) {
  const [adding, setAdding] = useState(false)
  const [val, setVal] = useState('')
  function commit() {
    const v = val.trim()
    if (v && !items.some((i) => i.toLowerCase() === v.toLowerCase())) onChange([...items, v])
    setVal('')
    setAdding(false)
  }
  const chipCls = tone === 'green'
    ? 'border-[color:rgba(62,224,160,0.35)] bg-[color:rgba(62,224,160,0.10)] text-[#8ff0c6]'
    : 'border-[var(--border-card)] bg-white/[0.04] text-[var(--text-primary)]'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((it) => (
        <span key={it} className={`inline-flex items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 text-[12.5px] font-medium ${chipCls}`}>
          {dotted && <span className="h-1.5 w-1.5 rounded-full" style={{ background: PLATFORM_DOT[it.toLowerCase()] ?? '#7EA6FF' }} />}
          {it}
          <button type="button" onClick={() => onChange(items.filter((x) => x !== it))} className="ml-0.5 text-[var(--text-muted)] hover:text-white" aria-label={`Remove ${it}`}>
            <X size={12} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(''); setAdding(false) } }}
          placeholder={placeholder}
          className="w-28 rounded-[10px] border border-[var(--accent-sapphire)] bg-transparent px-2.5 py-1.5 text-[12.5px] text-white outline-none"
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-[10px] px-2 py-1.5 text-[12.5px] font-medium text-[var(--text-muted)] transition-colors hover:text-white">
          <Plus size={13} /> Add
        </button>
      )}
    </div>
  )
}

function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint,#5c6785)]">{children}</span>
      {right && <span className="font-mono text-[10px] text-[var(--text-muted)]">{right}</span>}
    </div>
  )
}

function FieldLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2 text-[12px] text-[var(--text-secondary)]">
      {label} <span className="font-mono text-[var(--text-muted)]">{count}</span>
    </div>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  moderator: Moderator | null
  onUpdated?: (patch: Partial<Moderator>) => void
  onRemove?: (moderator: Moderator) => void
  onViewActivity?: (moderator: Moderator) => void
}

export function ModeratorProfileDrawer({ open, onClose, moderator, onUpdated, onRemove, onViewActivity }: Props) {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [platforms, setPlatforms] = useState<string[]>([])
  const [languages, setLanguages] = useState<string[]>([])
  const [specializations, setSpecializations] = useState<string[]>([])
  const [timezone, setTimezone] = useState('UTC')
  const [startH, setStartH] = useState(9)
  const [endH, setEndH] = useState(17)
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  // Preserved (not edited in this view, but kept so a save never wipes them).
  const preserved = useRef<Partial<Moderator>>({})

  const [cvFilename, setCvFilename] = useState<string | null>(null)
  const [cvStoragePath, setCvStoragePath] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !moderator) return
    setPlatforms(moderator.platformsKnown ?? [...(moderator.platforms ?? [])])
    setLanguages(moderator.languages ?? [])
    setSpecializations(moderator.skills ?? [])
    setTimezone(moderator.timezone || 'UTC')
    setStartH(typeof moderator.shiftStartUtc === 'number' ? moderator.shiftStartUtc : 9)
    setEndH(typeof moderator.shiftEndUtc === 'number' ? moderator.shiftEndUtc : 17)
    setDays(moderator.shiftDays && moderator.shiftDays.length > 0 ? moderator.shiftDays : [1, 2, 3, 4, 5])
    setCvFilename(moderator.cvFilename ?? null)
    setCvStoragePath(moderator.cvStoragePath ?? null)
    preserved.current = {
      bio: moderator.bio, externalSource: moderator.externalSource, profilePhotoUrl: moderator.profilePhotoUrl,
    }
  }, [open, moderator])

  const canEdit = Boolean(user && moderator)
  const durationH = useMemo(() => ((endH - startH + 24) % 24) || 24, [startH, endH])
  const weeklyH = durationH * days.length

  // Unsaved-change count vs the loaded moderator (CV changes persist immediately).
  const changes = useMemo(() => {
    if (!moderator) return 0
    let c = 0
    if (!arrEq(platforms, moderator.platformsKnown ?? [...(moderator.platforms ?? [])])) c++
    if (!arrEq(languages, moderator.languages ?? [])) c++
    if (!arrEq(specializations, moderator.skills ?? [])) c++
    const shiftChanged =
      startH !== (moderator.shiftStartUtc ?? 9) || endH !== (moderator.shiftEndUtc ?? 17) ||
      !arrEq(days.map(String), (moderator.shiftDays ?? [1, 2, 3, 4, 5]).map(String)) ||
      timezone !== (moderator.timezone || 'UTC')
    if (shiftChanged) c++
    return c
  }, [moderator, platforms, languages, specializations, startH, endH, days, timezone])

  async function handleCvFile(file: File) {
    if (!moderator || !user) { showToast('Sign in to upload a CV.', 'error'); return }
    if (file.type && file.type !== 'application/pdf') { showToast('Only PDF files are supported.', 'error'); return }
    setUploading(true)
    try {
      const [uploaded, extracted] = await Promise.all([
        uploadModeratorCv(activeWorkspaceId, moderator.id, file),
        extractPdfText(file),
      ])
      setCvFilename(uploaded.filename)
      setCvStoragePath(uploaded.path)
      await updateModeratorProfile(moderator.id, { cvStoragePath: uploaded.path, cvFilename: uploaded.filename, cvExtractedText: extracted })
      onUpdated?.({ cvStoragePath: uploaded.path, cvFilename: uploaded.filename, cvExtractedText: extracted })
      showToast('CV uploaded.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CV upload failed.', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveCv() {
    if (!moderator || !cvStoragePath) return
    try {
      await deleteModeratorCv(cvStoragePath)
      await updateModeratorProfile(moderator.id, { cvStoragePath: null, cvFilename: null, cvExtractedText: null })
      setCvStoragePath(null); setCvFilename(null)
      onUpdated?.({ cvStoragePath: undefined, cvFilename: undefined, cvExtractedText: undefined })
      showToast('CV removed.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CV removal failed.', 'error')
    }
  }

  async function handleOpenCv() {
    if (!cvStoragePath) return
    try {
      const url = await getCvSignedUrl(cvStoragePath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open CV.', 'error')
    }
  }

  async function handleSave() {
    if (!moderator) return
    if (!user) { showToast('Sign in to save changes.', 'error'); return }
    setSaving(true)
    try {
      const patch = {
        skills: specializations,
        languages,
        platformsKnown: platforms,
        shiftStartUtc: startH,
        shiftEndUtc: endH,
        shiftDays: days,
        ...preserved.current,
      }
      await updateModeratorProfile(moderator.id, patch)
      onUpdated?.({ ...patch, timezone })
      showToast('Profile saved.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const months = monthsInTeam(moderator?.startDate)
  const primaryPlatform = platforms[0] ?? moderator?.platforms?.[0] ?? '—'
  const roleLine = moderator
    ? ['Moderator', primaryPlatform, moderator.timezone, `${pad(startH)}–${pad(endH)}`, months != null ? `${months} month${months === 1 ? '' : 's'} on the team` : null]
        .filter(Boolean).join('  ·  ')
    : ''

  return (
    <AnimatePresence>
      {open && moderator && (
        <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/70" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.aside
            role="dialog"
            aria-label={`Profile of ${moderator.fullName}`}
            className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-white/[0.08] bg-[#060a18] shadow-2xl"
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <header className="flex items-start justify-between gap-4 border-b border-[var(--border-card)] px-6 py-5">
              <div className="flex items-center gap-3.5">
                <div className="relative">
                  {moderator.profilePhotoUrl ? (
                    <img src={moderator.profilePhotoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#3F7BFF] to-[#1B3FD6] text-sm font-bold text-white">
                      {moderator.avatarInitials || <User size={18} />}
                    </div>
                  )}
                  <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#060a18] bg-[#3ee0a0] shadow-[0_0_8px_#3ee0a0]" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[19px] font-bold text-white">{moderator.fullName}</h2>
                    <span className="rounded-full bg-[color:rgba(62,224,160,0.12)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-[#3ee0a0]">
                      {moderator.status}
                    </span>
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      {moderator.contractType}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11.5px] text-[var(--text-muted)]">{roleLine}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onViewActivity?.(moderator)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] bg-white/[0.05] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:border-[color:var(--sf-hover-border)]"
                >
                  <Activity size={13} /> View activity
                </button>
                <button onClick={onClose} aria-label="Close" className="focus-ring rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-white">
                  <X size={18} />
                </button>
              </div>
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="flex flex-col gap-8">
                {/* COMPETENZE */}
                <section>
                  <Eyebrow right="used to assign shifts and tickets">Skills</Eyebrow>
                  <FieldLabel label="Platforms" count={platforms.length} />
                  <div className="mb-5 rounded-2xl border border-[var(--border-card)] bg-white/[0.02] p-3.5">
                    <ChipEditor items={platforms} onChange={setPlatforms} dotted placeholder="Discord…" />
                  </div>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <FieldLabel label="Languages" count={languages.length} />
                      <div className="rounded-2xl border border-[var(--border-card)] bg-white/[0.02] p-3.5">
                        <ChipEditor items={languages} onChange={setLanguages} placeholder="English…" />
                      </div>
                    </div>
                    <div>
                      <FieldLabel label="Specializations" count={specializations.length} />
                      <div className="rounded-2xl border border-[var(--border-card)] bg-white/[0.02] p-3.5">
                        <ChipEditor items={specializations} onChange={setSpecializations} tone="green" placeholder="Anti-scam…" />
                      </div>
                    </div>
                  </div>
                </section>

                {/* DOCUMENTI */}
                <section>
                  <Eyebrow>Documents</Eyebrow>
                  <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" disabled={!canEdit || uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCvFile(f); e.target.value = '' }} />
                  {cvStoragePath ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-card)] bg-white/[0.02] p-3.5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:rgba(91,140,255,0.16)] font-mono text-[10px] font-bold text-[var(--accent-emerald-bright)]">PDF</div>
                      <button onClick={handleOpenCv} type="button" className="min-w-0 flex-1 text-left">
                        <div className="truncate text-[13.5px] font-semibold text-white hover:underline">{cvFilename ?? 'CV.pdf'}</div>
                        <div className="font-mono text-[11px] text-[var(--text-muted)]">PDF · moderator CV</div>
                      </button>
                      <div className="flex shrink-0 items-center gap-3 text-[12.5px]">
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="font-medium text-[var(--accent-emerald-bright)] hover:underline">Replace</button>
                        <button type="button" onClick={handleRemoveCv} className="font-medium text-[#ff8f7f] hover:underline">Remove</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!canEdit || uploading}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border-card)] px-4 py-6 text-[13px] text-[var(--text-muted)] transition-colors hover:border-[color:var(--sf-hover-border)] hover:text-white">
                      {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      {uploading ? 'Uploading…' : 'Upload a CV (PDF)'}
                    </button>
                  )}
                </section>

                {/* TURNI */}
                <section>
                  <Eyebrow>Shifts</Eyebrow>
                  <div className="rounded-2xl border border-[var(--border-card)] bg-white/[0.02] p-4">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] bg-white/[0.05] px-2.5 py-1.5">
                          <span className="font-mono text-[9px] uppercase tracking-wide text-[var(--text-muted)]">TZ</span>
                          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="bg-transparent text-[12.5px] font-semibold text-white outline-none">
                            {TIMEZONES.map((tz) => <option key={tz} value={tz} className="bg-[#0b1220]">{tz}</option>)}
                          </select>
                        </label>
                        <div className="font-mono text-[22px] font-bold tracking-tight text-white">
                          {pad(startH)} <span className="text-[var(--text-muted)]">→</span> {pad(endH)}
                          <span className="ml-1.5 font-mono text-[11px] font-medium text-[var(--text-muted)]">UTC</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-[color:rgba(91,140,255,0.3)] bg-[color:rgba(91,140,255,0.14)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#a9c4ff]">{durationH}h × {days.length}d</span>
                        <span className="rounded-full border border-[color:rgba(62,224,160,0.3)] bg-[color:rgba(62,224,160,0.12)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#3ee0a0]">{weeklyH}h / wk</span>
                      </div>
                    </div>

                    {/* Dual-thumb slider (0–24h) */}
                    <div className="relative mx-1 mb-1 h-[18px]">
                      <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-white/[0.08]" />
                      <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
                        style={{ left: `${(Math.min(startH, endH) / 24) * 100}%`, width: `${(Math.abs(endH - startH) / 24) * 100}%`, background: 'linear-gradient(90deg,#2f7cf6,#37d0f0)' }} />
                      <input className="sf-range" type="range" min={0} max={24} step={1} value={startH} onChange={(e) => setStartH(Math.min(Number(e.target.value), endH))} aria-label="Shift start" />
                      <input className="sf-range" type="range" min={0} max={24} step={1} value={endH} onChange={(e) => setEndH(Math.max(Number(e.target.value), startH))} aria-label="Shift end" />
                    </div>
                    <div className="mb-5 flex justify-between px-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                      <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
                    </div>

                    {/* Weekday toggles */}
                    <div className="grid grid-cols-7 gap-2">
                      {WEEKDAYS.map((d) => {
                        const on = days.includes(d.key)
                        return (
                          <button key={d.key} type="button"
                            onClick={() => setDays((cur) => cur.includes(d.key) ? cur.filter((x) => x !== d.key) : [...cur, d.key].sort())}
                            className={`rounded-lg border py-2 text-[12.5px] font-semibold transition-colors ${
                              on ? 'border-[color:rgba(91,140,255,0.4)] bg-[color:rgba(47,107,255,0.18)] text-white' : 'border-[var(--border-card)] text-[var(--text-muted)] hover:text-white'
                            }`}>
                            {d.short}
                          </button>
                        )
                      })}
                    </div>

                    <div className="mt-4 flex items-center gap-2 font-mono text-[11.5px] text-[var(--text-secondary)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#3ee0a0]" />
                      Shift {pad(startH)}–{pad(endH)} UTC · {days.length} day{days.length === 1 ? '' : 's'} / week · {weeklyH}h total.
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-3 border-t border-[var(--border-card)] px-6 py-4">
              <button type="button" onClick={() => onRemove?.(moderator)} className="text-[13px] font-medium text-[#ff8f7f] transition-colors hover:text-[#ffb3a6]">
                Remove from team
              </button>
              <div className="flex items-center gap-3">
                {changes > 0 && (
                  <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-[#ffd479]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#ffd479]" /> {changes} unsaved change{changes === 1 ? '' : 's'}
                  </span>
                )}
                <button type="button" onClick={onClose} className="rounded-lg border border-[var(--border-card)] bg-white/[0.05] px-4 py-2 text-[13px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-white/[0.08]">
                  Cancel
                </button>
                <button type="button" onClick={handleSave} disabled={!canEdit || saving || changes === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#3F7BFF] to-[#2050E6] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-6px_rgba(47,107,255,0.55)] transition hover:brightness-110 disabled:opacity-50">
                  {saving && <Loader2 size={14} className="animate-spin" />} Save profile
                </button>
              </div>
            </footer>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
