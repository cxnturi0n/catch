// Platform analytics client. The API answers only users with role 'admin';
// everyone else gets 404 → 'forbidden'.

import { fetchAdminOverview } from './api/misc'

export const OWNER_EMAIL = 'cinicololuca@gmail.com'

export interface AdminAnalytics {
  generatedAt: string
  users: { total: number; byPlan: Record<string, number>; signups30d: { date: string; count: number }[] }
  workspaces: { total: number; new30d: number }
  integrations: { totalConnected: number; connectedByPlatform: Record<string, number>; staleSyncs: number }
  content: {
    moderators: number
    tasks: number
    incidents: number
    kols: number
    resources: number
    folders: number
    payments: number
    meetings: number
    contentScheduled: number
  }
  adoption: {
    total: number
    withModerators: number
    withResources: number
    withPayments: number
    withCompensation: number
    withMeetings: number
    withContent: number
  }
  leads: { discoveryResponses: number; avgCompletionMs: number | null }
  feedback: { total: number; pending: number }
  ai?: {
    byType: { type: string; calls: number; tokens: number; usd: number }[]
    byDay: { date: string; calls: number; usd: number }[]
    topWorkspaces: { workspaceId: string | null; name: string; calls: number; usd: number }[]
    totalUsd: number
    totalCalls: number
  }
}

export type AdminResult =
  | { status: 'ok'; data: AdminAnalytics }
  | { status: 'forbidden' }
  | { status: 'error'; error: string }

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

export async function fetchAdminAnalytics(): Promise<AdminResult> {
  return fetchAdminOverview<AdminAnalytics>()
}
