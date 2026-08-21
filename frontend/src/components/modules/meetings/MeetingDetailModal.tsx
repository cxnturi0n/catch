import { Calendar, ExternalLink, Trash2, Users } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Badge } from '../../ui/Badge'
import { buildGoogleCalendarUrl, buildOutlookCalendarUrl } from '../../../lib/dbPlatformV2'
import { useTimezone } from '../../../context/TimezoneContext'
import { formatInTz, formatTimeInTz } from '../../../lib/formatTime'
import { dateKeyInTz } from '../../../lib/formatTime'
import { zoneShortOffset } from '../../../lib/timezones'
import type { Meeting } from '../../../types'

function fmtRange(a: string, b: string, tz: string): string {
  const dateFmt: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
  const off = zoneShortOffset(tz, new Date(a))
  const sameDay = dateKeyInTz(a, tz) === dateKeyInTz(b, tz)
  if (sameDay) return `${formatInTz(a, tz, dateFmt)} · ${formatTimeInTz(a, tz)} → ${formatTimeInTz(b, tz)} ${off}`
  return `${formatInTz(a, tz, dateFmt)} ${formatTimeInTz(a, tz)} → ${formatInTz(b, tz, dateFmt)} ${formatTimeInTz(b, tz)} ${off}`
}

interface Props {
  meeting: Meeting | null
  onClose: () => void
  onDelete: (id: string) => void
}

export function MeetingDetailModal({ meeting, onClose, onDelete }: Props) {
  const { timezone } = useTimezone()
  if (!meeting) return null
  const url =
    meeting.provider === 'outlook'
      ? buildOutlookCalendarUrl({
          title: meeting.title,
          description: meeting.description,
          startsAt: meeting.startsAt,
          endsAt: meeting.endsAt,
          attendeeEmails: meeting.attendeeEmails,
        })
      : buildGoogleCalendarUrl({
          title: meeting.title,
          description: meeting.description,
          startsAt: meeting.startsAt,
          endsAt: meeting.endsAt,
          attendeeEmails: meeting.attendeeEmails,
        })

  return (
    <Modal open={!!meeting} onClose={onClose} title={meeting.title}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Calendar size={14} />
          {fmtRange(meeting.startsAt, meeting.endsAt, timezone)}
        </div>

        {meeting.description && (
          <p className="rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-3 text-sm text-slate-300">
            {meeting.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={meeting.provider === 'google' ? 'cyan' : 'indigo'} dot={false}>
            {meeting.provider === 'google' ? 'Google Calendar' : meeting.provider === 'outlook' ? 'Outlook Live' : 'Other'}
          </Badge>
          <span className="flex items-center gap-1 text-[var(--text-secondary)]">
            <Users size={13} />
            {meeting.attendeeEmails.length + meeting.attendeeModeratorIds.length} attendees
          </span>
        </div>

        {meeting.attendeeEmails.length > 0 && (
          <div className="text-xs text-[var(--text-secondary)]">
            <div className="mb-1 text-slate-300">Emails</div>
            <div className="flex flex-wrap gap-1.5">
              {meeting.attendeeEmails.map((e) => (
                <span key={e} className="rounded-md border border-[var(--border-card)] bg-white/[0.03] px-2 py-0.5">{e}</span>
              ))}
            </div>
          </div>
        )}

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="sheen focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:brightness-110"
        >
          <Calendar size={16} />
          Open in {meeting.provider === 'google' ? 'Google Calendar' : 'Outlook Live'}
          <ExternalLink size={14} />
        </a>

        <div className="mt-1 flex justify-between gap-3">
          <Button variant="danger" onClick={() => onDelete(meeting.id)}>
            <Trash2 size={14} /> Delete
          </Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}
