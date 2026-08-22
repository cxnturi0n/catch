import { api, isApiError } from './client'
import type { FeedbackEntry, KOL, ModerationIncident, NewFeedbackInput, WorkspaceId } from '../../types'
import type { ReportSchedule } from '../reportSchedules'

// ── Report schedule & runs ──────────────────────────────────────────────────

/** Shown in the form when a secret is stored server-side; sending it back keeps the stored value. */
export const SECRET_KEPT = '••••••••'

interface ApiSchedule {
  reportType: ReportSchedule['reportType']
  cadence: ReportSchedule['cadence']
  weekday: number
  time: string
  timezone: string
  recipientEmails: string[]
  enabled: boolean
  hasSlackWebhook: boolean
  hasNotionToken: boolean
  notionPageId: string | null
}

const rep = (ws: WorkspaceId) => `/workspaces/${ws}/reports`

function toSchedule(s: ApiSchedule): ReportSchedule {
  return {
    reportType: s.reportType,
    cadence: s.cadence,
    weekday: s.weekday,
    time: s.time,
    timezone: s.timezone,
    email: s.recipientEmails[0] ?? '',
    enabled: s.enabled,
    slackWebhookUrl: s.hasSlackWebhook ? SECRET_KEPT : '',
    notionToken: s.hasNotionToken ? SECRET_KEPT : '',
    notionPageId: s.notionPageId ?? '',
  }
}

export async function fetchReportSchedule(workspaceId: WorkspaceId): Promise<ReportSchedule | null> {
  const r = await api<{ schedule: ApiSchedule | null }>(`${rep(workspaceId)}/schedule`)
  return r.schedule ? toSchedule(r.schedule) : null
}

export async function upsertReportSchedule(workspaceId: WorkspaceId, s: ReportSchedule): Promise<void> {
  const secret = (v: string) => (v === SECRET_KEPT ? undefined : v.trim() || null)
  await api(`${rep(workspaceId)}/schedule`, {
    method: 'PUT',
    body: {
      reportType: s.reportType,
      cadence: s.cadence,
      weekday: s.weekday,
      time: s.time,
      timezone: s.timezone,
      recipientEmails: s.email.trim() ? [s.email.trim()] : [],
      enabled: s.enabled,
      slackWebhookUrl: secret(s.slackWebhookUrl ?? ''),
      notionToken: secret(s.notionToken ?? ''),
      notionPageId: s.notionPageId?.trim() || null,
    },
  })
}

export function sendReportNow(workspaceId: WorkspaceId) {
  return api<{ email: number; slack: boolean | null; notion: boolean | null; errors: string[] }>(`${rep(workspaceId)}/schedule/send-now`, { method: 'POST' })
}

export interface ReportRun<T = Record<string, unknown>> {
  id: string
  reportType: string
  periodStart: string
  periodEnd: string
  data: T
  createdAt: string
}

export async function fetchReportRuns<T = Record<string, unknown>>(workspaceId: WorkspaceId): Promise<ReportRun<T>[]> {
  return (await api<{ runs: ReportRun<T>[] }>(`${rep(workspaceId)}/runs`)).runs
}

export async function saveReportRun<T extends Record<string, unknown>>(workspaceId: WorkspaceId, run: { reportType: string; periodStart: string; periodEnd: string; data: T }): Promise<ReportRun<T>> {
  return (await api<{ run: ReportRun<T> }>(`${rep(workspaceId)}/runs`, { method: 'POST', body: run })).run
}

// ── Feedback (CatchLab) ─────────────────────────────────────────────────────

