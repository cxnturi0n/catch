import { useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { FormField, inputClass } from '../../ui/FormControls'
import {
  deleteContentScheduleItem,
  insertContentScheduleItem,
  updateContentScheduleItem,
} from '../../../lib/dbPlatformV2'
import type {
  ContentPlatform,
  ContentScheduleItem,
  Moderator,
  WorkspaceId,
} from '../../../types'

const PLATFORMS: ContentPlatform[] = [
  'discord', 'telegram', 'twitter', 'x', 'zealy', 'galxe', 'snapshot', 'twitch', 'youtube', 'kick', 'other',
]

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  open: boolean
  onClose: () => void
  workspaceId: WorkspaceId
  moderators: Moderator[]
  /** Item being edited; null = create. */
  editing: ContentScheduleItem | null
  /** Prefill date (YYYY-MM-DD) — used when opened from a calendar day click. */
  prefillDate?: string
  onSaved: (item: ContentScheduleItem) => void
  onDeleted: (id: string) => void
}

export function ContentFormModal({
  open, onClose, workspaceId, moderators, editing, prefillDate, onSaved, onDeleted,
}: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [platform, setPlatform] = useState<ContentPlatform | ''>('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [assignedModerator, setAssignedModerator] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSubmitting(false)
    if (editing) {
      setTitle(editing.title)
      setDescription(editing.description ?? '')
      setPlatform(editing.platform ?? '')
      setScheduledAt(toDatetimeLocal(editing.scheduledAt))
      setAssignedModerator(editing.assignedModeratorId ?? '')
      setNotes(editing.notes ?? '')
    } else {
      const base = prefillDate ? new Date(`${prefillDate}T09:00:00`) : (() => {
        const d = new Date()
        d.setHours(d.getHours() + 1, 0, 0, 0)
        return d
      })()
      setTitle('')
      setDescription('')
      setPlatform('')
      setScheduledAt(toDatetimeLocal(base.toISOString()))
      setAssignedModerator('')
      setNotes('')
    }
  }, [open, editing, prefillDate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setSubmitting(true)
    setError(null)
    const iso = new Date(scheduledAt).toISOString()
    try {
      if (editing) {
        await updateContentScheduleItem(editing.id, {
          title: title.trim(),
          description: description.trim() || null,
          platform: (platform || null) as ContentPlatform | null,
          scheduledAt: iso,
          assignedModeratorId: assignedModerator || null,
          notes: notes.trim() || null,
        })
        onSaved({
          ...editing,
          title: title.trim(),
          description: description.trim() || null,
          platform: (platform || null) as ContentPlatform | null,
          scheduledAt: iso,
          assignedModeratorId: assignedModerator || null,
          notes: notes.trim() || null,
        })
      } else {
        const created = await insertContentScheduleItem({
          workspaceId,
          title: title.trim(),
          description: description.trim() || null,
          platform: (platform || null) as ContentPlatform | null,
          scheduledAt: iso,
          assignedModeratorId: assignedModerator || null,
          notes: notes.trim() || null,
        })
        onSaved(created)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save content item.')
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!editing) return
    setSubmitting(true)
    try {
      await deleteContentScheduleItem(editing.id)
      onDeleted(editing.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.')
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Content' : 'Schedule Content'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField label="Title">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly Discord AMA announcement" />
        </FormField>
        <FormField label="Description">
          <textarea className={`${inputClass} min-h-[70px] resize-none`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Platform">
            <select className={inputClass} value={platform} onChange={(e) => setPlatform(e.target.value as ContentPlatform | '')}>
              <option value="">Choose…</option>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </FormField>
          <FormField label="Scheduled at">
            <input type="datetime-local" className={inputClass} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Assigned moderator (optional)">
          <select className={inputClass} value={assignedModerator} onChange={(e) => setAssignedModerator(e.target.value)}>
            <option value="">Unassigned</option>
            {moderators.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
          </select>
        </FormField>
        <FormField label="Notes">
          <textarea className={`${inputClass} min-h-[60px] resize-none`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>

        {error && <span className="text-xs text-red-400">{error}</span>}

        <div className="mt-1 flex justify-between gap-3">
          {editing ? (
            <Button type="button" variant="danger" onClick={handleDelete} disabled={submitting}>
              <Trash2 size={14} /> Delete
            </Button>
          ) : <span />}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={submitting}>{editing ? 'Save' : 'Schedule'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
