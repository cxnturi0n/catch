import { api, API_URL, ApiError, isApiError } from './client'
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

// ---- Intelligence report (deterministic, server-built) ----------------------
export type ReportPeriod = '7d' | '30d' | '90d' | 'custom'
export type ReportScope = 'overview' | 'moderation'
export type ReportPlatformFilter = 'discord' | 'telegram'
export interface GenerateReportParams {
  period: ReportPeriod
  start?: string
  end?: string
  scope?: ReportScope
  platform?: ReportPlatformFilter | null
}
export interface ReportMetric { id: string; label: string; value: number | null; prev: number | null; unit: 'count' | 'pct' | 'seconds' | 'hours' | 'usd' | 'ratio'; deltaPct: number | null }
export interface ReportSeries { id: string; label: string; unit: ReportMetric['unit']; points: { t: string; v: number }[] }
export interface ReportTable { id: string; label: string; columns: { key: string; label: string; unit?: ReportMetric['unit'] }[]; rows: Record<string, string | number | null>[] }
export interface ReportInsight { id: string; sectionId: string; severity: 'info' | 'warning' | 'critical' | 'positive'; metricIds: string[]; text: string }
export interface ReportSection {
  id: string
  title: string
  state: 'ok' | 'no_data' | 'not_connected' | 'not_available'
  stateReason: string | null
  metrics: ReportMetric[]
  series: ReportSeries[]
  tables: ReportTable[]
  insights: ReportInsight[]
  note: string
}
export interface ReportRecommendation { id: string; title: string; rationale: string; priority: 'high' | 'medium' | 'low'; metricIds: string[]; insightIds: string[] }
export interface IntelligenceReportDoc {
  version: number
  workspace: { id: string; name: string }
  period: { kind: ReportPeriod; days: number; start: string; end: string; prevStart: string; prevEnd: string }
  scope: ReportScope
  platform: ReportPlatformFilter | null
  generatedAt: string
  coverage: { platforms: { platform: string; status: string; lastSyncAt: string | null; lastError: string | null }[]; daysWithData: number; periodDays: number; moderators: number }
  summary: string[]
  sections: ReportSection[]
  recommendations: ReportRecommendation[]
  methodology: string[]
  narrativeSource: 'rules' | 'llm'
  narrativeMeta: { reason: 'ok' | 'disabled' | 'quota' | 'failed' | 'gated' | 'partial'; llmSlots: number; totalSlots: number; model: string | null }
}
export interface IntelligenceReportListItem { id: string; periodKind: ReportPeriod; periodStart: string; periodEnd: string; narrativeSource: 'rules' | 'llm'; createdAt: string; report: IntelligenceReportDoc }

export function generateIntelligenceReport(workspaceId: WorkspaceId, params: GenerateReportParams) {
  return api<{ id: string; reused: boolean; report: IntelligenceReportDoc }>(`/workspaces/${workspaceId}/ai/report`, { method: 'POST', body: params })
}
export async function fetchIntelligenceReports(workspaceId: WorkspaceId): Promise<IntelligenceReportListItem[]> {
  return (await api<{ reports: IntelligenceReportListItem[] }>(`/workspaces/${workspaceId}/ai/reports`)).reports
}
export function fetchIntelligenceReport(workspaceId: WorkspaceId, id: string) {
  return api<{ id: string; report: IntelligenceReportDoc; createdAt: string }>(`/workspaces/${workspaceId}/ai/reports/${id}`)
}

// ---- Chat over workspace data (SSE) ------------------------------------------
export interface ChatDone { type: 'done'; conversationId: string; messageId: string; content: string; tools: { name: string; ok: boolean }[]; quota: { used: number; limit: number } }
export type ChatStreamEvent = { type: 'status'; text: string } | { type: 'tool'; name: string; ok: boolean } | ChatDone | { type: 'error'; code: string; message: string }

/** Sends one message; resolves with the final answer, calling onEvent for progress. */
export async function sendChatMessage(workspaceId: WorkspaceId, body: { conversationId: string | null; message: string }, onEvent?: (e: ChatStreamEvent) => void, signal?: AbortSignal): Promise<ChatDone> {
  const res = await fetch(`${API_URL}/workspaces/${workspaceId}/ai/chat`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!res.ok || !res.body) {
    let code = 'AI_FAILED'
    let message = 'The assistant is unavailable.'
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } }
      code = j.error?.code ?? code
      message = j.error?.message ?? message
    } catch {
      /* no body */
    }
    throw new ApiError(res.status, code, message)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let done: ChatDone | null = null
  for (;;) {
    const { value, done: end } = await reader.read()
    if (end) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
      if (!data) continue
      let ev: ChatStreamEvent
      try {
        ev = JSON.parse(data) as ChatStreamEvent
      } catch {
        continue
      }
      onEvent?.(ev)
      if (ev.type === 'done') done = ev
      if (ev.type === 'error') throw new ApiError(502, ev.code, ev.message)
    }
  }
  if (!done) throw new ApiError(502, 'AI_FAILED', 'No answer received.')
  return done
}

export interface AiQuota { configured: boolean; model: string; used: number; limit: number; reports: { used: number; limit: number; model: string }; chat: { used: number; limit: number } }
export function fetchAiQuota(workspaceId: WorkspaceId) {
  return api<AiQuota>(`/workspaces/${workspaceId}/ai/quota`)
}
