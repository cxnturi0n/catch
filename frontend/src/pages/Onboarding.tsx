import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Loader2, Users, User, Building2, Gamepad2, Landmark, Image, MoreHorizontal } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useToast } from '../context/ToastContext'
import { CatchMark } from '../components/brand/CatchMark'
import { BrandBackdrop } from '../components/brand/BrandBackdrop'
import { updateProfile } from '../lib/api/workspaces'
import { COMMUNITY_SIZES } from '../lib/constants'

const ROLES = [
  { id: 'Community Manager', icon: Users },
  { id: 'Founder / Core Team', icon: Landmark },
  { id: 'Moderator', icon: User },
  { id: 'Growth / Marketing', icon: Building2 },
  { id: 'Agency / Multiple Clients', icon: Building2 },
  { id: 'Other', icon: MoreHorizontal },
]

const PLATFORMS = [
  { id: 'Discord', icon: Users },
  { id: 'Telegram', icon: Users },
  { id: 'Twitter/X', icon: Users },
  { id: 'Reddit', icon: Users },
  { id: 'Zealy', icon: Gamepad2 },
  { id: 'Galxe', icon: Image },
]

const PROJECT_HINT_BY_ROLE: Record<string, string> = {
  'Founder / Core Team': 'DeFi Protocol',
  'Agency / Multiple Clients': 'Other',
}

const TOTAL = 3

