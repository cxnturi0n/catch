import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { authClient, authErrorMessage } from '../lib/api/auth'
import { AuthError, AuthShell, authButtonClass, authInputClass } from '../components/auth/AuthShell'

// Second-factor challenge. The pending sign-in lives in a short-lived cookie
// set by the server; the dashboard stays locked until a code is accepted.
export function TwoFactor() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [mode, setMode] = useState<'totp' | 'backup'>('totp')
  const [code, setCode] = useState('')
  const [trust, setTrust] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res =
      mode === 'totp'
        ? await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ''), trustDevice: trust })
        : await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice: trust })
    setLoading(false)
    if (res.error) return setError(authErrorMessage(res.error))
    await refresh()
    navigate('/dashboard', { replace: true })
  }

  return (
    <AuthShell
      title="Two-factor authentication"
      subtitle={mode === 'totp' ? 'Enter the 6-digit code from your authenticator app.' : 'Enter one of your backup codes.'}
      footer={<Link to="/login" className="text-slate-400 hover:text-white">Cancel and go back</Link>}
    >
      <div className="mb-4 flex justify-center text-[var(--accent-emerald-bright)]">
        <ShieldCheck size={32} />
      </div>
      <AuthError message={error} />
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          inputMode={mode === 'totp' ? 'numeric' : 'text'}
          autoComplete="one-time-code"
          autoFocus
          required
          placeholder={mode === 'totp' ? '123 456' : 'xxxxx-xxxxx'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`${authInputClass} text-center tracking-[0.3em]`}
        />
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="accent-[var(--accent-emerald)]" />
          Trust this device for 30 days
        </label>
        <button type="submit" disabled={loading || !code} className={authButtonClass}>
          {loading && <Loader2 size={16} className="animate-spin" />}
          Verify
        </button>
      </form>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'totp' ? 'backup' : 'totp')
          setCode('')
          setError('')
        }}
        className="mt-4 w-full text-center text-xs text-slate-400 hover:text-white"
      >
        {mode === 'totp' ? 'Use a backup code instead' : 'Use my authenticator app'}
      </button>
    </AuthShell>
  )
}
