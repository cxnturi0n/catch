import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowRight, Check, CheckCircle2, Loader2 } from 'lucide-react'
import './discovery.css'
import { SapphireGem } from './SapphireGem'
import { CatchMark } from '../../components/brand/CatchMark'
import {
  DISCOVERY_VARIANTS,
  NOTE_SUFFIX,
  PLATFORMS_SUFFIX,
  QUESTIONS_PER_VARIANT,
  START_QUESTION,
  VARIANT_KEY,
  getVariant,
  type DiscoveryQuestion,
  type DiscoveryVariant,
} from '../../data/discoveryQuestions'
import {
  fetchDiscoveryForm,
  submitDiscoveryResponse,
  type DiscoveryFormRow,
  type FetchFormResult,
} from '../../lib/discovery'

const CAL_LINK = 'https://cal.com/luca-cinicolo-txehxm/20min'
const HARD_CAP = 10_000
const AUTOSAVE_MS = 600

// Minimum bar for a free-text answer to count as a real, thoughtful reply.
const MIN_CHARS = 15
const MIN_WORDS = 3

type Phase = 'loading' | 'not_found' | 'unconfigured' | 'ready' | 'submitted'
type Step = 'picker' | 'questions'
type SaveStatus = 'idle' | 'saving' | 'saved'

interface AboutYou {
  name: string
  email: string
  role: string
}
interface Draft {
  variant: DiscoveryVariant | null
  answers: Record<string, string>
  skipped: string[]
  about: AboutYou
  savedAt: number
}

const EMPTY_ABOUT: AboutYou = { name: '', email: '', role: '' }

// ── Answer-quality helpers ────────────────────────────────────────────────────
// Kept as a gentle, non-blocking nudge (per the form's product intent): a
// low-effort text answer never collapses to "answered", so it keeps prompting
// for more, but the respondent can always skip or submit partially.

const MSG_TEXT_DETAIL = "I'd really appreciate a bit more detail, a full sentence helps a lot. 🙏"

/** Heuristic: does this free-text answer look like a lazy skip (one word, keyboard mash, gibberish)? */
function looksLowEffort(raw: string): boolean {
  const text = raw.trim()
  if (text.length < MIN_CHARS) return true

  const words = text.split(/\s+/).filter((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length >= 2)
  if (words.length < MIN_WORDS) return true

  const distinct = new Set(words.map((w) => w.toLowerCase()))
  if (distinct.size < 3) return true

  // Vowel ratio over the whole answer catches keyboard-mash ("kdfhgkdwhk").
  // NB: compute on the concatenated letters only for the RATIO, never run a
  // consonant-run regex across it, or word boundaries fake a run ("metricS SPReadsheet").
  const letters = text.toLowerCase().replace(/[^a-z]/g, '')
  if (letters.length >= 6) {
    const vowels = (letters.match(/[aeiou]/g) ?? []).length
    if (vowels / letters.length < 0.2) return true
  }

  const voweless = words.filter((w) => {
    const a = w.toLowerCase().replace(/[^a-z]/g, '')
    return a.length >= 3 && !/[aeiou]/.test(a)
  })
  if (voweless.length >= 2) return true

  return false
}

/** True when `q` has a real, complete answer (chip + platform + required note, or thoughtful text). */
function isAnswered(q: DiscoveryQuestion, answers: Record<string, string>): boolean {
  const value = (answers[q.id] ?? '').trim()
  if (q.choices || q.platforms) {
    if (q.choices && !value) return false
    if (q.choices) {
      const wantsNote = Boolean(q.notePlaceholder && /^if yes/i.test(q.notePlaceholder))
      const affirmative = value.toLowerCase().includes('yes')
      if (wantsNote && affirmative && !(answers[q.id + NOTE_SUFFIX] ?? '').trim()) return false
    }
    if (q.platforms && !(answers[q.id + PLATFORMS_SUFFIX] ?? '').trim()) return false
    return true
  }
  return Boolean(value) && !looksLowEffort(value)
}

/** One-line preview of a question's answer for the collapsed "answered" state. */
function answerSummary(q: DiscoveryQuestion, answers: Record<string, string>): string {
  const parts: string[] = []
  const value = (answers[q.id] ?? '').trim()
  if (value) parts.push(value)
  const plats = (answers[q.id + PLATFORMS_SUFFIX] ?? '').trim()
  if (plats) parts.push(plats)
  const note = (answers[q.id + NOTE_SUFFIX] ?? '').trim()
  if (note) parts.push(note)
  return parts.join(' · ')
}

function draftKey(slug: string): string {
  return `discovery_draft_${slug}`
}

function isVariant(v: unknown): v is DiscoveryVariant {
  return typeof v === 'string' && DISCOVERY_VARIANTS.some((d) => d.id === v)
}

/** Read a persisted draft, tolerating malformed/old localStorage payloads. */
function readDraft(slug: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(slug))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Draft>
    if (!parsed || typeof parsed !== 'object') return null
    const answers = parsed.answers && typeof parsed.answers === 'object' ? (parsed.answers as Record<string, string>) : {}
    const about = { ...EMPTY_ABOUT, ...(parsed.about ?? {}) }
    const skipped = Array.isArray(parsed.skipped) ? parsed.skipped.filter((s): s is string => typeof s === 'string') : []
    const variant = isVariant(parsed.variant) ? parsed.variant : null
    const hasContent = variant !== null || Object.values(answers).some((v) => v?.trim())
    if (!hasContent) return null
    return { variant, answers, skipped, about, savedAt: parsed.savedAt ?? Date.now() }
  } catch {
    return null
  }
}

