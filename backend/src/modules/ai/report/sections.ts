// Data → sections. Pure: same input, same output. Free text from users or
// platforms (moderator names, member handles) is sanitized and capped here,
// and only appears in tables, never in metrics or insights.
import type { AllData } from './metrics.js'
import { emptySection, metric, round, type Section, type SectionId } from './template.js'

export function sanitize(s: string | null | undefined, max = 40): string {
  if (!s) return ''
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null)

export function buildSections(d: AllData): Record<SectionId, Section> {
  return {
    growth: growth(d),
    engagement: engagement(d),
    sentiment: emptySection('sentiment', 'not_available', 'Sentiment and topic tracking are not collected yet; this section will populate when Listening is connected.'),
    moderation: moderation(d),
    incidents: incidentsSection(d),
    kols: kolsSection(d),
    operations: operations(d),
  }
}

function growth(d: AllData): Section {
  const connected = d.coverage.platforms.filter((p) => p.status === 'connected')
  if (connected.length === 0) return emptySection('growth', 'not_connected', 'No platform is connected. Connect Discord or Telegram to track membership.')
  const g = d.growth
  if (g.platforms.length === 0) return emptySection('growth', 'no_data', 'No membership snapshots in this period yet; the first sync writes them.')

  const s = emptySection('growth', 'ok', null)
  const last = g.platforms.reduce((a, p) => a + (p.last ?? 0), 0)
  const first = g.platforms.reduce((a, p) => a + (p.first ?? 0), 0)
  const prevFirst = g.prevPlatforms.reduce((a, p) => a + (p.first ?? 0), 0)
  const prevLast = g.prevPlatforms.reduce((a, p) => a + (p.last ?? 0), 0)
  const hasPrev = g.prevPlatforms.length > 0
  s.metrics.push(metric('growth.members', 'Total members', 'count', last, hasPrev ? prevLast : null))
  s.metrics.push(metric('growth.net', 'Net growth', 'count', last - first, hasPrev ? prevLast - prevFirst : null))
  s.metrics.push(metric('growth.rate', 'Growth rate', 'pct', pct(last - first, first), hasPrev ? pct(prevLast - prevFirst, prevFirst) : null))
  for (const p of g.platforms) {
    const pp = g.prevPlatforms.find((x) => x.platform === p.platform)
    s.metrics.push(metric(`growth.${p.platform}.members`, `${cap(p.platform)} members`, 'count', p.last, pp?.last ?? null))
    s.metrics.push(metric(`growth.${p.platform}.net`, `${cap(p.platform)} net growth`, 'count', (p.last ?? 0) - (p.first ?? 0), pp ? (pp.last ?? 0) - (pp.first ?? 0) : null))
    s.series.push({ id: `growth.${p.platform}.series`, label: `${cap(p.platform)} members`, unit: 'count', points: p.series })
  }
  if (g.telegram) {
    s.metrics.push(metric('growth.telegram.joins', 'Telegram joins', 'count', g.telegram.joins, g.telegram.prevJoins))
    s.metrics.push(metric('growth.telegram.leaves', 'Telegram leaves', 'count', g.telegram.leaves, g.telegram.prevLeaves))
  }
  if (g.discord) {
    s.metrics.push(metric('growth.discord.joins', 'Discord joins', 'count', g.discord.joins, g.discord.prevJoins))
    s.metrics.push(metric('growth.discord.leaves', 'Discord leaves', 'count', g.discord.leaves, g.discord.prevLeaves))
  }
  const joins = (g.telegram?.joins ?? 0) + (g.discord?.joins ?? 0)
  const leaves = (g.telegram?.leaves ?? 0) + (g.discord?.leaves ?? 0)
  if (g.telegram || g.discord) s.metrics.push(metric('growth.churn', 'Leave rate', 'pct', pct(leaves, last), null), metric('growth.joins', 'Joins', 'count', joins, (g.telegram?.prevJoins ?? 0) + (g.discord?.prevJoins ?? 0)))
  return s
}

