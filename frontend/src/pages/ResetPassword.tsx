import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { CatchMark } from '../components/brand/CatchMark'
import { BrandBackdrop } from '../components/brand/BrandBackdrop'

export function ResetPassword() {
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [checking, setChecking] = useState(true)
  const [validLink, setValidLink] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<{ next?: string; confirm?: string; form?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // The reset link lands here as `#access_token=...&type=recovery` in the
    // URL hash. supabase-js auto-detects and consumes that hash on client
    // init to establish a recovery session — we just confirm it landed,
    // via either the PASSWORD_RECOVERY event or a session already present.
    const hash = window.location.hash
    const hasRecoveryHash = hash.includes('type=recovery') || hash.includes('access_token')
    let cancelled = false

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !cancelled) {
        setValidLink(true)
        setChecking(false)
      }
    })

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (data.session || hasRecoveryHash) setValidLink(true)
      setChecking(false)
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (newPassword.length < 8) nextErrors.next = 'Password must be at least 8 characters.'
    if (confirmPassword !== newPassword) nextErrors.confirm = 'Passwords do not match.'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setSubmitting(false)
      setErrors({ form: error.message })
      return
    }
    // Recovery flow leaves the user signed in — sign out so /login renders
    // the actual login form instead of bouncing straight to /dashboard.
    await supabase.auth.signOut()
    setSubmitting(false)
    showToast('Password updated successfully')
    navigate('/login')
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070b12] px-4">
      <BrandBackdrop />
      <div className="animate-rise-in glow-emerald relative z-10 w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0b1018] p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <Link to="/" className="mb-3" aria-label="Catch home">
            <CatchMark size={72} />
          </Link>
          <h1 className="text-xl font-semibold text-white">Set a new password</h1>
          <p className="mt-1 text-sm text-slate-400">Choose a new password for your account.</p>
        </div>

        {checking ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 size={24} className="animate-spin text-slate-500" />
            <p className="text-sm text-slate-400">Verifying reset link…</p>
          </div>
        ) : !validLink ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-red-400">This reset link is invalid or has expired.</p>
            <Link to="/forgot-password" className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors">
              Request a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {errors.form && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">{errors.form}</div>
            )}

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-400">New password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className={`w-full rounded-xl border bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-[color:var(--accent-emerald)] ${
                  errors.next ? 'border-red-500' : 'border-white/[0.09]'
                }`}
              />
              {errors.next && <span className="text-xs text-red-400">{errors.next}</span>}
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-400">Confirm new password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className={`w-full rounded-xl border bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-[color:var(--accent-emerald)] ${
                  errors.confirm ? 'border-red-500' : 'border-white/[0.09]'
                }`}
              />
              {errors.confirm && <span className="text-xs text-red-400">{errors.confirm}</span>}
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="gradient-bar-emerald sheen mt-2 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:shadow-[var(--glow-emerald-strong)] disabled:opacity-60"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              Update password
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