type DfTheme = 'night' | 'day'

/** The public form follows the visitor's OS preference (no in-form toggle). */
function readInitialDfTheme(): DfTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'night'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night'
}

export function DiscoveryForm() {
  const params = useParams<{ slug?: string }>()
  const slug = (params.slug ?? 'generic').toLowerCase()

  const [phase, setPhase] = useState<Phase>('loading')
  const [step, setStep] = useState<Step>('picker')
  const [dfTheme, setDfTheme] = useState<DfTheme>(readInitialDfTheme)
  const [form, setForm] = useState<DiscoveryFormRow | null>(null)
  const [variant, setVariant] = useState<DiscoveryVariant | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [about, setAbout] = useState<AboutYou>(EMPTY_ABOUT)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [savedAndClosed, setSavedAndClosed] = useState(false)

  const startedAtRef = useRef<number>(Date.now())
  const fieldRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const saveTimerRef = useRef<number | null>(null)
  const savedTimerRef = useRef<number | null>(null)

  // Follow the OS light/dark preference (day/night), live.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => setDfTheme(mq.matches ? 'day' : 'night')
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])

  // ── Load the form row for this slug ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1') {
      setForm({ id: 'preview', slug, contact_name: slug === 'generic' ? null : 'Heather Bartha', contact_email: null, source: null, is_active: true })
      setPhase('ready')
      return
    }
    fetchDiscoveryForm(slug).then((res: FetchFormResult) => {
      if (cancelled) return
      if (res.status === 'ok') {
        setForm(res.form)
        setPhase('ready')
      } else if (res.status === 'unconfigured') {
        setPhase('unconfigured')
      } else {
        setPhase('not_found')
      }
    })
    return () => {
      cancelled = true
    }
  }, [slug])

  // ── Restore any saved draft once the form is ready ────────────────────────
  useEffect(() => {
    if (phase !== 'ready') return
    const draft = readDraft(slug)
    if (draft) {
      // Restore the saved answers but ALWAYS land on Step 1 (intro + choice).
      // A saved profile is only pre-selected there; "Continue" resumes Step 2.
      setVariant(draft.variant)
      setAnswers(draft.answers)
      setSkipped(new Set(draft.skipped))
      setAbout(draft.about)
    }
    startedAtRef.current = Date.now()
  }, [phase, slug])

  // ── Debounced autosave (≈600ms after typing stops) ────────────────────────
  const persistDraft = useCallback(() => {
    try {
      const draft: Draft = { variant, answers, skipped: Array.from(skipped), about, savedAt: Date.now() }
      localStorage.setItem(draftKey(slug), JSON.stringify(draft))
    } catch {
      /* localStorage unavailable, non-fatal */
    }
  }, [variant, answers, skipped, about, slug])

  const hasContent = variant !== null || Object.values(answers).some((v) => v.trim())
  useEffect(() => {
    if (phase !== 'ready' || !hasContent) return
    setSaveStatus('saving')
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      persistDraft()
      setSaveStatus('saved')
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current)
      savedTimerRef.current = window.setTimeout(() => setSaveStatus('idle'), 2200)
    }, AUTOSAVE_MS)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [phase, hasContent, persistDraft])

  // ── Focus the active text field when it becomes active ────────────────────
  useEffect(() => {
    if (!activeId) return
    const el = fieldRefs.current[activeId]
    if (el) {
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }, [activeId])

  const activeVariant = variant ? getVariant(variant) : null
  const questions = activeVariant?.questions ?? []
  const answeredCount = questions.filter((q) => !skipped.has(q.id) && isAnswered(q, answers)).length
  const questionsLeft = QUESTIONS_PER_VARIANT - answeredCount

  const setAnswer = useCallback((id: string, value: string) => {
    const clamped = value.length > HARD_CAP ? value.slice(0, HARD_CAP) : value
    setAnswers((prev) => ({ ...prev, [id]: clamped }))
  }, [])

  function activate(id: string) {
    setSkipped((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setActiveId(id)
  }

  function skip(id: string) {
    setSkipped((prev) => new Set(prev).add(id))
    setActiveId((cur) => (cur === id ? null : cur))
  }

  function handleTextBlur(q: DiscoveryQuestion) {
    // Leaving a field demotes it. Valid → collapses to "answered"; empty or
    // low-effort → falls back to "pending" (which surfaces the nudge if the
    // leftover text looks like a lazy answer).
    setActiveId((cur) => (cur === q.id ? null : cur))
  }

  function chooseVariant(next: DiscoveryVariant) {
    setVariant(next)
  }

  function goToQuestions() {
    if (!variant) return
    setStep('questions')
    startedAtRef.current = Date.now()
    window.scrollTo({ top: 0 })
  }

  function saveAndClose() {
    persistDraft()
    setSaveStatus('saved')
    setSavedAndClosed(true)
  }

  async function handleSubmit() {
    if (submitting || !variant) return

    // Guard against a pure-junk submission (nothing answered, nothing about you).
    const aboutFilled = Boolean(about.name.trim() || about.email.trim() || about.role.trim())
    if (answeredCount === 0 && !aboutFilled) {
      setSubmitError('Please answer at least one question before submitting.')
      return
    }

    const unanswered = questions.filter((q) => !skipped.has(q.id) && !isAnswered(q, answers)).length
    if (unanswered > 0) {
      const ok = window.confirm(
        `Submit with ${unanswered} question${unanswered === 1 ? '' : 's'} still unanswered? You can also come back to this link later.`,
      )
      if (!ok) return
    }

    const validKeys = new Set<string>()
    for (const q of questions) {
      if (skipped.has(q.id)) continue
      validKeys.add(q.id)
      if (q.notePlaceholder) validKeys.add(q.id + NOTE_SUFFIX)
      if (q.platforms) validKeys.add(q.id + PLATFORMS_SUFFIX)
    }
    const cleanAnswers: Record<string, string> = { [VARIANT_KEY]: variant }
    for (const [k, v] of Object.entries(answers)) {
      if (!validKeys.has(k)) continue
      const t = v.trim()
      if (t) cleanAnswers[k] = t
    }

    setSubmitError(null)
    setSubmitting(true)

    const res = await submitDiscoveryResponse({
      formId: form?.id ?? null,
      slugSnapshot: slug,
      respondentName: about.name.trim() || null,
      respondentEmail: about.email.trim() || null,
      respondentRole: about.role.trim() || null,
      answers: cleanAnswers,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      // Clamp to a safe positive range so a long-open tab can't overflow the
      // INT4 completion_ms column (>~24.8 days) and reject the whole insert.
      completionMs: Math.min(Math.max(Date.now() - startedAtRef.current, 0), 2_000_000_000),
    })

    if (res.ok) {
      try {
        localStorage.removeItem(draftKey(slug))
      } catch {
        /* ignore */
      }
      setPhase('submitted')
    } else {
      setSubmitting(false)
      setSubmitError("Couldn't submit, please try again.")
    }
  }

  // The hero steps (picker, thank-you) use the crown gem at night and the
  // corner gem in day, per the design; the dense question list always uses the
  // corner gem.
  const heroGem: 'crown' | 'corner' = dfTheme === 'day' ? 'corner' : 'crown'

  // ── Screens ───────────────────────────────────────────────────────────────
  if (phase === 'loading') return <Scope theme={dfTheme}><CenterScreen>Loading…</CenterScreen></Scope>
  if (phase === 'not_found') return <Scope theme={dfTheme}><CenterScreen title="Form not available">This form doesn’t exist or is no longer accepting responses.</CenterScreen></Scope>
  if (phase === 'unconfigured') return <Scope theme={dfTheme}><CenterScreen title="Form not available">This deployment isn’t configured to accept responses.</CenterScreen></Scope>
  if (phase === 'submitted') return <Scope theme={dfTheme}><ThankYouScreen name={about.name.trim() || form?.contact_name || null} gem={heroGem} /></Scope>

  const greetingName = form?.contact_name ?? null

  if (step === 'picker') {
    return (
      <Scope theme={dfTheme}>
        <SapphireGem variant={heroGem} />
        <PickerStep
          greetingName={greetingName}
          variant={variant}
          onChoose={chooseVariant}
          onContinue={goToQuestions}
        />
      </Scope>
    )
  }

  return (
    <Scope theme={dfTheme}>
      <SapphireGem variant="corner" />
      <QuestionsStep
        variant={variant!}
        activeVariant={activeVariant!}
        answers={answers}
        skipped={skipped}
        activeId={activeId}
        saveStatus={saveStatus}
        answeredCount={answeredCount}
        questionsLeft={questionsLeft}
        submitting={submitting}
        submitError={submitError}
        savedAndClosed={savedAndClosed}
        about={about}
        fieldRefs={fieldRefs}
        onAnswer={setAnswer}
        onActivate={activate}
        onSkip={skip}
        onTextBlur={handleTextBlur}
        onAbout={setAbout}
        onSubmit={handleSubmit}
        onSaveClose={saveAndClose}
      />
    </Scope>
  )
}

// ── Scope wrapper (owns the token layer; theme follows the OS preference) ─────
function Scope({ theme = 'night', children }: { theme?: DfTheme; children: React.ReactNode }) {
  return (
    <div className="df-scope relative min-h-screen" data-df-theme={theme}>
      {children}
    </div>
  )
}

// ── Step 1, profile picker ───────────────────────────────────────────────────
function PickerStep({
  greetingName,
  variant,
  onChoose,
  onContinue,
}: {
  greetingName: string | null
  variant: DiscoveryVariant | null
  onChoose: (v: DiscoveryVariant) => void
  onContinue: () => void
}) {
  // Enter advances once a profile is picked.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter' && variant && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        onContinue()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, onContinue])

  return (
    <main className="relative z-[1] mx-auto flex max-w-[820px] flex-col gap-[18px] px-[38px] py-[34px]">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <CatchMark size={34} play={false} />
          <span className="text-shine text-[20px] font-extrabold tracking-tight">Catch</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] font-medium text-[var(--df-text-muted)]">1 / {QUESTIONS_PER_VARIANT}</span>
          <SegmentBar filled={1} total={QUESTIONS_PER_VARIANT} />
        </div>
      </div>

      {/* Intro */}
      <div className="flex flex-col gap-3.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--df-eyebrow)]">
          Web3 Community Interview
        </span>
        <h1 className="font-sans text-[44px] font-extrabold leading-[1.04] tracking-[-0.03em] text-[var(--df-text-primary)]">
          Discovery
          <br />
          Questions
        </h1>
        <p className="max-w-[560px] text-[15px] leading-[1.7] text-[var(--df-text-body)] [text-wrap:pretty]">
          {greetingName ? `Hi ${greetingName}, ` : ''}I&apos;m building Catch, a command center for Web3 communities, and I
          want to understand how you actually work. Your answers go straight into the product.
        </p>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] font-medium text-[var(--df-text-muted)]">
          <span>10 to 15 min</span>
          <Dot />
          <span>{QUESTIONS_PER_VARIANT} questions</span>
          <Dot />
          <span>answer only what&apos;s relevant</span>
        </div>
      </div>

      {/* Question card */}
      <div className="relative overflow-hidden rounded-[20px] border p-[26px]"
        style={{ background: 'var(--df-surface-card)', borderColor: 'var(--df-card-border)', backdropFilter: 'blur(var(--df-blur))' }}
      >
        <div className="df-filament" />
        <h2 className="text-[21px] font-bold text-[var(--df-text-high)]">{START_QUESTION}</h2>
        <p className="mt-1 text-[13.5px] text-[var(--df-text-muted)]">Pick one so I only show the questions that fit you.</p>

        <fieldset className="mt-5 flex flex-col gap-2.5 border-0 p-0">
          <legend className="sr-only">{START_QUESTION}</legend>
          {DISCOVERY_VARIANTS.map((v) => {
            const selected = v.id === variant
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChoose(v.id)}
                className="group flex items-center gap-[15px] rounded-[14px] border px-[18px] py-4 text-left transition-colors"
                style={{
                  background: selected ? 'var(--df-accent-soft)' : 'var(--df-surface-option)',
                  borderColor: selected ? 'var(--df-accent-ring)' : 'var(--df-option-border)',
                  boxShadow: selected ? '0 0 30px rgba(47,107,255,.16)' : 'none',
                }}
              >
                <span
                  className="relative grid h-5 w-5 shrink-0 place-items-center rounded-full border-2"
                  style={{ borderColor: selected ? '#7FA8FF' : 'var(--df-radio-rest)' }}
                >
                  {selected && (
                    <span className="h-[9px] w-[9px] rounded-full bg-[#7FA8FF]" style={{ boxShadow: '0 0 10px #7FA8FF' }} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-[var(--df-text-high)]">{v.label}</span>
                  <span className="mt-0.5 block text-[12.5px] text-[var(--df-text-muted)]">{v.hint}</span>
                </span>
                {selected && <ArrowRight size={16} className="shrink-0 text-[var(--df-arrow)]" />}
              </button>
            )
          })}
        </fieldset>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onContinue}
            disabled={!variant}
            className="rounded-[12px] px-[26px] py-[13px] text-[14px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'var(--df-accent-gradient)', boxShadow: 'var(--df-accent-shadow)' }}
          >
            Continue
          </button>
          <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--df-text-muted)]">
            or press
            <kbd className="rounded-[5px] border border-white/15 px-1.5 py-0.5 font-mono text-[11px] text-[var(--df-text-secondary)]">⏎</kbd>
          </span>
          <span className="ml-auto font-mono text-[12px] text-[var(--df-text-faint)]">answers save themselves</span>
        </div>
      </div>
    </main>
  )
}