export function Onboarding() {
  const { user } = useAuth()
  const { addWorkspace } = useWorkspace()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [dir, setDir] = useState(1)

  // Step 1, about you
  const [role, setRole] = useState('')
  const [managesMultiple, setManagesMultiple] = useState<boolean | null>(null)
  // Step 2, your community
  const [workspaceName, setWorkspaceName] = useState('')
  const [communitySize, setCommunitySize] = useState<string>(COMMUNITY_SIZES[1])
  // Step 3, your stack
  const [platforms, setPlatforms] = useState<string[]>([])

  const [error, setError] = useState('')
  const [finishing, setFinishing] = useState(false)

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
  }

  const canAdvance =
    step === 1 ? role !== '' && managesMultiple !== null : step === 2 ? workspaceName.trim() !== '' : platforms.length > 0

  function go(next: number) {
    setError('')
    setDir(next > step ? 1 : -1)
    setStep(next)
  }

  function handleNext() {
    if (!canAdvance) {
      setError(
        step === 1 ? 'Pick your role and how many communities you run.' : step === 2 ? 'Give your workspace a name.' : 'Select at least one platform.',
      )
      return
    }
    if (step < TOTAL) go(step + 1)
    else void handleFinish()
  }

  async function handleFinish() {
    setFinishing(true)
    setError('')
    try {
      await addWorkspace({
        name: workspaceName.trim(),
        projectType: PROJECT_HINT_BY_ROLE[role] ?? 'Other',
        communitySize,
        platforms,
      })
      // "Who is using Catch" signal, best-effort, never blocks entering the app.
      if (user) {
        try {
          await updateProfile({ jobRole: role, managesMultiple: !!managesMultiple, communitySize, primaryPlatforms: platforms, onboarded: true })
        } catch {
          // profile is informational only
        }
      }
      showToast('Workspace ready, welcome to Catch')
      // Land in the Catch assistant: the first thing a new workspace needs is
      // the user describing the project so we can shape the layout around it.
      navigate('/dashboard/catch')
    } catch {
      setFinishing(false)
      setError('Something went wrong creating your workspace. Please try again.')
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070b12] px-4 py-10">
      <BrandBackdrop />

      <div className="animate-rise-in glow-emerald relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0b1018] p-8">
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-emerald-bright)]/60 to-transparent" />
        {/* Brand header, the C engages as you enter */}
        <div className="mb-6 flex items-center gap-4">
          <CatchMark size={56} />
          <div>
            <h1 className="text-lg font-bold text-white">
              Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p className="text-sm text-slate-400">Three quick steps and your command center is live.</p>
          </div>
        </div>

        {/* Progress, always shows "Step X of 3" */}
        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between text-xs font-medium">
            <span className="text-[color:var(--accent-emerald-bright)]">Step {step} of {TOTAL}</span>
            <span className="text-slate-500">{['About you', 'Your community', 'Your stack'][step - 1]}</span>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  initial={false}
                  animate={{ width: s <= step ? '100%' : '0%' }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="gradient-bar-emerald h-full"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-[276px]">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ x: dir * 24 }}
              animate={{ x: 0 }}
              exit={{ x: dir * -24 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 1 && (
                <div className="flex flex-col gap-6">
                  <div>
                    <h2 className="text-base font-semibold text-white">What best describes your work?</h2>
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      {ROLES.map((r) => (
                        <SelectCard key={r.id} label={r.id} icon={r.icon} selected={role === r.id} onClick={() => setRole(r.id)} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-white">How many communities do you manage?</h2>
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      <SegCard label="Just one" desc="A single workspace" selected={managesMultiple === false} onClick={() => setManagesMultiple(false)} />
                      <SegCard label="Multiple" desc="Several workspaces" selected={managesMultiple === true} onClick={() => setManagesMultiple(true)} />
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="flex flex-col gap-6">
                  <div>
                    <h2 className="text-base font-semibold text-white">Name your first workspace</h2>
                    <p className="mt-1 text-sm text-slate-400">The community or client you&apos;ll manage here.</p>
                    <input
                      autoFocus
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                      placeholder="e.g. Arbitrum Foundation"
                      className="mt-3 w-full rounded-xl border border-white/[0.09] bg-black/30 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-[color:var(--accent-emerald)] focus:shadow-[var(--glow-emerald)]"
                    />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-white">How large is the community?</h2>
                    <div className="mt-3 flex flex-wrap gap-2.5">
                      {COMMUNITY_SIZES.map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setCommunitySize(size)}
                          className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                            communitySize === size
                              ? 'border-[color:var(--accent-emerald)] bg-blue-500/10 text-white shadow-[var(--glow-emerald)]'
                              : 'border-white/[0.08] bg-black/20 text-slate-300 hover:border-white/20'
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="flex flex-col gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-white">Which platforms do you use most?</h2>
                    <p className="mt-1 text-sm text-slate-400">Select all that apply, you can connect them later.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {PLATFORMS.map((p) => (
                      <SelectCard key={p.id} label={p.id} icon={p.icon} selected={platforms.includes(p.id)} onClick={() => togglePlatform(p.id)} />
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {error && <p className="mt-4 text-xs text-red-400">{error}</p>}

        {/* Nav */}
        <div className="mt-6 flex items-center justify-between">
          {step > 1 ? (
            <button onClick={() => go(step - 1)} className="flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-white">
              <ArrowLeft size={15} /> Back
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={handleNext}
            disabled={finishing}
            className="focus-ring gradient-bar-emerald sheen flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:shadow-[var(--glow-emerald-strong)] hover:brightness-110 disabled:opacity-60"
          >
            {finishing ? <Loader2 size={16} className="animate-spin" /> : null}
            {step < TOTAL ? 'Continue' : finishing ? 'Setting up…' : 'Enter Catch'}
            {!finishing && step < TOTAL && <ArrowRight size={15} />}
          </button>
        </div>
      </div>
    </div>
  )
}

function SelectCard({ label, icon: Icon, selected, onClick }: { label: string; icon: typeof Users; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-sm font-medium transition-all ${
        selected
          ? 'border-[color:var(--accent-emerald)] bg-blue-500/10 text-white shadow-[var(--glow-emerald)]'
          : 'border-white/[0.08] bg-black/20 text-slate-300 hover:border-white/20 hover:bg-white/[0.03]'
      }`}
    >
      <Icon size={16} className={selected ? 'text-[color:var(--accent-emerald-bright)]' : 'text-slate-500 group-hover:text-slate-300'} />
      <span className="flex-1">{label}</span>
      {selected && <Check size={15} className="text-[color:var(--accent-emerald-bright)]" />}
    </button>
  )
}

function SegCard({ label, desc, selected, onClick }: { label: string; desc: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left transition-all ${
        selected
          ? 'border-[color:var(--accent-emerald)] bg-blue-500/10 shadow-[var(--glow-emerald)]'
          : 'border-white/[0.08] bg-black/20 hover:border-white/20'
      }`}
    >
      <span className="text-sm font-semibold text-white">{label}</span>
      <span className="text-xs text-slate-400">{desc}</span>
    </button>
  )
}
