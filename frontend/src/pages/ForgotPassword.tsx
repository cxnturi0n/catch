import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { authClient, authErrorMessage } from '../lib/api/auth'
import { AuthError, AuthNotice, AuthShell, authButtonClass, authInputClass } from '../components/auth/AuthShell'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/reset-password` })
    setLoading(false)
    if (err) return setError(authErrorMessage(err))
    setDone(true)
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={<Link to="/login" className="text-[var(--accent-emerald-bright)] hover:underline">Back to sign in</Link>}
    >
      <AuthError message={error} />
      {done ? (
        <AuthNotice message="If an account exists for that address, a reset link is on its way. It expires in one hour." />
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input type="email" autoComplete="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInputClass} />
          <button type="submit" disabled={loading} className={authButtonClass}>
            {loading && <Loader2 size={16} className="animate-spin" />}
            Send reset link
          </button>
        </form>
      )}
    </AuthShell>
  )
}
