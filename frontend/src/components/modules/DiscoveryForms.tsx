import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Check, Copy, ExternalLink, Link2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { createDiscoveryForm, deleteDiscoveryForm, fetchDiscoveryForms, updateDiscoveryForm, type DiscoveryFormAdmin } from '../../lib/api/misc'
import { Card, EmptyState } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Modal } from '../ui/Modal'
import { FormField, inputClass } from '../ui/FormControls'
import { formatRelativeTime } from '../../lib/format'

// Admin only: one discovery form per link. The questions live in the SPA
// (data/discoveryQuestions.ts); a form carries the slug, who it is for and
// where the lead came from. Responses land in Discovery Responses.

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

const linkFor = (slug: string) => `${window.location.origin}/discovery/${slug}`

export function DiscoveryForms() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const isAdmin = user?.role === 'admin'
  const [forms, setForms] = useState<DiscoveryFormAdmin[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [draft, setDraft] = useState({ slug: '', contactName: '', contactEmail: '', source: '' })
  const [slugTouched, setSlugTouched] = useState(false)

  async function load() {
    setError(null)
    try {
      setForms(await fetchDiscoveryForms())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load forms')
      setForms([])
    }
  }
  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin])

  if (!isAdmin) return <Navigate to="/dashboard" replace />

  async function copy(slug: string) {
    try {
      await navigator.clipboard.writeText(linkFor(slug))
      setCopied(slug)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      showToast('Copy failed, select the link manually', 'error')
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const slug = slugify(draft.slug)
    if (!slug) return showToast('Enter a slug (letters, digits, dashes)', 'error')
    setBusy('create')
    try {
      const f = await createDiscoveryForm({ slug, contactName: draft.contactName.trim() || null, contactEmail: draft.contactEmail.trim() || null, source: draft.source.trim() || null })
      setForms((list) => [f, ...(list ?? [])])
      setOpen(false)
      setDraft({ slug: '', contactName: '', contactEmail: '', source: '' })
      setSlugTouched(false)
      showToast(`Form created: ${linkFor(f.slug)}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create the form', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function toggle(f: DiscoveryFormAdmin) {
    setBusy(f.id)
    try {
      const u = await updateDiscoveryForm(f.id, { isActive: !f.isActive })
      setForms((list) => (list ?? []).map((x) => (x.id === u.id ? u : x)))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function remove(f: DiscoveryFormAdmin) {
    if (!window.confirm(`Delete the form "${f.slug}"? The link stops working.`)) return
    setBusy(f.id)
    try {
      await deleteDiscoveryForm(f.id)
      setForms((list) => (list ?? []).filter((x) => x.id !== f.id))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Discovery Forms</h2>
          <p className="text-sm text-[var(--text-secondary)]">One link per prospect. Answers arrive in Discovery Responses.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()} className="!px-3 !py-1.5 text-xs">
            <RefreshCw size={12} /> Refresh
          </Button>
          <Button onClick={() => setOpen(true)} className="!px-3 !py-1.5 text-xs">
            <Plus size={12} /> New form
          </Button>
        </div>
      </div>

      {error && <Card className="p-4 text-sm text-red-300">{error}</Card>}

      {forms === null ? (
        <Card className="flex items-center gap-2 p-5 text-sm text-[var(--text-secondary)]">
          <Loader2 size={14} className="animate-spin" /> Loading forms
        </Card>
      ) : forms.length === 0 ? (
        <Card className="p-5">
          <EmptyState title="No forms yet" description="Create a form to get a shareable link. A generic one works for the website; a named one greets the prospect by name." />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              <tr className="border-b border-[var(--border-card)]">
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Responses</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f.id} className="border-b border-[var(--border-card)]/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link2 size={12} className="text-[var(--accent-emerald)]" />
                      <span className="font-medium text-white">{f.slug}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{linkFor(f.slug)}</div>
                  </td>
                  <td className="px-4 py-3 text-white">
                    {f.contactName ?? <span className="text-[var(--text-secondary)]">n/a</span>}
                    {f.contactEmail && <div className="text-xs text-[var(--text-secondary)]">{f.contactEmail}</div>}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{f.source ?? 'n/a'}</td>
                  <td className="px-4 py-3 text-white">{f.responses}</td>
                  <td className="px-4 py-3">
                    <Badge tone={f.isActive ? 'emerald' : 'gray'}>{f.isActive ? 'Active' : 'Closed'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{formatRelativeTime(f.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button type="button" title="Copy link" onClick={() => void copy(f.slug)} className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-white/[0.05] hover:text-white">
                        {copied === f.slug ? <Check size={14} className="text-[var(--accent-emerald)]" /> : <Copy size={14} />}
                      </button>
                      <a href={linkFor(f.slug)} target="_blank" rel="noreferrer" title="Open form" className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-white/[0.05] hover:text-white">
                        <ExternalLink size={14} />
                      </a>
                      <Button variant="secondary" onClick={() => void toggle(f)} disabled={busy === f.id} className="!px-2 !py-1 text-xs">
                        {f.isActive ? 'Close' : 'Reopen'}
                      </Button>
                      {f.responses === 0 && (
                        <button type="button" title="Delete" onClick={() => void remove(f)} disabled={busy === f.id} className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-red-300">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New discovery form">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormField label="Contact name (optional, the form greets them by name)">
            <input
              className={inputClass}
              value={draft.contactName}
              onChange={(e) => setDraft((d) => ({ ...d, contactName: e.target.value, slug: slugTouched ? d.slug : slugify(e.target.value) }))}
              placeholder="e.g. Heather Bartha"
            />
          </FormField>
          <FormField label="Slug (the link: /discovery/<slug>)">
            <input
              className={inputClass}
              value={draft.slug}
              onChange={(e) => {
                setSlugTouched(true)
                setDraft((d) => ({ ...d, slug: e.target.value }))
              }}
              onBlur={() => setDraft((d) => ({ ...d, slug: slugify(d.slug) }))}
              placeholder="e.g. generic, acme-labs"
            />
            {draft.slug && <span className="text-xs text-[var(--text-secondary)]">{linkFor(slugify(draft.slug) || '...')}</span>}
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Contact email (optional)">
              <input className={inputClass} type="email" value={draft.contactEmail} onChange={(e) => setDraft((d) => ({ ...d, contactEmail: e.target.value }))} placeholder="name@company.com" />
            </FormField>
            <FormField label="Source (optional)">
              <input className={inputClass} value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))} placeholder="e.g. website, linkedin, referral" />
            </FormField>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy === 'create'}>
              {busy === 'create' && <Loader2 size={12} className="animate-spin" />} Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