export async function submitFeedback(_userId: string, input: NewFeedbackInput): Promise<void> {
  await api('/feedback', { method: 'POST', body: input })
}
export async function fetchRoadmapFeedback(): Promise<FeedbackEntry[]> {
  return (await api<{ items: FeedbackEntry[] }>('/feedback/roadmap')).items
}
export async function fetchAllFeedback(): Promise<FeedbackEntry[]> {
  try {
    return (await api<{ items: FeedbackEntry[] }>('/admin/feedback')).items
  } catch (err) {
    if (isApiError(err) && err.status === 404) return []
    throw err
  }
}
export async function updateFeedbackStatus(id: string, status: FeedbackEntry['status']): Promise<void> {
  await api(`/admin/feedback/${id}`, { method: 'PATCH', body: { status } })
}

// ── Discovery (public) ──────────────────────────────────────────────────────

export interface DiscoveryFormRow {
  id: string
  slug: string
  contact_name: string | null
  contact_email: string | null
  source: string | null
  is_active: boolean
}
export type FetchFormResult = { status: 'ok'; form: DiscoveryFormRow } | { status: 'not_found' } | { status: 'unconfigured' } | { status: 'error'; error: string }

export async function fetchDiscoveryForm(slug: string): Promise<FetchFormResult> {
  try {
    const r = await api<{ form: { id: string; slug: string; contactName: string | null; source: string | null; isActive: boolean } }>(`/public/discovery/${encodeURIComponent(slug)}`)
    return { status: 'ok', form: { id: r.form.id, slug: r.form.slug, contact_name: r.form.contactName, contact_email: null, source: r.form.source, is_active: r.form.isActive } }
  } catch (err) {
    if (isApiError(err) && (err.status === 404 || err.status === 400)) return { status: 'not_found' }
    return { status: 'error', error: err instanceof Error ? err.message : 'Failed to load form' }
  }
}

export interface DiscoveryResponseRow {
  id: string
  form_id: string | null
  slug_snapshot: string | null
  respondent_name: string | null
  respondent_email: string | null
  respondent_role: string | null
  answers: Record<string, string>
  submitted_at: string
  completion_ms: number | null
}
export type FetchResponsesResult = { status: 'ok'; rows: DiscoveryResponseRow[] } | { status: 'unconfigured' } | { status: 'error'; error: string }

export async function fetchAllDiscoveryResponses(): Promise<FetchResponsesResult> {
  try {
    const r = await api<{ rows: Array<{ id: string; formId: string | null; slugSnapshot: string | null; respondentName: string | null; respondentEmail: string | null; respondentRole: string | null; answers: Record<string, string>; submittedAt: string; completionMs: number | null }> }>('/admin/discovery/responses')
    return { status: 'ok', rows: r.rows.map((x) => ({ id: x.id, form_id: x.formId, slug_snapshot: x.slugSnapshot, respondent_name: x.respondentName, respondent_email: x.respondentEmail, respondent_role: x.respondentRole, answers: x.answers, submitted_at: x.submittedAt, completion_ms: x.completionMs })) }
  } catch (err) {
    if (isApiError(err) && err.status === 404) return { status: 'ok', rows: [] }
    return { status: 'error', error: err instanceof Error ? err.message : 'Failed to load responses' }
  }
}

export interface SubmitResponseInput {
  formId: string | null
  slugSnapshot: string
  respondentName: string | null
  respondentEmail: string | null
  respondentRole: string | null
  answers: Record<string, string>
  userAgent: string | null
  completionMs: number | null
}

export async function submitDiscoveryResponse(input: SubmitResponseInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const attempt = () =>
    api(`/public/discovery/${encodeURIComponent(input.slugSnapshot)}/responses`, {
      method: 'POST',
      body: { respondentName: input.respondentName, respondentEmail: input.respondentEmail || null, respondentRole: input.respondentRole, answers: input.answers, completionMs: input.completionMs },
    })
  try {
    await attempt()
    return { ok: true }
  } catch (err) {
    // One retry for transient network failures only; validation errors are final.
    if (isApiError(err) && err.status < 500) return { ok: false, error: err.message }
    await new Promise((r) => setTimeout(r, 800))
    try {
      await attempt()
      return { ok: true }
    } catch (err2) {
      return { ok: false, error: err2 instanceof Error ? err2.message : 'Submission failed' }
    }
  }
}

