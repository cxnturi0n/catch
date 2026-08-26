import { api, API_URL } from './client'
import { initials as initialsOf } from '../../data/moderatorsData'
import type {
  CompensationConfig,
  CompCurrency,
  CompensationKind,
  ConversionConfig,
  FixedPeriod,
  Moderator,
  ModeratorMetricValue,
  ModeratorResponseMetric,
  ModeratorShiftEvent,
  NewPaymentInput,
  Payment,
  PointsMetric,
  Warning,
  WorkspaceId,
} from '../../types'

// ── Moderators ──────────────────────────────────────────────────────────────

interface ApiModerator {
  id: string
  fullName: string
  discordHandle: string | null
  telegramHandle: string | null
  discordUserId?: string | null
  telegramUserId?: string | null
  platforms: string[]
  startDate: string | null
  contractType: string
  timezone: string | null
  country: string | null
  status: string
  notes: string | null
  warnings: Warning[]
  bio: string | null
  skills: string[]
  languages: string[]
  platformsKnown: string[]
  externalSource: string | null
  profilePhotoUrl: string | null
  cvFilename: string | null
  hasCv: boolean
  cvExtractedText: string | null
  shiftStartUtc: number | null
  shiftEndUtc: number | null
  shiftDays: number[]
  createdAt: string
  updatedAt: string
}

// Legacy preset shifts ↔ UTC hours. New code should use shiftStartUtc/EndUtc.
const SHIFT_PRESETS: Array<[Moderator['shift'], number, number]> = [
  ['Morning (06-14)', 6, 14],
  ['Afternoon (14-22)', 14, 22],
  ['Night (22-06)', 22, 6],
]
function shiftLabel(start: number | null): Moderator['shift'] {
  return SHIFT_PRESETS.find(([, s]) => s === start)?.[0] ?? 'Morning (06-14)'
}

function mapModerator(m: ApiModerator): Moderator {
  return {
    id: m.id,
    fullName: m.fullName,
    discordHandle: m.discordHandle ?? '',
    telegramHandle: m.telegramHandle ?? '',
    discordUserId: m.discordUserId ?? undefined,
    telegramUserId: m.telegramUserId ?? undefined,
    avatarInitials: initialsOf(m.fullName),
    startDate: m.startDate ?? m.createdAt.slice(0, 10),
    contractType: m.contractType as Moderator['contractType'],
    timezone: m.timezone ?? '',
    country: m.country ?? undefined,
    shift: shiftLabel(m.shiftStartUtc),
    platforms: m.platforms as Moderator['platforms'],
    status: m.status as Moderator['status'],
    // Filled by fetchModerators from measured activity, moderation actions
    // (Discord audit log, Telegram admin actions) and response metrics.
    messagesThisMonth: 0,
    bansExecuted: 0,
    timeoutsGiven: 0,
    avgResponseTime: 'n/a',
    lastActiveDate: m.updatedAt.slice(0, 10),
    shiftsCompleted: 0,
    shiftsAssigned: 0,
    warnings: m.warnings ?? [],
    notes: m.notes ?? '',
    rating: 5,
    bio: m.bio ?? undefined,
    skills: m.skills,
    languages: m.languages,
    platformsKnown: m.platformsKnown,
    externalSource: m.externalSource ?? undefined,
    profilePhotoUrl: m.profilePhotoUrl ?? undefined,
    cvStoragePath: m.hasCv ? m.id : undefined,
    cvFilename: m.cvFilename ?? undefined,
    cvExtractedText: m.cvExtractedText ?? undefined,
    shiftStartUtc: m.shiftStartUtc ?? undefined,
    shiftEndUtc: m.shiftEndUtc ?? undefined,
    shiftDays: m.shiftDays,
  }
}

type ModeratorInput = Omit<Moderator, 'id' | 'avatarInitials'>

