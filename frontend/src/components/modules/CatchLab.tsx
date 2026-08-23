import { useEffect, useRef, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, CircleDashed, Clock, Loader2, MessagesSquare, Plus, Rocket, ShieldCheck, Star } from 'lucide-react'
import type { FeedbackCategory, FeedbackEntry, FeedbackRole, FeedbackStatus } from '../../types'
import { fetchAllFeedback, fetchRoadmapFeedback, submitFeedback, updateFeedbackStatus } from '../../lib/db'
import { useAuth } from '../../context/AuthContext'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Modal } from '../ui/Modal'
import { FormField, Select, inputClass } from '../ui/FormControls'
import { formatRelativeTime } from '../../lib/format'

const OWNER_EMAIL = 'cinicololuca@gmail.com'

const CATEGORIES: { key: FeedbackCategory; emoji: string }[] = [
  { key: 'Bug Report', emoji: '🐛' },
  { key: 'Feature Request', emoji: '💡' },
  { key: 'Analytics & Metrics', emoji: '📊' },
  { key: 'Integrations', emoji: '🔗' },
  { key: 'General Feedback', emoji: '💬' },
]

const CATEGORY_TONE: Record<FeedbackCategory, BadgeTone> = {
  'Bug Report': 'red',
  'Feature Request': 'blue',
  'Analytics & Metrics': 'cyan',
  Integrations: 'indigo',
  'General Feedback': 'blue',
}

const ROLES: FeedbackRole[] = ['Freelance CM', 'Agency CM', 'In-house CM', 'Protocol Team', 'Other']

// Public roadmap columns, in flow order.
const ROADMAP: { status: FeedbackStatus; label: string; icon: typeof Rocket; tone: BadgeTone }[] = [
  { status: 'planned', label: 'Planned', icon: CircleDashed, tone: 'gray' },
  { status: 'in_progress', label: 'In progress', icon: Clock, tone: 'blue' },
  { status: 'shipped', label: 'Shipped', icon: Rocket, tone: 'cyan' },
]

const ALL_STATUSES: FeedbackStatus[] = ['pending', 'planned', 'in_progress', 'shipped', 'declined']

const DESCRIPTION_MIN = 50
const TITLE_MAX = 100