function engagement(d: AllData): Section {
  const e = d.engagement
  const connected = d.coverage.platforms.some((p) => p.status === 'connected' && (p.platform === 'discord' || p.platform === 'telegram'))
  if (!connected) return emptySection('engagement', 'not_connected', 'Message activity needs Discord or Telegram connected.')
  if (e.messages === 0 && e.prevMessages === 0) return emptySection('engagement', 'no_data', 'No messages recorded in this period. Discord activity needs the bot in the channels; Telegram needs the webhook registered.')

  const s = emptySection('engagement', 'ok', null)
  const members = d.growth.platforms.reduce((a, p) => a + (p.last ?? 0), 0)
  s.metrics.push(metric('engagement.messages', 'Messages', 'count', e.messages, e.prevMessages))
  s.metrics.push(metric('engagement.perDay', 'Messages per day', 'count', e.messages / d.coverage.periodDays, e.prevMessages / d.coverage.periodDays))
  s.metrics.push(metric('engagement.active', 'Active members', 'count', e.activeMembers, e.prevActiveMembers))
  s.metrics.push(metric('engagement.rate', 'Engagement rate', 'pct', members > 0 ? pct(e.activeMembers, members) : null, null))
  s.metrics.push(metric('engagement.avgDailyActive', 'Avg daily active', 'count', e.avgDailyActive === null ? null : round(e.avgDailyActive, 1), null))
  s.metrics.push(metric('engagement.perActive', 'Messages per active member', 'ratio', e.activeMembers > 0 ? e.messages / e.activeMembers : null, e.prevActiveMembers > 0 ? e.prevMessages / e.prevActiveMembers : null))
  const peak = peakHours(e.hourly)
  s.metrics.push(metric('engagement.peakHour', 'Peak hour (UTC)', 'hours', peak[0] ?? null, null))
  const top = [...e.hourly].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0)
  const total = e.hourly.reduce((a, b) => a + b, 0)
  s.metrics.push(metric('engagement.peakShare', 'Share of messages in top 3 hours', 'pct', pct(top, total), null))
  s.series.push({ id: 'engagement.daily', label: 'Messages per day', unit: 'count', points: e.daily })
  s.series.push({ id: 'engagement.hourly', label: 'Messages by UTC hour', unit: 'count', points: e.hourly.map((v, h) => ({ t: String(h).padStart(2, '0'), v })) })
  s.tables.push({
    id: 'engagement.topMembers',
    label: 'Most active members',
    columns: [
      { key: 'handle', label: 'Member' },
      { key: 'platform', label: 'Platform' },
      { key: 'messages', label: 'Messages', unit: 'count' },
    ],
    rows: e.topMembers.map((m) => ({ handle: sanitize(m.handle), platform: m.platform, messages: m.messages })),
  })
  return s
}

export function peakHours(hourly: number[], n = 3): number[] {
  const total = hourly.reduce((a, b) => a + b, 0)
  if (total === 0) return []
  return hourly
    .map((v, h) => ({ v, h }))
    .sort((a, b) => b.v - a.v || a.h - b.h)
    .slice(0, n)
    .map((x) => x.h)
}

function moderation(d: AllData): Section {
  const m = d.moderation
  if (m.moderators.length === 0) return emptySection('moderation', 'not_connected', 'No moderators on the roster. Add them under Moderators to track activity and punctuality.')
  const s = emptySection('moderation', 'ok', null)
  const evaluated = m.shifts.reduce((a, x) => a + x.evaluated, 0)
  const onTime = m.shifts.reduce((a, x) => a + x.onTime, 0)
  const noShow = m.shifts.reduce((a, x) => a + x.noShow, 0)
  const msgs = m.performance.reduce((a, p) => a + p.messages, 0)
  const activeMods = m.performance.filter((p) => p.messages > 0).length
  s.metrics.push(metric('moderation.count', 'Moderators', 'count', m.moderators.length, null))
  s.metrics.push(metric('moderation.activeCount', 'Moderators with activity', 'count', activeMods, null))
  s.metrics.push(metric('moderation.messages', 'Moderator messages', 'count', msgs, null))
  s.metrics.push(metric('moderation.shareOfMessages', 'Share of all messages', 'pct', pct(msgs, d.engagement.messages), null))
  s.metrics.push(metric('moderation.shiftsEvaluated', 'Shifts evaluated', 'count', evaluated, m.prevShifts.evaluated))
  s.metrics.push(metric('moderation.punctuality', 'Punctuality', 'pct', pct(onTime, evaluated), pct(m.prevShifts.onTime, m.prevShifts.evaluated)))
  s.metrics.push(metric('moderation.noShows', 'No-shows', 'count', noShow, m.prevShifts.noShow))
  s.metrics.push(metric('moderation.responses', 'Member questions answered', 'count', m.responses.count, m.prevResponses.count))
  s.metrics.push(metric('moderation.avgResponse', 'Average response time', 'seconds', m.responses.avgSeconds, m.prevResponses.avgSeconds))
  for (const p of m.paid) s.metrics.push(metric(`moderation.paid.${p.currency}`, `Paid (${p.currency})`, 'usd', round(p.amount, 2), null))

  const gaps = coverageGaps(peakHours(d.engagement.hourly), m.moderators)
  s.metrics.push(metric('moderation.coverageGaps', 'Peak hours without a shift', 'count', gaps.length, null))

  const shiftBy = new Map(m.shifts.map((x) => [x.moderatorId, x]))
  const perfBy = new Map(m.performance.map((p) => [p.moderatorId, p]))
  s.tables.push({
    id: 'moderation.table',
    label: 'Moderator activity',
    columns: [
      { key: 'name', label: 'Moderator' },
      { key: 'messages', label: 'Messages', unit: 'count' },
      { key: 'activeDays', label: 'Active days', unit: 'count' },
      { key: 'punctuality', label: 'Punctuality', unit: 'pct' },
      { key: 'noShows', label: 'No-shows', unit: 'count' },
    ],
    rows: m.moderators.map((mod) => {
      const p = perfBy.get(mod.id)
      const sh = shiftBy.get(mod.id)
      return {
        name: sanitize(mod.name),
        messages: p?.messages ?? 0,
        activeDays: p?.activeDays ?? 0,
        punctuality: sh && sh.evaluated > 0 ? round((sh.onTime / sh.evaluated) * 100, 1) : null,
        noShows: sh?.noShow ?? 0,
      }
    }),
  })
  if (gaps.length) s.tables.push({ id: 'moderation.gaps', label: 'Uncovered peak hours (UTC)', columns: [{ key: 'hour', label: 'Hour' }], rows: gaps.map((h) => ({ hour: `${String(h).padStart(2, '0')}:00` })) })
  return s
}