function toBody(m: Partial<ModeratorInput>) {
  const preset = m.shift ? SHIFT_PRESETS.find(([label]) => label === m.shift) : undefined
  return {
    ...(m.fullName !== undefined && { fullName: m.fullName }),
    ...(m.discordHandle !== undefined && { discordHandle: m.discordHandle || null }),
    ...(m.telegramHandle !== undefined && { telegramHandle: m.telegramHandle || null }),
    ...(m.discordUserId !== undefined && { discordUserId: m.discordUserId || null }),
    ...(m.telegramUserId !== undefined && { telegramUserId: m.telegramUserId || null }),
    ...(m.platforms !== undefined && { platforms: m.platforms }),
    ...(m.startDate !== undefined && { startDate: m.startDate || null }),
    ...(m.contractType !== undefined && { contractType: m.contractType }),
    ...(m.timezone !== undefined && { timezone: m.timezone || null }),
    ...(m.country !== undefined && { country: m.country || null }),
    ...(m.status !== undefined && { status: m.status }),
    ...(m.notes !== undefined && { notes: m.notes || null }),
    ...(m.warnings !== undefined && { warnings: m.warnings }),
    ...(m.bio !== undefined && { bio: m.bio }),
    ...(m.skills !== undefined && { skills: m.skills }),
    ...(m.languages !== undefined && { languages: m.languages }),
    ...(m.platformsKnown !== undefined && { platformsKnown: m.platformsKnown }),
    ...(m.externalSource !== undefined && { externalSource: m.externalSource }),
    ...(m.profilePhotoUrl !== undefined && { profilePhotoUrl: m.profilePhotoUrl || null }),
    ...(m.shiftDays !== undefined && { shiftDays: m.shiftDays }),
    shiftStartUtc: m.shiftStartUtc ?? preset?.[1] ?? undefined,
    shiftEndUtc: m.shiftEndUtc ?? preset?.[2] ?? undefined,
  }
}

const base = (ws: WorkspaceId) => `/workspaces/${ws}/moderators`

interface PerformanceRow {
  moderatorId: string
  messages: number
  activeDays: number
  lastActiveAt: string | null
  platforms: string[]
}
interface ShiftEventRow {
  moderatorId: string
  day: string
  wasOnTime: boolean | null
  firstActivityUtc: string | null
}

interface ActionsByModerator {
  moderatorId: string
  bans: number
  unbans: number
  kicks: number
  timeouts: number
  untimeouts: number
  deletes: number
  mutes: number
  unmutes: number
}
interface ResponseMetricRow {
  moderatorId: string
  platform: string
  day: string
  responsesCount: number
  avgResponseSeconds: number | null
}

function formatResponse(rows: ResponseMetricRow[]): string {
  const n = rows.reduce((s, r) => s + r.responsesCount, 0)
  if (n === 0) return 'n/a'
  const total = rows.reduce((s, r) => s + r.responsesCount * (r.avgResponseSeconds ?? 0), 0)
  const minutes = total / n / 60
  return minutes < 1 ? `${Math.round(minutes * 60)} s` : `${minutes.toFixed(1)} min`
}

// Roster + measured activity (30 days) + punctuality (30 days) + moderation
// actions + response times, merged. The counters stay 0 / 'n/a' when no
// platform user id or handle matches.
export async function fetchModerators(workspaceId: WorkspaceId): Promise<Moderator[]> {
  const [list, perf, shifts, actions, responses] = await Promise.all([
    api<{ moderators: ApiModerator[] }>(base(workspaceId)),
    api<{ rows: PerformanceRow[] }>(`${base(workspaceId)}/performance?sinceDays=30`).catch(() => ({ rows: [] as PerformanceRow[] })),
    api<{ events: ShiftEventRow[] }>(`${base(workspaceId)}/shift-events?sinceDays=30`).catch(() => ({ events: [] as ShiftEventRow[] })),
    api<{ byModerator: ActionsByModerator[] }>(`${base(workspaceId)}/actions?sinceDays=30`).catch(() => ({ byModerator: [] as ActionsByModerator[] })),
    api<{ metrics: ResponseMetricRow[] }>(`${base(workspaceId)}/response-metrics?sinceDays=30`).catch(() => ({ metrics: [] as ResponseMetricRow[] })),
  ])
  const perfBy = new Map(perf.rows.map((r) => [r.moderatorId, r]))
  const actionsBy = new Map(actions.byModerator.map((a) => [a.moderatorId, a]))
  const responsesBy = new Map<string, ResponseMetricRow[]>()
  for (const r of responses.metrics) responsesBy.set(r.moderatorId, [...(responsesBy.get(r.moderatorId) ?? []), r])
  const shiftBy = new Map<string, { assigned: number; completed: number }>()
  for (const e of shifts.events) {
    const s = shiftBy.get(e.moderatorId) ?? { assigned: 0, completed: 0 }
    s.assigned++
    if (e.firstActivityUtc) s.completed++
    shiftBy.set(e.moderatorId, s)
  }
  return list.moderators.map((m) => {
    const p = perfBy.get(m.id)
    const sh = shiftBy.get(m.id)
    const ac = actionsBy.get(m.id)
    const mapped = mapModerator(m)
    return {
      ...mapped,
      messagesThisMonth: p?.messages ?? 0,
      bansExecuted: (ac?.bans ?? 0) + (ac?.kicks ?? 0),
      timeoutsGiven: (ac?.timeouts ?? 0) + (ac?.mutes ?? 0),
      avgResponseTime: formatResponse(responsesBy.get(m.id) ?? []),
      lastActiveDate: p?.lastActiveAt ? p.lastActiveAt.slice(0, 10) : mapped.lastActiveDate,
      shiftsAssigned: sh?.assigned ?? 0,
      shiftsCompleted: sh?.completed ?? 0,
    }
  })
}

