import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { api, isApiError } from '../lib/api/client'
import { AuthError, AuthShell, authButtonClass } from '../components/auth/AuthShell'

interface InviteInfo {
  workspace: string
  role: string
  emailHint: string
}

// Landing page of an invitation link. Works signed-out (shows what it is and
// sends to login/signup) and signed-in (accepts with one click).
export function AcceptInvite() {
  const { token = '' } = useParams()
  const { user, isLoading } = useAuth()
  const { reloadWorkspaces, setActiveWorkspaceId } = useWorkspace()
  const navigate = useNavigate()
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<InviteInfo>(`/invites/${token}`)
      .then(setInfo)
      .catch((e) => setError(isApiError(e) && e.status === 404 ? 'This invitation is invalid, expired or already used.' : 'Could not load the invitation.'))
  }, [token])

  async function accept() {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ workspaceId: string }>(`/invites/${token}/accept`, { method: 'POST' })
      await reloadWorkspaces()
      setActiveWorkspaceId(r.workspaceId)
      navigate('/dashboard', { replace: true })
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not accept the invitation.')
      setBusy(false)
    }
  }

  const next = encodeURIComponent(`/invite/${token}`)
  return (
    <AuthShell title={info ? `Join ${info.workspace}` : 'Workspace invitation'} subtitle={info ? `You were invited as ${info.role} (sent to ${info.emailHint}).` : undefined}>
      <div className="mb-4 flex justify-center text-[var(--accent-emerald-bright)]">
        <Users size={32} />
      </div>
      <AuthError message={error} />
      {info && !isLoading && (
        user ? (
          <button type="button" onClick={accept} disabled={busy} className={authButtonClass}>
            {busy && <Loader2 size={16} className="animate-spin" />} Accept as {user.email}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <Link to={`/login?next=${next}`} className={authButtonClass}>Sign in to accept</Link>
            <Link to={`/signup?next=${next}`} className="text-center text-xs text-slate-400 hover:text-white">No account yet? Create one with the invited e-mail</Link>
          </div>
        )
      )}
    </AuthShell>
  )
}
