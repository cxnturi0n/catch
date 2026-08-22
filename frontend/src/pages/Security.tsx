import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, KeyRound, Link2, Loader2, LogOut, Monitor, ShieldCheck, ShieldOff, Trash2, Unlink } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { authClient, authErrorMessage, PROVIDER_LABELS, type SocialProvider } from '../lib/api/auth'
import { Button } from '../components/ui/Button'
import { FormField, inputClass } from '../components/ui/FormControls'
import { Modal } from '../components/ui/Modal'

interface SessionRow {
  id: string
  token: string
  createdAt: string | Date
  updatedAt: string | Date
  expiresAt: string | Date
  ipAddress?: string | null
  userAgent?: string | null
}
interface AccountRow {
  id: string
  accountId: string
  providerId: string
  createdAt: string | Date
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border-card)] bg-[var(--surface-1)] p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <span className="text-[var(--accent-emerald-bright)]">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function describeAgent(ua?: string | null): string {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return [browser, os].filter(Boolean).join(' · ')
}

export function Security() {
  const { user, refresh, providers } = useAuth()
  const { showToast } = useToast()

  // --- password -------------------------------------------------------------
  const [hasPassword, setHasPassword] = useState<boolean | null>(null)
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  // --- two-factor -----------------------------------------------------------
  const [tfaModal, setTfaModal] = useState<'enable' | 'disable' | 'codes' | null>(null)
  const [tfaPassword, setTfaPassword] = useState('')
  const [totpUri, setTotpUri] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [totpCode, setTotpCode] = useState('')
  const [tfaBusy, setTfaBusy] = useState(false)
  const [tfaError, setTfaError] = useState('')

  // --- sessions & accounts --------------------------------------------------
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePw, setDeletePw] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteSent, setDeleteSent] = useState(false)
  const [accounts, setAccounts] = useState<AccountRow[]>([])

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([authClient.listSessions(), authClient.listAccounts()])
    if (s.data) setSessions(s.data as SessionRow[])
    if (a.data) {
      setAccounts(a.data as AccountRow[])
      setHasPassword((a.data as AccountRow[]).some((x) => x.providerId === 'credential'))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function changePassword(e: FormEvent) {
    e.preventDefault()
    if (newPw.length < 10) return showToast('New password must be at least 10 characters')
    setPwBusy(true)
    const { error } = await authClient.changePassword({ currentPassword: curPw, newPassword: newPw, revokeOtherSessions: true })
    setPwBusy(false)
    if (error) return showToast(authErrorMessage(error))
    setCurPw('')
    setNewPw('')
    showToast('Password updated. Other sessions were signed out.')
    void load()
  }

  async function startEnable(e: FormEvent) {
    e.preventDefault()
    setTfaError('')
    setTfaBusy(true)
    const { data, error } = await authClient.twoFactor.enable({ password: tfaPassword, issuer: 'Catch' })
    setTfaBusy(false)
    if (error || !data || data.method !== 'totp') return setTfaError(authErrorMessage(error))
    setTotpUri(data.totpURI)
    setBackupCodes(data.backupCodes)
  }

  async function confirmEnable(e: FormEvent) {
    e.preventDefault()
    setTfaError('')
    setTfaBusy(true)
    const { error } = await authClient.twoFactor.verifyTotp({ code: totpCode.replace(/\s/g, '') })
    setTfaBusy(false)
    if (error) return setTfaError(authErrorMessage(error))
    await refresh()
    setTfaModal('codes')
    showToast('Two-factor authentication enabled')
  }

  async function disable(e: FormEvent) {
    e.preventDefault()
    setTfaError('')
    setTfaBusy(true)
    const { error } = await authClient.twoFactor.disable({ password: tfaPassword })
    setTfaBusy(false)
    if (error) return setTfaError(authErrorMessage(error))
    await refresh()
    closeTfa()
    showToast('Two-factor authentication disabled')
  }

  async function regenerateCodes(e: FormEvent) {
    e.preventDefault()
    setTfaError('')
    setTfaBusy(true)
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password: tfaPassword })
    setTfaBusy(false)
    if (error || !data) return setTfaError(authErrorMessage(error))
    setBackupCodes(data.backupCodes)
    setTfaPassword('')
  }

  function closeTfa() {
    setTfaModal(null)
    setTfaPassword('')
    setTotpUri('')
    setBackupCodes([])
    setTotpCode('')
    setTfaError('')
  }

  async function revoke(token: string) {
    await authClient.revokeSession({ token })
    showToast('Session revoked')
    void load()
  }
  async function revokeOthers() {
    await authClient.revokeOtherSessions()
    showToast('Signed out everywhere else')
    void load()
  }

  async function link(p: SocialProvider) {
    const { error } = await authClient.linkSocial({ provider: p, callbackURL: `${window.location.origin}/dashboard/security` })
    if (error) showToast(authErrorMessage(error))
  }
  async function unlink(providerId: string) {
    const acc = accounts.find((a) => a.providerId === providerId)
    if (!acc) return
    const { error } = await authClient.unlinkAccount({ accountId: acc.accountId })
    if (error) return showToast(authErrorMessage(error))
    showToast(`${PROVIDER_LABELS[providerId as SocialProvider] ?? providerId} unlinked`)
    void load()
  }

  async function requestDeletion(e: FormEvent) {
    e.preventDefault()
    setDeleteError('')
    setDeleteBusy(true)
    const { error } = await authClient.deleteUser({ ...(hasPassword ? { password: deletePw } : {}), callbackURL: `${window.location.origin}/` })
    setDeleteBusy(false)
    if (error) return setDeleteError(authErrorMessage(error))
    setDeleteSent(true)
  }

  const copyCodes = () => {
    void navigator.clipboard.writeText(backupCodes.join('\n'))
    showToast('Backup codes copied')
  }

  const linked = new Set(accounts.map((a) => a.providerId))
  const tfaOn = user?.twoFactorEnabled ?? false
  const totpSecret = totpUri ? new URL(totpUri).searchParams.get('secret') : null

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Security</h1>
        <p className="text-sm text-[var(--text-secondary)]">Password, two-factor authentication, devices and linked accounts.</p>
      </div>

      <SectionCard title="Two-factor authentication" icon={tfaOn ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          {tfaOn
            ? 'Enabled. Signing in requires a code from your authenticator app (or a backup code).'
            : 'Add a second step at sign-in using an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy.'}
        </p>
        {hasPassword === false && (
          <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Set a password first (below): two-factor settings are protected by your password.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {tfaOn ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setTfaModal('codes')}>
                Regenerate backup codes
              </Button>
              <Button variant="danger" size="sm" onClick={() => setTfaModal('disable')}>
                Disable
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setTfaModal('enable')} disabled={hasPassword === false}>
              Enable two-factor
            </Button>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Password" icon={<KeyRound size={16} />}>
        {hasPassword === false ? (
          <p className="text-sm text-[var(--text-secondary)]">
            You sign in with a linked account. To add a password, use <a className="text-[var(--accent-emerald-bright)] hover:underline" href="/forgot-password">“Forgot password”</a> with your email to set one.
          </p>
        ) : (
          <form onSubmit={changePassword} className="flex flex-col gap-3">
            <FormField label="Current password">
              <input type="password" autoComplete="current-password" required value={curPw} onChange={(e) => setCurPw(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="New password (10+ characters)">
              <input type="password" autoComplete="new-password" required minLength={10} value={newPw} onChange={(e) => setNewPw(e.target.value)} className={inputClass} />
            </FormField>
            <div>
              <Button type="submit" size="sm" loading={pwBusy}>
                Update password
              </Button>
            </div>
          </form>
        )}
      </SectionCard>

      <SectionCard title="Linked accounts" icon={<Link2 size={16} />}>
        <ul className="flex flex-col gap-2">
          {(['google', 'discord', 'facebook', 'twitter'] as SocialProvider[])
            .filter((p) => providers.includes(p) || linked.has(p))
            .map((p) => (
              <li key={p} className="flex items-center justify-between rounded-xl border border-[var(--border-card)] px-3 py-2 text-sm">
                <span className="text-[var(--text-primary)]">{PROVIDER_LABELS[p]}</span>
                {linked.has(p) ? (
                  <Button variant="ghost" size="sm" onClick={() => unlink(p)} disabled={accounts.length <= 1}>
                    <Unlink size={14} /> Unlink
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => link(p)}>
                    Link
                  </Button>
                )}
              </li>
            ))}
          {providers.length === 0 && accounts.every((a) => a.providerId === 'credential') && (
            <li className="text-sm text-[var(--text-secondary)]">No social providers are configured on this deployment.</li>
          )}
        </ul>
      </SectionCard>

      <SectionCard title="Active sessions" icon={<Monitor size={16} />}>
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-xl border border-[var(--border-card)] px-3 py-2 text-sm">
              <div>
                <div className="text-[var(--text-primary)]">{describeAgent(s.userAgent)}</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {s.ipAddress ?? 'unknown IP'} · last active {new Date(s.updatedAt).toLocaleString()}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => revoke(s.token)}>
                <LogOut size={14} /> Revoke
              </Button>
            </li>
          ))}
        </ul>
        {sessions.length > 1 && (
          <div className="mt-3">
            <Button variant="danger" size="sm" onClick={revokeOthers}>
              Sign out all other sessions
            </Button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Delete account" icon={<Trash2 size={16} />}>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">
          Permanently removes your account, your workspaces and everything in them (moderators, metrics, files, reports). You will receive a confirmation email before anything is deleted.
        </p>
        <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete my account
        </Button>
      </SectionCard>

      <Modal open={deleteOpen} onClose={() => { setDeleteOpen(false); setDeletePw(''); setDeleteError(''); setDeleteSent(false) }} title="Delete account">
        {deleteSent ? (
          <p className="text-sm text-[var(--text-secondary)]">Check your inbox: open the confirmation link to complete the deletion. The link expires in one hour.</p>
        ) : (
          <form onSubmit={requestDeletion} className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]">This cannot be undone. {hasPassword ? 'Confirm your password to continue.' : 'A confirmation email will be sent to your address.'}</p>
            {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
            {hasPassword && <input type="password" autoComplete="current-password" required value={deletePw} onChange={(e) => setDeletePw(e.target.value)} className={inputClass} placeholder="Password" />}
            <Button type="submit" variant="danger" loading={deleteBusy}>
              Send confirmation email
            </Button>
          </form>
        )}
      </Modal>

      {/* ---- 2FA modals ---- */}
      <Modal open={tfaModal === 'enable'} onClose={closeTfa} title="Enable two-factor authentication">
        {!totpUri ? (
          <form onSubmit={startEnable} className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]">Confirm your password to continue.</p>
            {tfaError && <p className="text-sm text-red-400">{tfaError}</p>}
            <input type="password" autoComplete="current-password" required value={tfaPassword} onChange={(e) => setTfaPassword(e.target.value)} className={inputClass} placeholder="Password" />
            <Button type="submit" loading={tfaBusy}>
              Continue
            </Button>
          </form>
        ) : (
          <form onSubmit={confirmEnable} className="flex flex-col gap-4">
            <p className="text-sm text-[var(--text-secondary)]">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
            <div className="flex justify-center rounded-xl bg-white p-3">
              <QRCodeSVG value={totpUri} size={180} />
            </div>
            {totpSecret && (
              <p className="break-all text-center font-mono text-xs text-[var(--text-secondary)]">
                Can't scan? Enter this key manually: {totpSecret}
              </p>
            )}
            {tfaError && <p className="text-sm text-red-400">{tfaError}</p>}
            <input inputMode="numeric" autoComplete="one-time-code" required placeholder="123 456" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} className={`${inputClass} text-center tracking-[0.3em]`} />
            <Button type="submit" loading={tfaBusy}>
              {tfaBusy ? <Loader2 size={14} className="animate-spin" /> : null} Verify and enable
            </Button>
          </form>
        )}
      </Modal>

      <Modal open={tfaModal === 'disable'} onClose={closeTfa} title="Disable two-factor authentication">
        <form onSubmit={disable} className="flex flex-col gap-3">
          <p className="text-sm text-[var(--text-secondary)]">Your account will be protected by your password only. Confirm your password to disable.</p>
          {tfaError && <p className="text-sm text-red-400">{tfaError}</p>}
          <input type="password" autoComplete="current-password" required value={tfaPassword} onChange={(e) => setTfaPassword(e.target.value)} className={inputClass} placeholder="Password" />
          <Button type="submit" variant="danger" loading={tfaBusy}>
            Disable two-factor
          </Button>
        </form>
      </Modal>

      <Modal open={tfaModal === 'codes'} onClose={closeTfa} title="Backup codes">
        {backupCodes.length === 0 ? (
          <form onSubmit={regenerateCodes} className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]">Generating new codes invalidates the old ones. Confirm your password.</p>
            {tfaError && <p className="text-sm text-red-400">{tfaError}</p>}
            <input type="password" autoComplete="current-password" required value={tfaPassword} onChange={(e) => setTfaPassword(e.target.value)} className={inputClass} placeholder="Password" />
            <Button type="submit" loading={tfaBusy}>
              Generate new backup codes
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]">
              Each code works once. Store them somewhere safe — they are the only way in if you lose your authenticator.
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--surface-2)] p-3 font-mono text-sm text-[var(--text-primary)]">
              {backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={copyCodes}>
                <Copy size={14} /> Copy
              </Button>
              <Button size="sm" onClick={closeTfa}>
                I've saved them
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
