import { useMemo, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Plus, Users } from 'lucide-react'
import { getKols as getSeedKols, kolChannels, kolStatuses } from '../../data/mockData'
import { addKOL, fetchKOLs, seedKOLs } from '../../lib/db'
import type { KOL, KOLChannel, KOLStatus } from '../../types'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { FormField, Select, inputClass } from '../ui/FormControls'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'
import { useWorkspaceData } from '../../hooks/useWorkspaceData'
import { formatCompactNumber, formatRelativeTime } from '../../lib/format'

const STATUS_TONE: Record<KOLStatus, BadgeTone> = {
  Active: 'green',
  Pending: 'yellow',
  Inactive: 'gray',
}

const emptyForm = {
  name: '',
  handle: '',
  channel: kolChannels[0],
  reach: '',
  status: 'Pending' as KOLStatus,
  lastActivity: new Date().toISOString().slice(0, 10),
  notes: '',
}

export function KOLTracker() {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const { data: kols, setData: setKols, loading } = useWorkspaceData(activeWorkspaceId, fetchKOLs, seedKOLs, getSeedKols, !!user)
  const [statusFilter, setStatusFilter] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; handle?: string }>({})
  const [form, setForm] = useState(emptyForm)

  const filtered = useMemo(() => {
    const list = kols.filter((k) => (statusFilter ? k.status === statusFilter : true))
    if (!sortDir) return list
    return [...list].sort((a, b) => (sortDir === 'asc' ? a.reach - b.reach : b.reach - a.reach))
  }, [kols, statusFilter, sortDir])

  function toggleSort() {
    setSortDir((prev) => (prev === null ? 'desc' : prev === 'desc' ? 'asc' : null))
  }

  function closeModal() {
    setModalOpen(false)
    setForm(emptyForm)
    setErrors({})
    setSubmitting(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (!form.name.trim()) nextErrors.name = 'Name is required.'
    if (!form.handle.trim()) nextErrors.handle = 'Handle is required.'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSubmitting(true)

    const kolInput = {
      name: form.name.trim(),
      handle: form.handle.trim(),
      channel: form.channel,
      reach: Number(form.reach) || 0,
      status: form.status,
      lastActivity: form.lastActivity,
      notes: form.notes.trim(),
    }

    if (!user) {
      // Guest mode — keep the KOL in memory only, no API write.
      const localKol: KOL = { id: `local-${Date.now()}`, ...kolInput }
      setKols((prev) => [localKol, ...prev])
      closeModal()
      return
    }

    try {
      const newKol = await addKOL(activeWorkspaceId, kolInput)
      setKols((prev) => [newKol, ...prev])
      closeModal()
    } catch {
      setSubmitting(false)
      setErrors({ name: 'Failed to save KOL. Please try again.' })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={statusFilter} onChange={setStatusFilter} options={kolStatuses} placeholder="All statuses" />
        <Button onClick={() => setModalOpen(true)}>
          <Plus size={16} /> Add KOL
        </Button>
      </div>

      <Card className="p-0">
        <div className="flex items-center gap-2 border-b border-[var(--border-card)] px-5 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
            <Users size={16} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">KOL directory</h3>
            <p className="text-[11px] text-[var(--text-secondary)]">Name · handle · channel · reach · status</p>
          </div>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-card)] text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Handle</th>
              <th className="px-5 py-3 font-medium">Channel</th>
              <th className="px-5 py-3 font-medium">
                <button onClick={toggleSort} className="flex items-center gap-1 hover:text-white transition-colors">
                  Reach
                  {sortDir === 'desc' ? <ArrowDown size={12} /> : sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowUpDown size={12} />}
                </button>
              </th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Last Activity</th>
              <th className="px-5 py-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center text-[var(--text-secondary)]">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 size={24} className="animate-spin text-slate-600" />
                    Loading KOLs…
                  </div>
                </td>
              </tr>
            ) : (
              <>
                {filtered.map((kol) => (
                  <tr key={kol.id} className="border-b border-[var(--border-card)] last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 font-medium text-white">{kol.name}</td>
                    <td className="px-5 py-3 text-slate-300">{kol.handle}</td>
                    <td className="px-5 py-3 text-slate-300">{kol.channel}</td>
                    <td className="px-5 py-3 text-slate-300">{formatCompactNumber(kol.reach)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[kol.status]}>{kol.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-300">{formatRelativeTime(kol.lastActivity)}</td>
                    <td className="px-5 py-3 max-w-xs truncate text-slate-400" title={kol.notes}>
                      {kol.notes}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-16 text-center text-[var(--text-secondary)]">
                      <div className="flex flex-col items-center gap-2">
                        <Users size={28} className="text-slate-600" />
                        No KOLs match this filter
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={closeModal} title="Add KOL">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Name">
              <input
                className={`${inputClass} ${errors.name ? 'border-red-500' : ''}`}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. CryptoNova"
              />
              {errors.name && <span className="text-xs text-red-400">{errors.name}</span>}
            </FormField>
            <FormField label="Handle">
              <input
                className={`${inputClass} ${errors.handle ? 'border-red-500' : ''}`}
                value={form.handle}
                onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
                placeholder="e.g. @cryptonova"
              />
              {errors.handle && <span className="text-xs text-red-400">{errors.handle}</span>}
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Channel">
              <select className={inputClass} value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as KOLChannel }))}>
                {kolChannels.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Reach">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={form.reach}
                onChange={(e) => setForm((f) => ({ ...f, reach: e.target.value }))}
                placeholder="e.g. 50000"
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Status">
              <select className={inputClass} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as KOLStatus }))}>
                {kolStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Last Activity">
              <input
                type="date" lang="en-US"
                className={inputClass}
                value={form.lastActivity}
                onChange={(e) => setForm((f) => ({ ...f, lastActivity: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Notes">
            <textarea
              className={`${inputClass} min-h-20 resize-none`}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Context, engagement history, deal terms..."
            />
          </FormField>
          <div className="mt-1 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Add KOL
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
