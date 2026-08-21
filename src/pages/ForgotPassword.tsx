import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CatchMark } from '../components/brand/CatchMark'
import { BrandBackdrop } from '../components/brand/BrandBackdrop'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!EMAIL_RE.test(email)) {
      setError('Enter a valid email address.')
      return
    }
    setError('')
    setLoading(true)
    // Redirect back to wherever the app is actually running (localhost in dev,
    // the deployed origin in prod) — never a hard-coded host.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    if (resetError) {
      // Always coerce to a readable string so the banner never shows "{}".
      setError(resetError.message || 'Unable to send the reset email. Email delivery may not be configured yet.')
      return
    }
    setSent(true)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070b12] px-4">
      <BrandBackdrop />
      <div className="animate-rise-in glow-emerald relative z-10 w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0b1018] p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <Link to="/" className="mb-3" aria-label="Catch home">
            <CatchMark size={72} />
          </Link>
          <h1 className="text-xl font-semibold text-white">Reset your password</h1>
          <p className="mt-1 text-sm text-slate-400">We&apos;ll email you a link to reset it.</p>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 size={36} className="text-blue-400" />
            <p className="text-sm text-slate-300">Check your email for a reset link</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
            )}

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-400">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={`w-full rounded-xl border bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-[color:var(--accent-emerald)] ${
                  error ? 'border-red-500' : 'border-white/[0.09]'
                }`}
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="gradient-bar-emerald sheen mt-2 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:shadow-[var(--glow-emerald-strong)] disabled:opacity-60"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Send reset link
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-400">
          <Link to="/login" className="font-medium text-blue-400 hover:text-blue-300 transition-colors">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  )
}
