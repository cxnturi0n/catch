// Barrel for the "platform v2" modules (moderator profile, compensation
// configs, resources, content schedule, meetings) plus the calendar deep-link
// helpers. Data access lives in lib/api/*.
export {
  updateModeratorProfile,
  uploadModeratorCv,
  getCvSignedUrl,
  deleteModeratorCv,
  fetchResponseMetrics,
  fetchShiftEvents,
  fetchCompensationConfigs,
  upsertCompensationConfig,
  applyCompensationConfigToAll,
  type ModeratorProfileUpdate,
  type CompConfigUpsert,
} from './api/moderators'
export {
  fetchContentSchedule,
  insertContentScheduleItem,
  updateContentScheduleItem,
  deleteContentScheduleItem,
  fetchMeetings,
  insertMeeting,
  deleteMeeting,
  type NewContentInput,
  type NewMeetingInput,
} from './api/operations'
export { fetchResources, fetchResourcesWithStats, deleteResource, getResourceSignedUrl, logResourceView } from './api/resources'

/**
 * Build a Google Calendar deep-link that pre-fills a new event; if the user
 * has Google Meet enabled by default (workspaces do), Google auto-attaches a
 * Meet link when they hit Save. No OAuth, no API call.
 * Docs: https://calendar.google.com/calendar/render?action=TEMPLATE
 */
export function buildGoogleCalendarUrl(m: {
  title: string
  description?: string | null
  startsAt: string
  endsAt: string
  attendeeEmails?: string[]
  meetLink?: string | null
}): string {
  const fmt = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: m.title,
    dates: `${fmt(m.startsAt)}/${fmt(m.endsAt)}`,
  })
  const desc = [m.description ?? '', m.meetLink ? `\nMeet: ${m.meetLink}` : ''].filter(Boolean).join('')
  if (desc) params.set('details', desc)
  if (m.attendeeEmails && m.attendeeEmails.length) params.set('add', m.attendeeEmails.join(','))
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** Outlook Live web deep-link, same shape, different host. */
export function buildOutlookCalendarUrl(m: {
  title: string
  description?: string | null
  startsAt: string
  endsAt: string
  attendeeEmails?: string[]
}): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: m.title,
    startdt: m.startsAt,
    enddt: m.endsAt,
    body: m.description ?? '',
  })
  if (m.attendeeEmails && m.attendeeEmails.length) params.set('to', m.attendeeEmails.join(','))
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}
