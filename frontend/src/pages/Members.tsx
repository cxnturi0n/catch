import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Mail, Shield, Trash2, UserPlus, Users } from 'lucide-react'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api/client'
import { Button } from '../components/ui/Button'
import { Card, EmptyState } from '../components/ui/Card'
import { inputClass, Select } from '../components/ui/FormControls'
import { initials } from '../data/moderatorsData'

type Role = 'owner' | 'admin' | 'member'
interface Member {
  userId: string
  role: Role
  name: string
  email: string
  image: string | null
  joinedAt: string
}
interface Invite {
  id: string
  email: string
  role: 'admin' | 'member'
  expiresAt: string
}

export function Members() {
  const { activeWorkspaceId, workspaces } = useWorkspace()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [myRole, setMyRole] = useState<Role>('member')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [busy, setBusy] = useState(false)
  const base = `/workspaces/${activeWorkspaceId}/members`
  const wsName = workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? 'this workspace'

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return
    const r = await api<{ members: Member[]; invites: Invite[]; me: { role: Role } }>(base)
    setMembers(r.members)
    setInvites(r.invites)
    setMyRole(r.me.role)
  }, [activeWorkspaceId, base])
  useEffect(() => {
    void load().catch(() => undefined)
  }, [load])

  const canManage = myRole === 'owner' || myRole === 'admin'

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api(`${base}/invites`, { method: 'POST', body: { email: email.trim(), role } })
      showToast(`Invitation sent to ${email.trim()}`)
      setEmail('')
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send invitation', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn()
      showToast(ok)
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error')
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Members</h1>
        <p className="text-sm text-[var(--text-secondary)]">People who can access {wsName}. Owners manage roles; admins manage data and invitations; members use the workspace.</p>
      </div>

      {canManage && (
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <UserPlus size={16} className="text-[var(--accent-emerald-bright)]" /> Invite someone
          </h2>
          <form onSubmit={invite} className="flex flex-wrap gap-2">
            <input type="email" required placeholder="email@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputClass} min-w-[240px] flex-1`} />
            <Select value={role} onChange={(v) => setRole(v as 'admin' | 'member')} options={['member', 'admin']} placeholder="Role" />
            <Button type="submit" loading={busy}>
              Send invite
            </Button>
          </form>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">They must sign in with that exact e-mail address to accept. Links expire after 7 days.</p>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-[var(--border-card)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)]">
          <Users size={16} className="text-[var(--accent-emerald-bright)]" /> {members.length} member{members.length === 1 ? '' : 's'}
        </div>
        <ul>
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 border-b border-[var(--border-card)] px-5 py-3 last:border-b-0">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-white">{initials(m.name)}</div>
                <div className="min-w-0">
                  <div className="truncate text-sm text-[var(--text-primary)]">
                    {m.name} {m.userId === user?.id && <span className="text-xs text-[var(--text-secondary)]">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-[var(--text-secondary)]">{m.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {myRole === 'owner' && m.role !== 'owner' ? (
                  <Select value={m.role} onChange={(v) => act(() => api(`${base}/${m.userId}`, { method: 'PATCH', body: { role: v } }), 'Role updated')} options={['member', 'admin']} placeholder="Role" />
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-card)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                    <Shield size={12} /> {m.role}
                  </span>
                )}
                {m.role !== 'owner' && (canManage || m.userId === user?.id) && (
                  <Button variant="ghost" size="sm" onClick={() => act(() => api(`${base}/${m.userId}`, { method: 'DELETE' }), m.userId === user?.id ? 'You left the workspace' : 'Member removed')}>
                    <Trash2 size={14} /> {m.userId === user?.id ? 'Leave' : 'Remove'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {canManage && (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-[var(--border-card)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)]">
            <Mail size={16} className="text-[var(--accent-emerald-bright)]" /> Pending invitations
          </div>
          {invites.length === 0 ? (
            <EmptyState icon={<Mail size={22} />} title="No pending invitations" description="Invitations you send appear here until accepted." className="py-8" />
          ) : (
            <ul>
              {invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-card)] px-5 py-3 last:border-b-0 text-sm">
                  <div>
                    <div className="text-[var(--text-primary)]">{i.email}</div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => act(() => api(`${base}/invites/${i.id}`, { method: 'DELETE' }), 'Invitation revoked')}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