export async function addModerator(workspaceId: WorkspaceId, data: ModeratorInput): Promise<Moderator> {
  return mapModerator(await api<ApiModerator>(base(workspaceId), { method: 'POST', body: toBody(data) }))
}

export async function updateModerator(id: string, workspaceId: WorkspaceId, data: Partial<ModeratorInput>): Promise<Moderator> {
  return mapModerator(await api<ApiModerator>(`${base(workspaceId)}/${id}`, { method: 'PATCH', body: toBody(data) }))
}

export async function addModeratorWarning(workspaceId: WorkspaceId, id: string, warnings: Warning[]): Promise<void> {
  await api(`${base(workspaceId)}/${id}`, { method: 'PATCH', body: { warnings } })
}

export async function removeModerator(workspaceId: WorkspaceId, id: string): Promise<void> {
  await api(`${base(workspaceId)}/${id}`, { method: 'DELETE' })
}

/** Creates several moderators (used only by demo seeding paths). */
export async function seedModerators(workspaceId: WorkspaceId, moderators: Moderator[]): Promise<Moderator[]> {
  const out: Moderator[] = []
  for (const m of moderators) out.push(await addModerator(workspaceId, m))
  return out
}

export interface ModeratorProfileUpdate {
  bio?: string | null
  skills?: string[]
  languages?: string[]
  platformsKnown?: string[]
  externalSource?: string | null
  profilePhotoUrl?: string | null
  shiftStartUtc?: number | null
  shiftEndUtc?: number | null
  shiftDays?: number[]
}

export async function updateModeratorProfile(workspaceId: WorkspaceId, id: string, update: ModeratorProfileUpdate): Promise<void> {
  if (Object.keys(update).length === 0) return
  await api(`${base(workspaceId)}/${id}`, { method: 'PATCH', body: update })
}

// ── CV ──────────────────────────────────────────────────────────────────────

export async function uploadModeratorCv(workspaceId: WorkspaceId, moderatorId: string, file: File, extractedText?: string): Promise<Moderator> {
  const form = new FormData()
  if (extractedText) form.append('extractedText', extractedText)
  form.append('file', file, file.name)
  const res = await fetch(`${API_URL}${base(workspaceId)}/${moderatorId}/cv`, { method: 'POST', credentials: 'include', body: form })
  const data = (await res.json().catch(() => null)) as ApiModerator | { error?: { message?: string } } | null
  if (!res.ok) throw new Error((data as { error?: { message?: string } } | null)?.error?.message ?? 'Upload failed')
  return mapModerator(data as ApiModerator)
}

export async function getCvSignedUrl(workspaceId: WorkspaceId, moderatorId: string): Promise<string> {
  const r = await api<{ url: string }>(`${base(workspaceId)}/${moderatorId}/cv`)
  return r.url
}

export async function deleteModeratorCv(workspaceId: WorkspaceId, moderatorId: string): Promise<Moderator> {
  return mapModerator(await api<ApiModerator>(`${base(workspaceId)}/${moderatorId}/cv`, { method: 'DELETE' }))
}

// ── Performance data ────────────────────────────────────────────────────────

export async function fetchShiftEvents(workspaceId: WorkspaceId, sinceDays = 30, moderatorId?: string): Promise<ModeratorShiftEvent[]> {
  const q = new URLSearchParams({ sinceDays: String(sinceDays), ...(moderatorId && { moderatorId }) })
  const r = await api<{ events: ModeratorShiftEvent[] }>(`${base(workspaceId)}/shift-events?${q}`)
  return r.events
}

export async function fetchResponseMetrics(workspaceId: WorkspaceId, sinceDays = 30, moderatorId?: string): Promise<ModeratorResponseMetric[]> {
  const q = new URLSearchParams({ sinceDays: String(sinceDays), ...(moderatorId && { moderatorId }) })
  const r = await api<{ metrics: ModeratorResponseMetric[] }>(`${base(workspaceId)}/response-metrics?${q}`)
  return r.metrics
}

// ── Compensation ────────────────────────────────────────────────────────────

