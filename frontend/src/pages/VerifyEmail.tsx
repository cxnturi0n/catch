import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MailWarning } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { authClient } from '../lib/api/auth'
import { AuthNotice, AuthShell, authButtonClass } from '../components/auth/AuthShell'

// Shown when a signed-in user's email is not verified yet, or when the
// verification link failed (`?error=…`). Lets the user re-send the link.
export function VerifyEmail() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const [sent, setSent] = useState(false)
  const failed = params.get('error')

  async function resend() {
    if (!user) return
    await authClient.sendVerificationEmail({ email: user.email, callbackURL: `${window.location.origin}/dashboard` })
    setSent(true)
  }

  return (
    <AuthShell
      title={failed ? 'Verification link expired' : 'Verify your email'}
      subtitle={user ? `Your account ${user.email} is waiting for confirmation.` : 'Sign in to request a new verification link.'}
      footer={<Link to="/login" className="text-slate-400 hover:text-white">Back to sign in</Link>}
    >
      <div className="mb-4 flex justify-center text-amber-400">
        <MailWarning size={32} />
      </div>
      {sent && <AuthNotice message="A new verification email is on its way." />}
      {user && !sent && (
        <button type="button" onClick={resend} className={authButtonClass}>
          Resend verification email
        </button>
      )}
    </AuthShell>
  )
}
