import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MailCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { AuthError, AuthShell, authButtonClass, authInputClass } from '../components/auth/AuthShell'
import { ProviderButtons } from '../components/auth/ProviderButtons'

export function Signup() {
  const { signup, providers } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 10) return setError('Password must be at least 10 characters.')
    setLoading(true)
    const r = await signup(name, email.trim(), password)
    setLoading(false)
    if (!r.ok) return setError(r.error ?? 'Sign-up failed.')
    setSent(true)
  }

  if (sent) {
    return (
      <AuthShell title="Check your inbox" subtitle={`We sent a verification link to ${email.trim()}.`}>
        <div className="flex flex-col items-center gap-3 text-center text-sm text-slate-400">
          <MailCheck size={36} className="text-[var(--accent-emerald-bright)]" />
          <p>Open the link to activate your account. It expires in one hour.</p>
          <Link to="/login" className="mt-2 text-[var(--accent-emerald-bright)] hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Your command center for Web3 communities."
      footer={
        <>
          Already have an account? <Link to="/login" className="text-[var(--accent-emerald-bright)] hover:underline">Sign in</Link>
        </>
      }
    >
      <AuthError message={error} />
      <ProviderButtons onError={setError} redirectTo="/onboarding" />
      {providers.length > 0 && (
        <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
          <div className="h-px flex-1 bg-white/10" />
          or with email
          <div className="h-px flex-1 bg-white/10" />
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input type="text" autoComplete="name" required placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} className={authInputClass} />
        <input type="email" autoComplete="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInputClass} />
        <input type="password" autoComplete="new-password" required minLength={10} placeholder="Password (10+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} className={authInputClass} />
        <button type="submit" disabled={loading} className={authButtonClass}>
          {loading && <Loader2 size={16} className="animate-spin" />}
          Create account
        </button>
      </form>
    </AuthShell>
  )
}
