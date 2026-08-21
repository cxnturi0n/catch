import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { CatchMark } from '../components/brand/CatchMark'
import { BrandBackdrop } from '../components/brand/BrandBackdrop'

function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

export function Login() {
  const { signInWithGoogle } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGoogle() {
    setError('')
    setLoading(true)
    const result = await signInWithGoogle()
    // On success the browser is redirected to Google, so we never reach here;
    // only failures fall through and need the button re-enabled.
    if (!result.ok) {
      setLoading(false)
      setError(result.error ?? 'Could not start Google sign-in. Please try again.')
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070b12] px-4">
      <BrandBackdrop />
      <div className="animate-rise-in glow-emerald relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b1018] p-8">
        {/* Sapphire hairline crowning the card */}
        <div aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-emerald-bright)]/60 to-transparent" />
        <div className="mb-7 flex flex-col items-center text-center">
          <Link to="/" className="mb-3" aria-label="Catch home">
            <CatchMark size={72} />
          </Link>
          <h1 className="text-xl font-semibold text-white">Welcome to Catch</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to your command center.</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
        )}

        <button
          onClick={handleGoogle}
          disabled={loading}
          className="focus-ring sheen flex w-full items-center justify-center gap-3 rounded-xl bg-white py-3 text-sm font-semibold text-[#1f1f1f] transition-all hover:bg-slate-100 active:scale-[0.99] disabled:opacity-70"
        >
          {loading ? <Loader2 size={18} className="animate-spin text-slate-500" /> : <GoogleG size={18} />}
          {loading ? 'Redirecting to Google…' : 'Continue with Google'}
        </button>

        <p className="mt-4 text-center text-xs text-slate-500">
          We only use Google to sign you in — no password to remember or lose.
        </p>
      </div>
    </div>
  )
}
