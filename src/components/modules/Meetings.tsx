import { useEffect, useState } from 'react'
import { Calendar, Loader2, Plus, Users, Video } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useTimezone } from '../../context/TimezoneContext'
import { deleteMeeting, fetchMeetings } from '../../lib/dbPlatformV2'
import { fetchModerators } from '../../lib/db'
import { formatInTz } from '../../lib/formatTime'
import { zoneShortOffset } from '../../lib/timezones'
import type { Meeting, Moderator } from '../../types'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Card'
import { MeetingFormModal } from './meetings/MeetingFormModal'
import { MeetingDetailModal } from './meetings/MeetingDetailModal'

function formatWhen(iso: string, tz: string): string {
  return `${formatInTz(iso, tz, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })} ${zoneShortOffset(tz, new Date(iso))}`
}

export function Meetings() {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { timezone } = useTimezone()

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [moderators, setModerators] = useState<Moderator[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [detail, setDetail] = useState<Meeting | null>(null)

  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    setLoading(true)
    async function load() {
      try {
        if (!user) {
          if (!cancelled) {
            setMeetings([])
            setModerators([])
          }
          return
        }
        const [m, mods] = await Promise.all([
          fetchMeetings(activeWorkspaceId, 60).catch(() => [] as Meeting[]),
          fetchModerators(activeWorkspaceId).catch(() => [] as Moderator[]),
        ])
        if (!cancelled) {
          setMeetings(m)
          setModerators(mods)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [activeWorkspaceId, user])

  async function handleDelete(id: string) {
    const prev = meetings
    setMeetings((list) => list.filter((m) => m.id !== id))
    setDetail(null)
    try {
      await deleteMeeting(id)
      showToast('Meeting deleted.', 'success')
    } catch {
      setMeetings(prev)
      showToast('Failed to delete meeting.', 'error')
    }
  }

  const isGuest = !user

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Meetings</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Schedule meetings with moderators. We generate a calendar deep-link; Meet auto-attaches on Save.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} disabled={isGuest}>
          <Plus size={16} /> New Meeting
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border-card)] py-16 text-sm text-[var(--text-secondary)]">
          <Loader2 size={18} className="animate-spin" /> Loading meetings…
        </div>
      ) : isGuest ? (
        <EmptyState
          icon={<Calendar size={22} />}
          title="Sign in to schedule meetings"
          description="Guests can browse the workspace, but scheduling and persistence require a signed-in account."
        />
      ) : meetings.length === 0 ? (
        <EmptyState
          icon={<Video size={22} />}
          title="No meetings scheduled yet"
          description="Kick off your first sync with the mod team. We'll open your calendar with everything pre-filled."
          action={<Button onClick={() => setFormOpen(true)}><Plus size={14} /> New Meeting</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {meetings.map((m) => (
            <button
              key={m.id}
              onClick={() => setDetail(m)}
              className="glass group flex flex-col gap-3 rounded-2xl p-4 text-left transition-all hover:border-[var(--accent-emerald)]/40 hover:shadow-[var(--glow-soft)]"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-white line-clamp-2">{m.title}</h3>
                <Badge tone={m.provider === 'google' ? 'cyan' : m.provider === 'outlook' ? 'indigo' : 'gray'} dot={false}>
                  {m.provider}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <Calendar size={13} /> {formatWhen(m.startsAt, timezone)}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <Users size={13} /> {m.attendeeEmails.length + m.attendeeModeratorIds.length} attendees
              </div>
              {m.description && (
                <p className="line-clamp-2 text-xs text-slate-400">{m.description}</p>
              )}
            </button>
          ))}
        </div>
      )}

      <MeetingFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        workspaceId={activeWorkspaceId}
        moderators={moderators}
        onCreated={(m) => setMeetings((prev) => [...prev, m].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))}
      />

      <MeetingDetailModal meeting={detail} onClose={() => setDetail(null)} onDelete={handleDelete} />
    </div>
  )
}