// ── Step 2, question list ────────────────────────────────────────────────────
function QuestionsStep(props: {
  variant: DiscoveryVariant
  activeVariant: ReturnType<typeof getVariant>
  answers: Record<string, string>
  skipped: Set<string>
  activeId: string | null
  saveStatus: SaveStatus
  answeredCount: number
  questionsLeft: number
  submitting: boolean
  submitError: string | null
  savedAndClosed: boolean
  about: AboutYou
  fieldRefs: React.MutableRefObject<Record<string, HTMLTextAreaElement | null>>
  onAnswer: (id: string, value: string) => void
  onActivate: (id: string) => void
  onSkip: (id: string) => void
  onTextBlur: (q: DiscoveryQuestion) => void
  onAbout: (updater: (a: AboutYou) => AboutYou) => void
  onSubmit: () => void
  onSaveClose: () => void
}) {
  const {
    activeVariant, answers, skipped, activeId, saveStatus, answeredCount, questionsLeft,
    submitting, submitError, savedAndClosed, about, fieldRefs,
    onAnswer, onActivate, onSkip, onTextBlur, onAbout, onSubmit, onSaveClose,
  } = props

  // Cmd/Ctrl+Enter submits.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onSubmit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSubmit])

  return (
    <div className="relative z-[1] flex min-h-screen flex-col">
      {/* Sticky header */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b px-[30px] py-4"
        style={{ background: 'var(--df-bar-header)', borderColor: 'rgba(255,255,255,.07)', backdropFilter: 'blur(22px)' }}
      >
        <div className="flex items-center gap-2.5">
          <CatchMark size={26} play={false} />
          <span className="leading-tight">
            <span className="block text-[13.5px] font-bold text-[var(--df-text-high)]">Discovery Questions</span>
            <span className="block font-mono text-[10.5px] text-[var(--df-text-muted)]">{activeVariant.label.toLowerCase()}</span>
          </span>
        </div>
        <div className="flex items-center gap-3.5" aria-live="polite">
          <span className="hidden font-mono text-[11px] font-medium text-[var(--df-text-secondary)] sm:inline">
            {answeredCount} of {QUESTIONS_PER_VARIANT} answers
          </span>
          <div className="hidden h-[5px] w-[130px] overflow-hidden rounded-full sm:block" style={{ background: 'var(--df-track)' }}>
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${(answeredCount / QUESTIONS_PER_VARIANT) * 100}%`, background: 'linear-gradient(90deg,#5B8CFF,#37D0F0)', boxShadow: '0 0 12px rgba(91,140,255,.7)' }}
            />
          </div>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--df-text-muted)]">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--df-pos)', boxShadow: saveStatus === 'saved' ? '0 0 10px var(--df-pos)' : 'none', opacity: saveStatus === 'idle' ? 0.4 : 1 }}
            />
            {saveStatus === 'saving' ? 'saving…' : 'saved'}
          </span>
        </div>
      </header>

      {/* Scrolling question list */}
      <main className="mx-auto w-full max-w-[820px] flex-1 px-[30px] pb-[26px] pt-[22px]">
        <div className="flex flex-col gap-3.5">
          {activeVariant.questions.map((q, i) => (
            <QuestionRow
              key={q.id}
              question={q}
              index={i + 1}
              state={skipped.has(q.id) ? 'skipped' : activeId === q.id ? 'active' : isAnswered(q, answers) ? 'answered' : 'pending'}
              answers={answers}
              fieldRefs={fieldRefs}
              onAnswer={onAnswer}
              onActivate={onActivate}
              onSkip={onSkip}
              onTextBlur={onTextBlur}
            />
          ))}

          {/* About you, optional, kept from the original intake */}
          <div
            className="relative overflow-hidden rounded-[16px] border p-5"
            style={{ background: 'var(--df-surface-option)', borderColor: 'var(--df-option-border)' }}
          >
            <h3 className="text-[14px] font-semibold text-[var(--df-text-label)]">About you</h3>
            <p className="mt-0.5 text-[12.5px] text-[var(--df-text-muted)]">Optional, so I can follow up if you&apos;re open to it.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <AboutField label="Name" value={about.name} autoComplete="name" onChange={(v) => onAbout((a) => ({ ...a, name: v }))} />
              <AboutField label="Email" value={about.email} type="email" autoComplete="email" onChange={(v) => onAbout((a) => ({ ...a, email: v }))} />
              <AboutField label="Role / Company" value={about.role} autoComplete="organization" onChange={(v) => onAbout((a) => ({ ...a, role: v }))} />
            </div>
          </div>
        </div>
      </main>

      {/* Sticky footer */}
      <footer
        className="sticky bottom-0 z-20 flex items-center justify-between gap-4 border-t px-[30px] py-4"
        style={{ background: 'var(--df-bar-footer)', borderColor: 'rgba(255,255,255,.08)', backdropFilter: 'blur(24px)' }}
      >
        <div className="leading-tight">
          <div className="text-[13px] font-semibold text-[var(--df-text-label)]">
            {questionsLeft === 0 ? 'All questions answered' : `${questionsLeft} question${questionsLeft === 1 ? '' : 's'} left`}
          </div>
          <div className="font-mono text-[11px] text-[var(--df-text-muted)]">
            {savedAndClosed ? 'saved on this device · reopen the link to resume' : 'partial submit is fine · saved on this device'}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {submitError && <span className="text-[12px] text-[#FF8F7F]">{submitError}</span>}
          <button
            type="button"
            onClick={onSaveClose}
            className="rounded-[12px] border px-4 py-2.5 text-[13px] font-semibold text-[var(--df-text-secondary)] transition-colors hover:text-white"
            style={{ background: 'rgba(255,255,255,.055)', borderColor: 'rgba(255,255,255,.11)' }}
          >
            Save and close
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="flex items-center gap-2 rounded-[12px] px-[26px] py-3 text-[13.5px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: 'var(--df-accent-gradient)', boxShadow: 'var(--df-accent-shadow)' }}
          >
            {submitting ? (<><Loader2 size={15} className="animate-spin" /> Submitting…</>) : 'Submit answers'}
          </button>
        </div>
      </footer>
    </div>
  )
}

type RowState = 'answered' | 'active' | 'pending' | 'skipped'

function QuestionRow({
  question,
  index,
  state,
  answers,
  fieldRefs,
  onAnswer,
  onActivate,
  onSkip,
  onTextBlur,
}: {
  question: DiscoveryQuestion
  index: number
  state: RowState
  answers: Record<string, string>
  fieldRefs: React.MutableRefObject<Record<string, HTMLTextAreaElement | null>>
  onAnswer: (id: string, value: string) => void
  onActivate: (id: string) => void
  onSkip: (id: string) => void
  onTextBlur: (q: DiscoveryQuestion) => void
}) {
  const { id, text, choices, platforms } = question
  const isStructured = Boolean(choices || platforms)
  // Derived (not event-driven): a text answer left with lazy/gibberish content
  // gets a gentle nudge. Shows while active or after leaving it, never blocks.
  const textValue = (answers[id] ?? '').trim()
  const nudge = !isStructured && state !== 'answered' && state !== 'skipped' && Boolean(textValue) && looksLowEffort(textValue)

  // ── Answered (collapsed summary) ──
  if (state === 'answered') {
    return (
      <div className="rounded-[16px] border px-5 py-[18px]" style={{ background: 'rgba(255,255,255,.04)', borderColor: 'rgba(255,255,255,.08)' }}>
        <div className="flex items-start gap-3">
          <IndexChip index={index} tone="pos" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[14.5px] font-semibold text-[var(--df-text-secondary)]">{text}</p>
              <button type="button" onClick={() => onActivate(id)} className="shrink-0 font-mono text-[10.5px] text-[var(--df-text-faint)] transition-colors hover:text-white">
                edit
              </button>
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--df-text-dim)]">{answerSummary(question, answers)}</p>
          </div>
        </div>
      </div>
    )
  }

  // ── Skipped (single dim row) ──
  if (state === 'skipped') {
    return (
      <div className="flex items-center gap-3 rounded-[16px] border px-5 py-4" style={{ background: 'rgba(255,255,255,.025)', borderColor: 'rgba(255,255,255,.06)' }}>
        <IndexChip index={index} tone="dim" />
        <button type="button" onClick={() => onActivate(id)} className="min-w-0 flex-1 text-left text-[14px] text-[var(--df-text-faint)] transition-colors hover:text-[var(--df-text-secondary)]">
          {text}
        </button>
        <span className="shrink-0 rounded-full border px-[9px] py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--df-text-faint)]" style={{ borderColor: 'rgba(255,255,255,.12)' }}>
          Skipped
        </span>
      </div>
    )
  }

  const active = state === 'active'

  // ── Active / Pending (expanded) ──
  return (
    <div
      className="relative overflow-hidden rounded-[18px] border p-5"
      style={{
        background: active ? 'var(--df-surface-card)' : 'var(--df-surface-option)',
        borderColor: active ? 'var(--df-accent-ring)' : 'var(--df-option-border)',
        boxShadow: active ? '0 0 40px rgba(47,107,255,.18)' : 'none',
        backdropFilter: active ? 'blur(var(--df-blur))' : 'none',
      }}
      onClick={() => { if (!active) onActivate(id) }}
    >
      {active && <div className="df-filament" />}
      <div className="flex items-start gap-3">
        <IndexChip index={index} tone={active ? 'active' : 'neutral'} />
        <div className="min-w-0 flex-1">
          <p className={`${active ? 'text-[16px] text-white' : 'text-[15px] text-[var(--df-text-label)]'} font-semibold`}>{text}</p>

          {isStructured ? (
            <StructuredControls question={question} answers={answers} muted={!active} onAnswer={onAnswer} onActivate={() => onActivate(id)} />
          ) : (
            <textarea
              ref={(el) => { fieldRefs.current[id] = el }}
              value={answers[id] ?? ''}
              maxLength={HARD_CAP}
              placeholder={active ? '' : 'Write here…'}
              onFocus={() => onActivate(id)}
              onBlur={() => onTextBlur(question)}
              onChange={(e) => onAnswer(id, e.target.value)}
              className="mt-3 w-full resize-none rounded-[13px] px-4 py-3.5 text-[14px] leading-relaxed text-[var(--df-text-body)] outline-none transition-colors placeholder:text-[var(--df-text-faint)]"
              style={
                active
                  ? { background: 'var(--df-surface-field)', border: '1px solid rgba(120,160,255,.34)', minHeight: 96, caretColor: 'var(--df-caret)' }
                  : { background: 'rgba(255,255,255,.03)', border: '1px dashed rgba(255,255,255,.13)', minHeight: 64 }
              }
            />
          )}

          {active && (
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] text-[var(--df-text-faint)]">
                {nudge ? '' : 'answer how you’d say it, no need to be formal'}
              </span>
              <button type="button" onClick={() => onSkip(id)} className="font-mono text-[11px] text-[var(--df-text-faint)] transition-colors hover:text-[var(--df-text-secondary)]">
                skip this
              </button>
            </div>
          )}

          {nudge && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium" style={{ background: 'rgba(255,212,121,.12)', borderColor: 'rgba(255,212,121,.34)', color: '#FFE0A3' }}>
              {MSG_TEXT_DETAIL}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// Chips + platform matrix + optional note, for a structured question.
function StructuredControls({
  question,
  answers,
  muted,
  onAnswer,
  onActivate,
}: {
  question: DiscoveryQuestion
  answers: Record<string, string>
  muted: boolean
  onAnswer: (id: string, value: string) => void
  onActivate: () => void
}) {
  const { id, choices, multi, platforms, notePlaceholder } = question
  const value = answers[id] ?? ''
  const noteValue = answers[id + NOTE_SUFFIX] ?? ''
  const platformsValue = answers[id + PLATFORMS_SUFFIX] ?? ''
  const wantsNote = Boolean(notePlaceholder && /^if yes/i.test(notePlaceholder))
  const affirmative = value.toLowerCase().includes('yes')
  const noteMissing = wantsNote && affirmative && !noteValue.trim()

  return (
    <div className="mt-3 flex flex-col gap-2.5" style={{ opacity: muted ? 0.85 : 1 }}>
      {choices && <ChipRow fieldKey={id} choices={choices} multi={Boolean(multi)} value={value} onChange={onAnswer} onActivate={onActivate} />}
      {platforms && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--df-text-faint)]">Platforms, select all that apply</span>
          <ChipRow fieldKey={id + PLATFORMS_SUFFIX} choices={platforms} multi value={platformsValue} onChange={onAnswer} onActivate={onActivate} />
        </div>
      )}
      {notePlaceholder && (
        <input
          value={noteValue}
          maxLength={HARD_CAP}
          placeholder={notePlaceholder}
          onFocus={onActivate}
          onChange={(e) => onAnswer(id + NOTE_SUFFIX, e.target.value)}
          className="w-full rounded-[11px] px-3.5 py-2.5 text-[13.5px] text-[var(--df-text-body)] outline-none transition-colors placeholder:text-[var(--df-text-faint)]"
          style={{ background: 'var(--df-surface-field)', border: `1px solid ${noteMissing ? 'rgba(255,212,121,.4)' : 'rgba(120,160,255,.24)'}` }}
        />
      )}
    </div>
  )
}

function ChipRow({
  fieldKey,
  choices,
  multi,
  value,
  onChange,
  onActivate,
}: {
  fieldKey: string
  choices: string[]
  multi: boolean
  value: string
  onChange: (id: string, value: string) => void
  onActivate: () => void
}) {
  const selected = new Set(value.split(',').map((s) => s.trim()).filter(Boolean))
  const toggle = (choice: string) => {
    onActivate()
    if (multi) {
      const next = new Set(selected)
      if (next.has(choice)) next.delete(choice)
      else next.add(choice)
      onChange(fieldKey, Array.from(next).join(', '))
    } else {
      onChange(fieldKey, selected.has(choice) ? '' : choice)
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((choice) => {
        const on = selected.has(choice)
        return (
          <button
            key={choice}
            type="button"
            aria-pressed={on}
            onClick={(e) => { e.stopPropagation(); toggle(choice) }}
            className="rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium transition-colors"
            style={{
              background: on ? 'var(--df-accent-soft)' : 'rgba(255,255,255,.04)',
              borderColor: on ? 'var(--df-accent-ring)' : 'var(--df-option-border)',
              color: on ? '#fff' : 'var(--df-text-secondary)',
            }}
          >
            {choice}
          </button>
        )
      })}
    </div>
  )
}

function IndexChip({ index, tone }: { index: number; tone: 'pos' | 'active' | 'neutral' | 'dim' }) {
  const styles: Record<typeof tone, { bg: string; border: string; color: string }> = {
    pos: { bg: 'var(--df-pos-bg)', border: 'var(--df-pos-border)', color: 'var(--df-pos)' },
    active: { bg: 'rgba(91,140,255,.2)', border: 'rgba(120,160,255,.5)', color: '#A9C4FF' },
    neutral: { bg: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.14)', color: 'var(--df-text-dim)' },
    dim: { bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.1)', color: 'var(--df-text-faint)' },
  }
  const s = styles[tone]
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[8px] border font-mono text-[11px] font-semibold" style={{ background: s.bg, borderColor: s.border, color: s.color }}>
      {tone === 'pos' ? <Check size={13} /> : index}
    </span>
  )
}

function AboutField({
  label,
  value,
  type = 'text',
  autoComplete,
  onChange,
}: {
  label: string
  value: string
  type?: string
  autoComplete?: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-[var(--df-text-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[10px] px-3 py-2.5 text-[13.5px] text-[var(--df-text-body)] outline-none transition-colors placeholder:text-[var(--df-text-faint)]"
        style={{ background: 'var(--df-surface-field)', border: '1px solid var(--df-option-border)' }}
      />
    </label>
  )
}

function SegmentBar({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="h-[3px] w-[26px] rounded-[2px]"
          style={i < filled ? { background: 'var(--df-seg-fill)', boxShadow: 'var(--df-seg-glow)' } : { background: 'var(--df-track)' }}
        />
      ))}
    </div>
  )
}

function Dot() {
  return <span className="h-[3px] w-[3px] rounded-full bg-[var(--df-text-faint)]" />
}

// ── Full-screen states ────────────────────────────────────────────────────────
function CenterScreen({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-6 text-center">
      <div className="max-w-md">
        {title && <h1 className="text-2xl font-bold text-[var(--df-text-primary)]">{title}</h1>}
        <p className="mt-3 text-sm text-[var(--df-text-muted)]">{children}</p>
      </div>
    </div>
  )
}

function ThankYouScreen({ name, gem }: { name: string | null; gem: 'crown' | 'corner' }) {
  return (
    <>
      <SapphireGem variant={gem} />
      <div className="relative z-[1] flex min-h-screen items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <div className="mb-6 flex justify-center">
            <CheckCircle2 size={64} className="text-[var(--df-pos)]" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--df-text-primary)]">{name ? `Thank you, ${name}!` : 'Thank you!'}</h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--df-text-body)]">
            Your answers came through, this genuinely helps shape Catch. I appreciate the time.
          </p>
          <div className="mt-8 rounded-2xl border p-5" style={{ background: 'var(--df-surface-option)', borderColor: 'var(--df-option-border)' }}>
            <p className="text-sm text-[var(--df-text-body)]">Want to see Catch in action?</p>
            <a
              href={CAL_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
              style={{ background: 'var(--df-accent-gradient)', boxShadow: 'var(--df-accent-shadow)' }}
            >
              Book a 20-min demo
            </a>
          </div>
        </div>
      </div>
    </>
  )
}