// ── Incidents & KOLs ────────────────────────────────────────────────────────

interface ApiIncident {
  id: string
  date: string
  type: string
  channel: string
  actionTaken: string | null
  status: string
}
const mapIncident = (i: ApiIncident): ModerationIncident => ({ id: i.id, date: i.date, type: i.type as ModerationIncident['type'], channel: i.channel as ModerationIncident['channel'], actionTaken: i.actionTaken ?? '', status: i.status as ModerationIncident['status'] })

export async function fetchIncidents(workspaceId: WorkspaceId): Promise<ModerationIncident[]> {
  return (await api<{ incidents: ApiIncident[] }>(`/workspaces/${workspaceId}/incidents`)).incidents.map(mapIncident)
}
export async function addIncident(workspaceId: WorkspaceId, data: Omit<ModerationIncident, 'id'>): Promise<ModerationIncident> {
  return mapIncident((await api<{ incident: ApiIncident }>(`/workspaces/${workspaceId}/incidents`, { method: 'POST', body: { date: data.date || undefined, type: data.type, channel: data.channel, actionTaken: data.actionTaken || null, status: data.status } })).incident)
}
export async function seedIncidents(workspaceId: WorkspaceId, rows: ModerationIncident[]): Promise<ModerationIncident[]> {
  const out: ModerationIncident[] = []
  for (const r of rows) out.push(await addIncident(workspaceId, r))
  return out
}

interface ApiKol {
  id: string
  name: string
  handle: string | null
  channel: string | null
  reach: number
  status: string
  lastActivity: string | null
  notes: string | null
}
const mapKol = (k: ApiKol): KOL => ({ id: k.id, name: k.name, handle: k.handle ?? '', channel: (k.channel ?? 'Twitter') as KOL['channel'], reach: k.reach, status: k.status as KOL['status'], lastActivity: k.lastActivity ?? '', notes: k.notes ?? '' })

export async function fetchKOLs(workspaceId: WorkspaceId): Promise<KOL[]> {
  return (await api<{ kols: ApiKol[] }>(`/workspaces/${workspaceId}/kols`)).kols.map(mapKol)
}
export async function addKOL(workspaceId: WorkspaceId, data: Omit<KOL, 'id'>): Promise<KOL> {
  return mapKol((await api<{ kol: ApiKol }>(`/workspaces/${workspaceId}/kols`, { method: 'POST', body: { name: data.name, handle: data.handle || null, channel: data.channel, reach: data.reach, status: data.status, lastActivity: data.lastActivity || null, notes: data.notes || null } })).kol)
}
export async function seedKOLs(workspaceId: WorkspaceId, rows: KOL[]): Promise<KOL[]> {
  const out: KOL[] = []
  for (const r of rows) out.push(await addKOL(workspaceId, r))
  return out
}

// ── AI status update ────────────────────────────────────────────────────────

export interface AiStatusUpdateResult {
  ok: boolean
  update?: { headline: string; body: string; watch: string[] }
  model?: string
  error?: string
}
export async function requestStatusUpdate(workspaceId: WorkspaceId, snapshot: unknown, lang: string): Promise<AiStatusUpdateResult> {
  try {
    return await api<AiStatusUpdateResult>(`/workspaces/${workspaceId}/ai/status-update`, { method: 'POST', body: { snapshot, lang: lang === 'pt' ? 'pt' : 'en' } })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'AI unavailable' }
  }
}

// ── Admin analytics ─────────────────────────────────────────────────────────

export async function fetchAdminOverview<T>(): Promise<{ status: 'ok'; data: T } | { status: 'forbidden' } | { status: 'error'; error: string }> {
  try {
    return { status: 'ok', data: await api<T>('/admin/overview') }
  } catch (err) {
    if (isApiError(err) && (err.status === 404 || err.status === 403)) return { status: 'forbidden' }
    return { status: 'error', error: err instanceof Error ? err.message : 'Failed' }
  }
}
