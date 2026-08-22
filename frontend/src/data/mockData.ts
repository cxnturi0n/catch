// Static catalogues and empty defaults used by the dashboard. There is no
// simulated data: a workspace without real measurements renders its empty
// state (see analyticsCapabilities.ts for what may be shown).

import type { CatchTask, KOL, ModerationIncident, TrendPoint, WorkspaceId, WorkspaceStats } from '../types'

function formatDate(daysAgo: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

export const incidentTypes: ModerationIncident['type'][] = ['Fake Link', 'Impersonation', 'Phishing', 'Rugpull Warning']
export const incidentChannels: ModerationIncident['channel'][] = ['Discord', 'Telegram']
export const incidentStatuses: ModerationIncident['status'][] = ['Resolved', 'Open']
export const kolStatuses: KOL['status'][] = ['Active', 'Inactive', 'Pending']
export const kolChannels: KOL['channel'][] = ['Discord', 'Telegram', 'Twitter', 'YouTube']
export const taskPriorities: CatchTask['priority'][] = ['High', 'Medium', 'Low']
export const taskStatuses: CatchTask['status'][] = ['To Do', 'In Progress', 'Done']

const EMPTY_STATS: WorkspaceStats = {
  activeMembers: 0,
  activeMembersDelta: null,
  messagesWeek: 0,
  messagesDelta: null,
  newMembers: 0,
  newMembersDelta: null,
  scamAlertsBlocked: 0,
  scamAlertsDelta: null,
}

function emptyTrend(days: number): TrendPoint[] {
  return Array.from({ length: days }, (_, i) => ({ date: formatDate(days - 1 - i), value: 0 }))
}

export function getStats(_id: WorkspaceId): WorkspaceStats {
  return EMPTY_STATS
}

export function getActiveMembersTrend(_id: WorkspaceId): TrendPoint[] {
  return emptyTrend(30)
}

export function getDailyMessages(_id: WorkspaceId): TrendPoint[] {
  return emptyTrend(14)
}

export function getIncidents(_id: WorkspaceId): ModerationIncident[] {
  return []
}

export function getKols(_id: WorkspaceId): KOL[] {
  return []
}

export function getTasks(_id: WorkspaceId): CatchTask[] {
  return []
}