const comp = (ws: WorkspaceId) => `/workspaces/${ws}/compensation`

export interface PointsMetricInput {
  metricKey: string
  label: string
  points: number
}

export async function fetchPointsConfig(workspaceId: WorkspaceId): Promise<PointsMetric[]> {
  return (await api<{ metrics: PointsMetric[] }>(`${comp(workspaceId)}/points`)).metrics
}

export async function seedPointsConfig(workspaceId: WorkspaceId, metrics: PointsMetricInput[]): Promise<PointsMetric[]> {
  if (metrics.length === 0) return []
  return (await api<{ metrics: PointsMetric[] }>(`${comp(workspaceId)}/points`, { method: 'PUT', body: { metrics } })).metrics
}

export async function upsertPointsMetric(workspaceId: WorkspaceId, metric: PointsMetricInput): Promise<PointsMetric> {
  const r = await api<{ metrics: PointsMetric[] }>(`${comp(workspaceId)}/points`, { method: 'PUT', body: { metrics: [metric] } })
  return r.metrics[0]
}

export async function deletePointsMetric(workspaceId: WorkspaceId, id: string): Promise<void> {
  await api(`${comp(workspaceId)}/points/${id}`, { method: 'DELETE' })
}

export async function fetchConversionConfig(workspaceId: WorkspaceId): Promise<ConversionConfig | null> {
  return (await api<{ conversion: ConversionConfig | null }>(`${comp(workspaceId)}/conversion`)).conversion
}

export async function upsertConversionConfig(workspaceId: WorkspaceId, config: ConversionConfig): Promise<ConversionConfig> {
  return (await api<{ conversion: ConversionConfig }>(`${comp(workspaceId)}/conversion`, { method: 'PUT', body: config })).conversion
}

export async function fetchModeratorMetrics(workspaceId: WorkspaceId, period = 'current'): Promise<ModeratorMetricValue[]> {
  return (await api<{ metrics: ModeratorMetricValue[] }>(`${comp(workspaceId)}/metrics?period=${encodeURIComponent(period)}`)).metrics
}

export async function upsertModeratorMetric(workspaceId: WorkspaceId, moderatorId: string, metricKey: string, value: number, period = 'current'): Promise<void> {
  await api(`${comp(workspaceId)}/metrics`, { method: 'PUT', body: { moderatorId, metricKey, value, period } })
}

export async function fetchCompensationConfigs(workspaceId: WorkspaceId): Promise<CompensationConfig[]> {
  return (await api<{ configs: CompensationConfig[] }>(`${comp(workspaceId)}/configs`)).configs
}

export interface CompConfigUpsert {
  moderatorId: string
  workspaceId: WorkspaceId
  kind: CompensationKind
  fixedAmount?: number | null
  fixedCurrency?: CompCurrency | null
  fixedPeriod?: FixedPeriod | null
  variableNotes?: string | null
}

export async function upsertCompensationConfig(input: CompConfigUpsert): Promise<CompensationConfig> {
  const { moderatorId, workspaceId, ...body } = input
  return (await api<{ config: CompensationConfig }>(`${comp(workspaceId)}/configs/${moderatorId}`, { method: 'PUT', body })).config
}

export async function applyCompensationConfigToAll(
  workspaceId: WorkspaceId,
  moderatorIds: string[],
  base: Omit<CompConfigUpsert, 'moderatorId' | 'workspaceId'>,
): Promise<void> {
  if (moderatorIds.length === 0) return
  await api(`${comp(workspaceId)}/configs/apply-all`, { method: 'POST', body: { ...base, moderatorIds } })
}

// ── Payments ────────────────────────────────────────────────────────────────

interface ApiPayment {
  id: string
  moderatorId: string
  amount: number
  currency: string
  period: string | null
  note: string | null
  paidAt: string
}
const mapPayment = (p: ApiPayment): Payment => ({ ...p, period: p.period ?? '', note: p.note ?? '' })

export async function fetchPayments(workspaceId: WorkspaceId): Promise<Payment[]> {
  return (await api<{ payments: ApiPayment[] }>(`${comp(workspaceId)}/payments`)).payments.map(mapPayment)
}

export async function addPayment(workspaceId: WorkspaceId, input: NewPaymentInput): Promise<Payment> {
  const r = await api<{ payment: ApiPayment }>(`${comp(workspaceId)}/payments`, {
    method: 'POST',
    body: { ...input, period: input.period || null, note: input.note || null, paidAt: input.paidAt ? new Date(input.paidAt).toISOString() : undefined },
  })
  return mapPayment(r.payment)
}