/** Peak UTC hours for which no moderator has a shift window covering them on any day. */
export function coverageGaps(peaks: number[], mods: { shiftStartUtc: number | null; shiftEndUtc: number | null }[]): number[] {
  const covered = (h: number) =>
    mods.some((m) => {
      if (m.shiftStartUtc === null || m.shiftEndUtc === null) return false
      return m.shiftStartUtc <= m.shiftEndUtc ? h >= m.shiftStartUtc && h < m.shiftEndUtc : h >= m.shiftStartUtc || h < m.shiftEndUtc
    })
  return peaks.filter((h) => !covered(h))
}

function incidentsSection(d: AllData): Section {
  const i = d.incidents
  if (i.total === 0 && i.prevTotal === 0 && i.openOlderThan72h === 0) return emptySection('incidents', 'no_data', 'No incidents logged in this or the previous period.')
  const s = emptySection('incidents', 'ok', null)
  s.metrics.push(metric('incidents.total', 'Incidents', 'count', i.total, i.prevTotal))
  s.metrics.push(metric('incidents.open', 'Open', 'count', i.byStatus.Open ?? 0, null))
  s.metrics.push(metric('incidents.escalated', 'Escalated', 'count', i.byStatus.Escalated ?? 0, null))
  s.metrics.push(metric('incidents.resolved', 'Resolved', 'count', i.byStatus.Resolved ?? 0, null))
  s.metrics.push(metric('incidents.resolutionRate', 'Resolution rate', 'pct', pct(i.byStatus.Resolved ?? 0, i.total), null))
  s.metrics.push(metric('incidents.staleOpen', 'Open for more than 72h', 'count', i.openOlderThan72h, null))
  s.tables.push({ id: 'incidents.byType', label: 'By type', columns: [{ key: 'type', label: 'Type' }, { key: 'n', label: 'Count', unit: 'count' }], rows: i.byType.map((t) => ({ type: sanitize(t.type), n: t.n })) })
  return s
}

function kolsSection(d: AllData): Section {
  const k = d.kols
  if (k.total === 0) return emptySection('kols', 'no_data', 'No KOLs tracked. Add them under KOL Tracker to follow reach and activity.')
  const s = emptySection('kols', 'ok', null)
  s.metrics.push(metric('kols.total', 'KOLs tracked', 'count', k.total, null))
  s.metrics.push(metric('kols.active', 'Active in period', 'count', k.activeInPeriod, null))
  s.metrics.push(metric('kols.activeShare', 'Share active', 'pct', pct(k.activeInPeriod, k.total), null))
  s.metrics.push(metric('kols.reach', 'Combined reach', 'count', k.reach, null))
  for (const [status, n] of Object.entries(k.byStatus).sort()) s.metrics.push(metric(`kols.status.${slug(status)}`, `Status: ${sanitize(status, 20)}`, 'count', n, null))
  return s
}

function operations(d: AllData): Section {
  const o = d.operations
  if (o.tasks.total === 0 && o.content.scheduled + o.content.published + o.content.cancelled === 0 && o.meetings.held === 0) return emptySection('operations', 'no_data', 'No tasks, scheduled content or meetings in this period.')
  const s = emptySection('operations', 'ok', null)
  s.metrics.push(metric('operations.tasks.total', 'Tasks', 'count', o.tasks.total, null))
  s.metrics.push(metric('operations.tasks.completion', 'Task completion', 'pct', pct(o.tasks.done, o.tasks.total), null))
  s.metrics.push(metric('operations.tasks.doneInPeriod', 'Tasks completed in period', 'count', o.tasks.doneInPeriod, o.tasks.prevDoneInPeriod))
  s.metrics.push(metric('operations.tasks.overdue', 'Overdue tasks', 'count', o.tasks.overdue, null))
  const planned = o.content.scheduled + o.content.published + o.content.cancelled
  s.metrics.push(metric('operations.content.planned', 'Content planned', 'count', planned, null))
  s.metrics.push(metric('operations.content.published', 'Content published', 'count', o.content.published, o.content.prevPublished))
  s.metrics.push(metric('operations.content.adherence', 'Schedule adherence', 'pct', pct(o.content.published, o.content.published + o.content.cancelled + o.content.scheduled), null))
  s.metrics.push(metric('operations.meetings', 'Meetings', 'count', o.meetings.held, o.meetings.prevHeld))
  return s
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'other'
