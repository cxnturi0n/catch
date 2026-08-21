import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Calendar, ExternalLink } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { FormField, inputClass } from '../../ui/FormControls'
import { Badge } from '../../ui/Badge'
import {
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  insertMeeting,
} from '../../../lib/dbPlatformV2'
import type { Meeting, MeetingProvider, Moderator, WorkspaceId } from '../../../types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function nextRoundHourIso(offsetHours = 1): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + offsetHours)
  return toDatetimeLocal(d.toISOString())
}

/** Pull email-shaped strings out of a moderator's known handles. */
function moderatorEmail(m: Moderator): string | null {
  const candidates = [m.discordHandle, m.telegramHandle, m.externalSource ?? ''].filter(Boolean)
  const hit = candidates.find((c) => EMAIL_RE.test(c))
  return hit ?? null
}

interface Props {
  open: boolean
  onClose: () => void
  workspaceId: WorkspaceId
  moderators: Moderator[]
  onCreated: (m: Meeting) => void
}

export function MeetingFormModal({ open, onClose, workspaceId, moderators, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState(nextRoundHourIso(1))
  const [endsAt, setEndsAt] = useState(nextRoundHourIso(2))
  const [selectedMods, setSelectedMods] = useState<string[]>([])
  const [extraEmails, setExtraEmails] = useState('')
  const [provider, setProvider] = useState<MeetingProvider>('google')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedLink, setSavedLink] = useState<{ url: string; provider: MeetingProvider; missingEmails: string[] } | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setStartsAt(nextRoundHourIso(1))
    setEndsAt(nextRoundHourIso(2))
    setSelectedMods([])
    setExtraEmails('')
    setProvider('google')
    setSubmitting(false)
    setError(null)
    setSavedLink(null)
  }, [open])

  const resolvedAttendees = useMemo(() => {
    const emails: string[] = []
    const missing: string[] = []
    for (const id of selectedMods) {
      const mod = moderators.find((m) => m.id === id)
      if (!mod) continue
      const email = moderatorEmail(mod)
      if (email) emails.push(email)
      else missing.push(mod.fullName)
    }
    const extras = extraEmails
      .split(',')
      .map((s) => s.trim())
      .filter((s) => EMAIL_RE.test(s))
    return { emails: Array.from(new Set([...emails, ...extras])), missing }
  }, [selectedMods, moderators, extraEmails])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError('End time must be after start time.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const startsIso = new Date(startsAt).toISOString()
      const endsIso = new Date(endsAt).toISOString()
      const meeting = await insertMeeting({
        workspaceId,
        title: title.trim(),
        description: description.trim() || null,
        startsAt: startsIso,
        endsAt: endsIso,
        attendeeEmails: resolvedAttendees.emails,
        attendeeModeratorIds: selectedMods,
        provider,
      })
      onCreated(meeting)
      const url =
        provider === 'outlook'
          ? buildOutlookCalendarUrl({
              title: meeting.title,
              description: meeting.description,
              startsAt: startsIso,
              endsAt: endsIso,
              attendeeEmails: resolvedAttendees.emails,
            })
          : buildGoogleCalendarUrl({
              title: meeting.title,
              description: meeting.description,
              startsAt: startsIso,
              endsAt: endsIso,
              attendeeEmails: resolvedAttendees.emails,
            })
      setSavedLink({ url, provider, missingEmails: resolvedAttendees.missing })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save meeting.')
    } finally {
      setSubmitting(false)
    }
  }

  function toggleMod(id: string) {
    setSelectedMods((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <Modal open={open} onClose={onClose} title={savedLink ? 'Meeting Scheduled' : 'New Meeting'}>
      {savedLink ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Saved. Open your calendar to send the invite — {savedLink.provider === 'google' ? 'Google auto-attaches a Meet link on Save' : 'the event will open in Outlook Live'}.
          </p>
          {savedLink.missingEmails.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-amber-200">
              These moderators have no email on file — add them manually in the calendar: {savedLink.missingEmails.join(', ')}
            </div>
          )}
          <a
            href={savedLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="sheen focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:brightness-110"
          >
            <Calendar size={16} />
            Open in {savedLink.provider === 'google' ? 'Google Calendar' : 'Outlook Live'}
            <ExternalLink size={14} />
          </a>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormField label="Title">
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly moderator sync" />
          </FormField>
          <FormField label="Description">
            <textarea
              className={`${inputClass} min-h-[80px] resize-none`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Agenda, links, prep notes…"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Starts">
              <input type="datetime-local" className={inputClass} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </FormField>
            <FormField label="Ends">
              <input type="datetime-local" className={inputClass} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </FormField>
          </div>

          <FormField label={`Attendee moderators (${selectedMods.length} selected)`}>
            <div className="max-h-40 overflow-y-auto rounded-xl border border-[var(--border-card)] bg-[var(--bg-primary)] p-2">
              {moderators.length === 0 ? (
                <p className="p-2 text-xs text-[var(--text-secondary)]">No moderators in this workspace yet.</p>
              ) : (
                moderators.map((m) => {
                  const email = moderatorEmail(m)
                  const checked = selectedMods.includes(m.id)
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-white/[0.04] ${
                        checked ? 'text-white' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={checked} onChange={() => toggleMod(m.id)} className="accent-[var(--accent-emerald)]" />
                        <span>{m.fullName}</span>
                      </span>
                      {email ? (
                        <span className="text-[11px] text-[var(--text-secondary)]">{email}</span>
                      ) : (
                        <Badge tone="yellow" dot={false}>no email</Badge>
                      )}
                    </label>
                  )
                })
              )}
            </div>
          </FormField>

          <FormField label="Extra attendee emails (comma-separated)">
            <input
              className={inputClass}
              value={extraEmails}
              onChange={(e) => setExtraEmails(e.target.value)}
              placeholder="lead@example.com, ops@example.com"
            />
          </FormField>

          <FormField label="Calendar provider">
            <div className="flex gap-2">
              {(['google', 'outlook'] as MeetingProvider[]).map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                    provider === p
                      ? 'border-[var(--accent-emerald)] bg-[var(--accent-emerald)]/10 text-white'
                      : 'border-[var(--border-card)] text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  {p === 'google' ? 'Google Calendar (+ Meet)' : 'Outlook Live'}
                </button>
              ))}
            </div>
          </FormField>

          {error && <span className="text-xs text-red-400">{error}</span>}

          <div className="mt-1 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={submitting}>Schedule</Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
