import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { AuthError, AuthShell, authButtonClass, authInputClass } from '../components/auth/AuthShell'
import { ProviderButtons } from '../components/auth/ProviderButtons'

export function Login() {
  const { login, providers } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(params.get('error') === 'oauth' ? 'Sign-in with that provider failed. Please try again.' : '')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const r = await login(email.trim(), password)
    setLoading(false)
    if (!r.ok) return setError(r.error ?? 'Sign-in failed.')
    if (r.twoFactorRequired) return navigate('/two-factor', { replace: true })
    navigate('/dashboard', { replace: true })
  }

  return (
    <AuthShell
      title="Welcome to Catch"
      subtitle="Sign in to your command center."
      footer={
        <>
          New here? <Link to="/signup" className="text-[var(--accent-emerald-bright)] hover:underline">Create an account</Link>
        </>
      }
    >
      <AuthError message={error} />
      <ProviderButtons onError={setError} />
      {providers.length > 0 && (
        <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
          <div className="h-px flex-1 bg-white/10" />
          or with email
          <div className="h-px flex-1 bg-white/10" />
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input type="email" autoComplete="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInputClass} />
        <input type="password" autoComplete="current-password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className={authInputClass} />
        <button type="submit" disabled={loading} className={authButtonClass}>
          {loading && <Loader2 size={16} className="animate-spin" />}
          Sign in
        </button>
        <Link to="/forgot-password" className="text-center text-xs text-slate-400 hover:text-white">
          Forgot your password?
        </Link>
      </form>
    </AuthShell>
  )
}
