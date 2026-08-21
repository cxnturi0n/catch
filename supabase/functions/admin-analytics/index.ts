import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createUserClient, createServiceClient } from '../_shared/supabaseAdmin.ts'

// Owner-only PLATFORM analytics. Aggregates KPIs across EVERY workspace/user so
// the platform owner can watch product + business health. Two-step auth:
//   1. Verify the caller's JWT and that their email is the owner (createUserClient).
//   2. Only then read across all data with the service role (bypasses RLS).
// Deploy WITH jwt verification; the email check is the real gate.

const OWNER_EMAIL = 'cinicololuca@gmail.com'

type Service = ReturnType<typeof createServiceClient>

async function countOf(sb: Service, table: string): Promise<number> {
  try {
    const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true })
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

/** Distinct workspace_ids present in a table → how many workspaces use a feature. */
async function distinctWorkspaces(sb: Service, table: string): Promise<number> {
  try {
    const { data, error } = await sb.from(table).select('workspace_id')
    if (error || !data) return 0
    return new Set((data as { workspace_id: string }[]).map((r) => r.workspace_id)).size
  } catch {
    return 0
  }
}

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // 1. Authenticate the caller and enforce owner-only access.
  const userClient = createUserClient(req)
  const { data: userData, error: authErr } = await userClient.auth.getUser()
  const email = userData?.user?.email?.toLowerCase() ?? null
  if (authErr || !email || email !== OWNER_EMAIL) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403)
  }

  try {
    const sb = createServiceClient()
    const now = Date.now()
    const since30 = new Date(now - 30 * 86_400_000).toISOString()

    // ── Users + plans + signups trend ─────────────────────────────────────────
    const { data: profiles } = await sb.from('profiles').select('id, plan, created_at')
    const profRows = (profiles ?? []) as { id: string; plan: string | null; created_at: string | null }[]
    const byPlan: Record<string, number> = { starter: 0, pro: 0, agency: 0, enterprise: 0 }
    for (const p of profRows) {
      const plan = p.plan && byPlan[p.plan] !== undefined ? p.plan : 'starter'
      byPlan[plan]++
    }
    const signupsByDay = new Map<string, number>()
    for (const p of profRows) {
      if (p.created_at && p.created_at >= since30) signupsByDay.set(dayKey(p.created_at), (signupsByDay.get(dayKey(p.created_at)) ?? 0) + 1)
    }
    const signups30d = [...signupsByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }))

    // ── Workspaces ────────────────────────────────────────────────────────────
    const { data: workspaces } = await sb.from('workspaces').select('id, created_at')
    const wsRows = (workspaces ?? []) as { id: string; created_at: string | null }[]
    const workspacesTotal = wsRows.length
    const workspacesNew30d = wsRows.filter((w) => w.created_at && w.created_at >= since30).length

    // ── Integrations: connected by platform + sync health ─────────────────────
    const { data: integrations } = await sb.from('integrations').select('workspace_id, platform, status, last_sync')
    const intRows = (integrations ?? []) as { platform: string; status: string; last_sync: string | null }[]
    const connectedByPlatform: Record<string, number> = {}
    let totalConnected = 0
    let staleSyncs = 0
    const staleCutoff = new Date(now - 25 * 3_600_000).toISOString()
    for (const i of intRows) {
      if (i.status !== 'connected') continue
      totalConnected++
      connectedByPlatform[i.platform] = (connectedByPlatform[i.platform] ?? 0) + 1
      if (!i.last_sync || i.last_sync < staleCutoff) staleSyncs++
    }

    // ── Content / entity counts across the whole platform ─────────────────────
    const [moderators, tasks, incidents, kols, resources, folders, payments, meetings, contentScheduled, feedbackTotal] =
      await Promise.all([
        countOf(sb, 'moderators'),
        countOf(sb, 'tasks'),
        countOf(sb, 'incidents'),
        countOf(sb, 'kols'),
        countOf(sb, 'resources'),
        countOf(sb, 'resource_folders'),
        countOf(sb, 'payments'),
        countOf(sb, 'meetings'),
        countOf(sb, 'content_schedule'),
        countOf(sb, 'feedback'),
      ])

    // ── Feature adoption (distinct workspaces touching each feature) ──────────
    const [wsMods, wsResources, wsPayments, wsComp, wsMeetings, wsContent] = await Promise.all([
      distinctWorkspaces(sb, 'moderators'),
      distinctWorkspaces(sb, 'resources'),
      distinctWorkspaces(sb, 'payments'),
      distinctWorkspaces(sb, 'compensation_configs'),
      distinctWorkspaces(sb, 'meetings'),
      distinctWorkspaces(sb, 'content_schedule'),
    ])

    // ── Leads (discovery form) ────────────────────────────────────────────────
    let discoveryResponses = 0
    let discoveryAvgMs: number | null = null
    try {
      const { data: dresp } = await sb.from('discovery_responses').select('completion_ms')
      const rows = (dresp ?? []) as { completion_ms: number | null }[]
      discoveryResponses = rows.length
      const times = rows.map((r) => r.completion_ms).filter((v): v is number => typeof v === 'number' && v > 0)
      discoveryAvgMs = times.length > 0 ? Math.round(times.reduce((s, v) => s + v, 0) / times.length) : null
    } catch { /* table may not exist */ }

    // ── Feedback pending (owner inbox) ────────────────────────────────────────
    let feedbackPending = 0
    try {
      const { count } = await sb.from('feedback').select('*', { count: 'exact', head: true }).eq('status', 'pending')
      feedbackPending = count ?? 0
    } catch { /* ignore */ }

    return jsonResponse({
      success: true,
      generatedAt: new Date().toISOString(),
      users: { total: profRows.length, byPlan, signups30d },
      workspaces: { total: workspacesTotal, new30d: workspacesNew30d },
      integrations: { totalConnected, connectedByPlatform, staleSyncs },
      content: { moderators, tasks, incidents, kols, resources, folders, payments, meetings, contentScheduled },
      adoption: {
        total: workspacesTotal,
        withModerators: wsMods,
        withResources: wsResources,
        withPayments: wsPayments,
        withCompensation: wsComp,
        withMeetings: wsMeetings,
        withContent: wsContent,
      },
      leads: { discoveryResponses, avgCompletionMs: discoveryAvgMs },
      feedback: { total: feedbackTotal, pending: feedbackPending },
    })
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