export function CatchLab() {
  const { user } = useAuth()
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL

  const [formOpen, setFormOpen] = useState(false)
  const [roadmap, setRoadmap] = useState<FeedbackEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [inbox, setInbox] = useState<FeedbackEntry[]>([])

  async function loadRoadmap() {
    try {
      setRoadmap(await fetchRoadmapFeedback())
    } catch {
      setRoadmap([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRoadmap()
    if (isOwner) fetchAllFeedback().then(setInbox).catch(() => setInbox([]))
  }, [isOwner])

  async function handleOwnerStatus(id: string, status: FeedbackStatus) {
    setInbox((prev) => prev.map((f) => (f.id === id ? { ...f, status } : f)))
    try {
      await updateFeedbackStatus(id, status)
      void loadRoadmap()
    } catch {
      /* revert-on-error omitted for brevity; refetch keeps truth */
      fetchAllFeedback().then(setInbox).catch(() => {})
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">CatchLab</h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
            The public roadmap of Catch. See what&apos;s planned, in progress and shipped, and shape what we build next.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="shrink-0">
          <Plus size={16} /> Contribute to the platform
        </Button>
      </div>

      {/* Public roadmap */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border-card)] py-16 text-sm text-[var(--text-secondary)]">
          <Loader2 size={18} className="animate-spin" /> Loading roadmap…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {ROADMAP.map((col) => {
            const items = roadmap.filter((f) => f.status === col.status)
            const Icon = col.icon
            return (
              <div key={col.status} className="flex flex-col gap-3">
                <div className="flex items-center gap-2 px-1">
                  <Icon size={16} className="text-[var(--accent-emerald)]" />
                  <h2 className="text-sm font-semibold text-white">{col.label}</h2>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <Card className="p-6 text-center text-xs text-[var(--text-secondary)]">Nothing here yet</Card>
                ) : (
                  items.map((f) => (
                    <Card key={f.id} className="p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge tone={CATEGORY_TONE[f.category]}>{f.category}</Badge>
                        {f.status === 'shipped' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent-emerald-bright)]">
                            <CheckCircle2 size={12} /> Shipped
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-semibold text-white">{f.title}</h3>
                      <p className="mt-1 text-xs text-slate-400">
                        {f.description.length > 130 ? `${f.description.slice(0, 130)}…` : f.description}
                      </p>
                      <div className="mt-2 text-[11px] text-slate-500">{formatRelativeTime(f.createdAt)}</div>
                    </Card>
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Owner-only private request log */}
      {isOwner && (
        <div className="mt-2">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={16} className="text-[var(--accent-emerald)]" />
            <h2 className="text-sm font-semibold text-white">Request log</h2>
            <Badge tone="gray">owner only</Badge>
            <span className="text-xs text-[var(--text-secondary)]">{inbox.length} total</span>
          </div>
          <Card className="overflow-hidden">
            <div className="divide-y divide-[var(--border-card)]">
              {inbox.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-secondary)]">
                  No submissions yet.
                </div>
              ) : (
                inbox.map((f) => (
                  <div key={f.id} className="flex flex-wrap items-center gap-3 p-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge tone={CATEGORY_TONE[f.category]}>{f.category}</Badge>
                        <span className="truncate text-sm font-medium text-white">{f.title}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {f.role ? `${f.role} · ` : ''}
                        {formatRelativeTime(f.createdAt)}
                        {f.rating !== null ? ` · ${f.rating}★` : ''}
                      </div>
                    </div>
                    <select
                      value={f.status}
                      onChange={(e) => handleOwnerStatus(f.id, e.target.value as FeedbackStatus)}
                      className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-white outline-none"
                    >
                      {ALL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      <ContributeModal open={formOpen} onClose={() => setFormOpen(false)} userId={user?.id ?? null} />
    </div>
  )
}

const emptyForm = {
  category: null as FeedbackCategory | null,
  title: '',
  description: '',
  rating: null as number | null,
  role: '' as FeedbackRole | '',
}

function ContributeModal({ open, onClose, userId }: { open: boolean; onClose: () => void; userId: string | null }) {
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<{ category?: string; title?: string; description?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const resetRef = useRef<number | null>(null)

  useEffect(() => () => { if (resetRef.current !== null) clearTimeout(resetRef.current) }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!userId) {
      setErrors({ description: 'Sign in to contribute to the platform.' })
      return
    }
    const next: typeof errors = {}
    if (!form.category) next.category = 'Choose a category.'
    if (!form.title.trim()) next.title = 'Title is required.'
    if (form.description.trim().length < DESCRIPTION_MIN)
      next.description = `Please write at least ${DESCRIPTION_MIN} characters (${form.description.trim().length}/${DESCRIPTION_MIN}).`
    if (Object.keys(next).length > 0) { setErrors(next); return }
    setErrors({})
    setSubmitting(true)
    try {
      await submitFeedback(userId, {
        category: form.category!,
        title: form.title.trim(),
        description: form.description.trim(),
        rating: form.rating,
        role: form.role || null,
      })
      setSubmitted(true)
      resetRef.current = window.setTimeout(() => {
        setForm(emptyForm)
        setSubmitted(false)
        onClose()
      }, 1800)
    } catch {
      setErrors({ description: 'Failed to submit. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Contribute to the platform">
      {submitted ? (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 size={44} className="text-[var(--accent-emerald)]" />
          <h3 className="text-sm font-semibold text-white">Thanks! Your request is in the queue.</h3>
          <p className="text-xs text-[var(--text-secondary)]">You&apos;ll see it on the roadmap once we review it.</p>
        </motion.div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <FormField label="Category">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CATEGORIES.map(({ key, emoji }) => {
                const selected = form.category === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: key }))}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                      selected ? 'border-blue-500/50 bg-blue-500/10 text-white' : 'border-[var(--border-card)] bg-[var(--bg-primary)] text-slate-300 hover:border-[var(--accent-emerald)]/40'
                    }`}
                  >
                    <span>{emoji}</span>
                    {key}
                  </button>
                )
              })}
            </div>
            {errors.category && <span className="text-xs text-red-400">{errors.category}</span>}
          </FormField>

          <FormField label="Title">
            <input
              className={`${inputClass} ${errors.title ? 'border-red-500' : ''}`}
              value={form.title}
              maxLength={TITLE_MAX}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Summarize your idea in one line"
            />
            {errors.title && <span className="text-xs text-red-400">{errors.title}</span>}
          </FormField>

          <FormField label="Description">
            <textarea
              className={`${inputClass} min-h-28 resize-none ${errors.description ? 'border-red-500' : ''}`}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Describe it in detail. The more specific, the more useful."
            />
            <div className="flex items-center justify-between">
              {errors.description ? <span className="text-xs text-red-400">{errors.description}</span> : <span className="text-[11px] text-slate-500">Minimum {DESCRIPTION_MIN} characters</span>}
              <span className="text-[11px] text-slate-500">{form.description.trim().length}</span>
            </div>
          </FormField>

          <FormField label="How useful is Catch for your workflow? (optional)">
            <StarRatingInput value={form.rating} onChange={(rating) => setForm((f) => ({ ...f, rating }))} />
          </FormField>

          <FormField label="Your role (optional)">
            <Select value={form.role} onChange={(v) => setForm((f) => ({ ...f, role: v as FeedbackRole }))} options={ROLES} placeholder="Select your role" />
          </FormField>

          <Button type="submit" loading={submitting} className="mt-1 w-full">
            <MessagesSquare size={16} /> Submit request
          </Button>
        </form>
      )}
    </Modal>
  )
}

function StarRatingInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const display = hovered ?? value ?? 0
  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHovered(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onMouseEnter={() => setHovered(n)} onClick={() => onChange(value === n ? null : n)} className="p-0.5" aria-label={`Rate ${n} out of 5`}>
          <Star size={22} className={n <= display ? 'fill-amber-400 text-amber-400' : 'text-slate-700'} />
        </button>
      ))}
      {value !== null && <span className="ml-2 text-xs text-[var(--text-secondary)]">{value} / 5</span>}
    </div>
  )
}
