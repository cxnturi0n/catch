import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { authClient, authErrorMessage } from '../lib/api/auth'
import { AuthError, AuthShell, authButtonClass, authInputClass } from '../components/auth/AuthShell'

// Landing page of the reset link: `/reset-password?token=…`. Better Auth
// redirects here with `?error=INVALID_TOKEN` when the token is bad/expired.
export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(params.get('error') ? 'This reset link is invalid or has expired. Request a new one.' : '')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 10) return setError('Password must be at least 10 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    if (!token) return setError('Missing reset token.')
    setLoading(true)
    const { error: err } = await authClient.resetPassword({ newPassword: password, token })
    setLoading(false)
    if (err) return setError(authErrorMessage(err))
    navigate('/login?reset=1', { replace: true })
  }

  return (
    <AuthShell
      title="Choose a new password"
      footer={<Link to="/forgot-password" className="text-[var(--accent-emerald-bright)] hover:underline">Request a new link</Link>}
    >
      <AuthError message={error} />
      {token && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input type="password" autoComplete="new-password" required minLength={10} placeholder="New password (10+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} className={authInputClass} />
          <input type="password" autoComplete="new-password" required placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInputClass} />
          <button type="submit" disabled={loading} className={authButtonClass}>
            {loading && <Loader2 size={16} className="animate-spin" />}
            Update password
          </button>
        </form>
      )}
    </AuthShell>
  )
}
