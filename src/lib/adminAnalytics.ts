// Owner-only platform analytics client. Calls the `admin-analytics` edge
// function, which aggregates KPIs across EVERY workspace and only answers the
// platform owner (email gate inside the function). Regular users get a 403.

import { supabase, isSupabaseConfigured } from './supabase'

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
}

export type AdminResult =
  | { status: 'ok'; data: AdminAnalytics }
  | { status: 'forbidden' }
  | { status: 'error'; error: string }

export async function fetchAdminAnalytics(): Promise<AdminResult> {
  if (!isSupabaseConfigured) return { status: 'error', error: 'Not configured on this deployment.' }
  try {
    const { data, error } = await supabase.functions.invoke<AdminAnalytics & { success?: boolean; error?: string }>(
      'admin-analytics',
      { body: {} },
    )
    if (error) {
      // functions.invoke surfaces non-2xx as an error; treat 403 as forbidden.
      const msg = error.message ?? 'Request failed'
      if (/403|forbidden/i.test(msg)) return { status: 'forbidden' }
      return { status: 'error', error: msg }
    }
    if (!data || data.success === false) {
      if (data && /forbidden/i.test(data.error ?? '')) return { status: 'forbidden' }
      return { status: 'error', error: data?.error ?? 'No data' }
    }
    return { status: 'ok', data: data as AdminAnalytics }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}
