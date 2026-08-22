// ── Status Update ───────────────────────────────────────────────────────────
// The briefing behind the topbar's "Status Update" button.
//
// Division of labour: this module assembles a snapshot from the SAME honest
// sources the dashboards use (buildRecap for platform metrics, the moderator
// roster for coverage), then asks the `status-update` edge function to write
// the prose. Numbers are computed here and only here — the model never derives
// one, so there is no second pipeline that could disagree with the dashboards.
//
// The AI text is an enhancement, never a dependency: any failure falls back to
// the deterministic narrative from buildRecapInsights, so the panel always has
// something true to show.

import { requestStatusUpdate } from './api/misc'
import { buildRecapInsights, RECAP_PLATFORMS, type RecapData } from './recapData'
import type { IntegrationKey, Moderator, WorkspaceIntegrations } from '../types'

// ── Coverage (UTC, mirroring the Directory board's rules) ───────────────────

const SHIFT_FALLBACK: Record<string, [number, number]> = {
  'Morning (06-14)': [6, 14],
  'Afternoon (14-22)': [14, 22],
  'Night (22-06)': [22, 6],
}

function shiftWindow(m: Moderator): { start: number; end: number } | null {
  if (typeof m.shiftStartUtc === 'number' && typeof m.shiftEndUtc === 'number') {
    return { start: m.shiftStartUtc, end: m.shiftEndUtc }
  }
  const fb = SHIFT_FALLBACK[m.shift]
  return fb ? { start: fb[0], end: fb[1] } : null
}

function windowHours(start: number, end: number): number[] {
  const out: number[] = []
  if (start === end) return out
  let h = start
  for (let i = 0; i < 24; i++) {
    if (h === end) break
    out.push(h)
    h = (h + 1) % 24
  }
  return out
}

export interface CoverageSummary {
  moderators: number
  onShiftNow: number
  hoursCovered: number
  /** Largest run of UTC hours with nobody on shift, or null when fully covered. */
  gap: { start: number; end: number; length: number } | null
}

/** Coverage as of `now` (UTC), derived from the roster the CM maintains. */
export function summariseCoverage(moderators: Moderator[], now = new Date()): CoverageSummary {
  const nowHour = now.getUTCHours()
  const nowDay = now.getUTCDay()
  const covered = new Set<number>()
  let onShiftNow = 0

  for (const m of moderators) {
    const w = shiftWindow(m)
    if (!w) continue
    const hours = windowHours(w.start, w.end)
    for (const h of hours) covered.add(h)
    const days = m.shiftDays && m.shiftDays.length > 0 ? m.shiftDays : [1, 2, 3, 4, 5]
    if (days.includes(nowDay) && hours.includes(nowHour)) onShiftNow++
  }

  // Longest uncovered run on the 24h circle.
  let gap: CoverageSummary['gap'] = null
  if (covered.size === 0) {
    gap = { start: 0, end: 0, length: 24 }
  } else if (covered.size < 24) {
    let best = { start: 0, len: 0 }
    let runStart = -1
    let runLen = 0
    for (let i = 0; i < 48; i++) {
      const h = i % 24
      if (!covered.has(h)) {
        if (runLen === 0) runStart = h
        runLen++
        if (runLen > best.len) best = { start: runStart, len: runLen }
      } else {
        runLen = 0
      }
    }
    const length = Math.min(best.len, 24)
    gap = { start: best.start, end: (best.start + length) % 24, length }
  }

  return { moderators: moderators.length, onShiftNow, hoursCovered: covered.size, gap }
}

// ── Snapshot ────────────────────────────────────────────────────────────────

export interface StatusSnapshot {
  workspace: string
  generatedAt: string
  windowDays: number
  totals: { members: number; growth: number | null; growthPct: number | null; platforms: number }
  platforms: {
    name: string
    headline: { label: string; value: number } | null
    changePct: number | null
    other: { label: string; value: number }[]
    lastSync: string | null
  }[]
  coverage: CoverageSummary
  /** Platforms the workspace has NOT connected — the model must not invent them. */
  notConnected: string[]
}

export function buildSnapshot(
  workspaceName: string,
  recap: RecapData,
  integrations: WorkspaceIntegrations,
  moderators: Moderator[],
): StatusSnapshot {
  const connected = new Set(recap.sections.map((s) => s.platform))
  return {
    workspace: workspaceName,
    generatedAt: recap.generatedAt,
    windowDays: recap.windowDays,
    totals: {
      members: recap.totalMembers,
      growth: recap.totalGrowth,
      growthPct: recap.totalGrowthPct,
      platforms: recap.activePlatforms,
    },
    platforms: recap.sections.map((s) => ({
      name: s.label,
      headline: s.headline ? { label: s.headline.label, value: s.headline.value } : null,
      changePct: s.headlinePct,
      other: s.metrics.map((m) => ({ label: m.label, value: m.value })),
      lastSync: integrations[s.platform]?.lastSync ?? null,
    })),
    coverage: summariseCoverage(moderators),
    notConnected: RECAP_PLATFORMS.filter((k) => !connected.has(k)),
  }
}

/** The connected platforms a recap should span for this workspace. */
export function connectedRecapPlatforms(integrations: WorkspaceIntegrations): IntegrationKey[] {
  return RECAP_PLATFORMS.filter((k) => integrations[k]?.status === 'Connected')
}

// ── The briefing ────────────────────────────────────────────────────────────

export interface StatusUpdate {
  headline: string
  body: string
  watch: string[]
  /** False when the deterministic fallback wrote this instead of the model. */
  fromAI: boolean
  model?: string
}


/**
 * Ask the edge function for the briefing, degrading to the deterministic
 * narrative on ANY failure (no key, refusal, offline, quota). Callers get a
 * usable update in every case and can surface `fromAI` if they want to say so.
 */
export async function writeStatusUpdate(
  workspaceId: string,
  snapshot: StatusSnapshot,
  recap: RecapData,
  lang: string,
): Promise<StatusUpdate> {
  const deterministic = (): StatusUpdate => {
    const insights = buildRecapInsights(recap)
    return {
      headline: insights.narrative.headline,
      body: insights.narrative.body,
      watch: insights.alerts.slice(0, 3).map((a) => `${a.title} — ${a.detail}`),
      fromAI: false,
    }
  }

  try {
    const data = await requestStatusUpdate(workspaceId, snapshot, lang)
    if (!data.ok || !data.update) return deterministic()
    return { ...data.update, watch: data.update.watch ?? [], fromAI: true, model: data.model }
  } catch {
    return deterministic()
  }
}
