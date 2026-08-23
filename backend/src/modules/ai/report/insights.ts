// Rule-based insight engine. Deterministic, free, and the baseline narrative
// of every report: each detector looks at metrics by id and emits an Insight
// that cites those ids. A generative pass (P2) may rephrase these; it cannot
// add facts that are not here.
import type { Insight, Metric, Section, SectionId } from './template.js'

type Lookup = (id: string) => Metric | undefined

interface Detector {
  id: string
  section: SectionId
  run: (m: Lookup) => Omit<Insight, 'id' | 'sectionId'> | null
}

const fmt = (n: number | null, unit: Metric['unit'] = 'count'): string => {
  if (n === null) return 'n/a'
  if (unit === 'pct') return `${n.toFixed(1)}%`
  if (unit === 'usd') return n.toFixed(2)
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1)
}
const delta = (m: Metric): string => (m.deltaPct === null ? '' : ` (${m.deltaPct > 0 ? '+' : ''}${m.deltaPct.toFixed(1)}% vs previous period)`)

const DETECTORS: Detector[] = [
  // --- growth
  {
    id: 'growth.net.change',
    section: 'growth',
    run: (m) => {
      const net = m('growth.net')
      if (!net || net.value === null || net.deltaPct === null) return null
      if (Math.abs(net.deltaPct) < 15) return null
      const up = net.deltaPct > 0
      return { severity: up ? 'positive' : 'warning', metricIds: ['growth.net', 'growth.members'], text: `Net growth ${up ? 'accelerated' : 'slowed'} to ${fmt(net.value)} members${delta(net)}.` }
    },
  },
  {
    id: 'growth.negative',
    section: 'growth',
    run: (m) => {
      const net = m('growth.net')
      if (!net || net.value === null || net.value >= 0) return null
      return { severity: 'critical', metricIds: ['growth.net', 'growth.members'], text: `The community shrank by ${fmt(-net.value)} members over the period.` }
    },
  },
  {
    id: 'growth.churn.high',
    section: 'growth',
    run: (m) => {
      const churn = m('growth.churn')
      if (!churn || churn.value === null || churn.value < 5) return null
      return { severity: churn.value >= 10 ? 'critical' : 'warning', metricIds: ['growth.churn'], text: `Leave rate is ${fmt(churn.value, 'pct')} of the member base for the period.` }
    },
  },
  {
    id: 'growth.platform.divergence',
    section: 'growth',
    run: (m) => {
      const d = m('growth.discord.net')
      const t = m('growth.telegram.net')
      if (!d || !t || d.value === null || t.value === null) return null
      if ((d.value >= 0) === (t.value >= 0)) return null
      const [grow, shrink] = d.value >= 0 ? ['Discord', 'Telegram'] : ['Telegram', 'Discord']
      return { severity: 'warning', metricIds: ['growth.discord.net', 'growth.telegram.net'], text: `${grow} grew while ${shrink} shrank: membership is moving between platforms rather than growing overall.` }
    },
  },
  // --- engagement
  {
    id: 'engagement.messages.change',
    section: 'engagement',
    run: (m) => {
      const x = m('engagement.messages')
      if (!x || x.value === null || x.deltaPct === null || Math.abs(x.deltaPct) < 20) return null
      const up = x.deltaPct > 0
      return { severity: up ? 'positive' : 'warning', metricIds: ['engagement.messages'], text: `Message volume ${up ? 'rose' : 'fell'} to ${fmt(x.value)}${delta(x)}.` }
    },
  },
  {
    id: 'engagement.active.change',
    section: 'engagement',
    run: (m) => {
      const x = m('engagement.active')
      if (!x || x.value === null || x.deltaPct === null || Math.abs(x.deltaPct) < 20) return null
      const up = x.deltaPct > 0
      return { severity: up ? 'positive' : 'warning', metricIds: ['engagement.active'], text: `${fmt(x.value)} distinct members posted${delta(x)}.` }
    },
  },
  {
    id: 'engagement.rate.low',
    section: 'engagement',
    run: (m) => {
      const r = m('engagement.rate')
      if (!r || r.value === null || r.value >= 2) return null
      return { severity: 'warning', metricIds: ['engagement.rate', 'engagement.active', 'growth.members'], text: `Only ${fmt(r.value, 'pct')} of members were active: the community is large but quiet.` }
    },
  },
  {
    id: 'engagement.concentration',
    section: 'engagement',
    run: (m) => {
      const s = m('engagement.peakShare')
      const h = m('engagement.peakHour')
      if (!s || s.value === null || s.value < 40 || !h || h.value === null) return null
      return { severity: 'info', metricIds: ['engagement.peakShare', 'engagement.peakHour'], text: `${fmt(s.value, 'pct')} of messages land in three UTC hours around ${String(h.value).padStart(2, '0')}:00; staffing should follow that window.` }
    },
  },
  // --- moderation
  {
    id: 'moderation.punctuality.low',
    section: 'moderation',
    run: (m) => {
      const p = m('moderation.punctuality')
      const e = m('moderation.shiftsEvaluated')
      if (!p || p.value === null || !e || (e.value ?? 0) < 3) return null
      if (p.value >= 85) return null
      return { severity: p.value < 70 ? 'critical' : 'warning', metricIds: ['moderation.punctuality', 'moderation.shiftsEvaluated'], text: `Shift punctuality is ${fmt(p.value, 'pct')} across ${fmt(e.value)} evaluated shifts.` }
    },
  },
  {
    id: 'moderation.noShows',
    section: 'moderation',
    run: (m) => {
      const n = m('moderation.noShows')
      if (!n || n.value === null || n.value === 0) return null
      return { severity: n.value >= 3 ? 'critical' : 'warning', metricIds: ['moderation.noShows'], text: `${fmt(n.value)} scheduled shift${n.value === 1 ? '' : 's'} had no moderator activity at all${delta(n)}.` }
    },
  },
  {
    id: 'moderation.coverageGap',
    section: 'moderation',
    run: (m) => {
      const g = m('moderation.coverageGaps')
      if (!g || g.value === null || g.value === 0) return null
      return { severity: 'warning', metricIds: ['moderation.coverageGaps', 'engagement.peakHour'], text: `${fmt(g.value)} of the three busiest UTC hours ${g.value === 1 ? 'has' : 'have'} no moderator shift scheduled.` }
    },
  },
  {
    id: 'moderation.inactive',
    section: 'moderation',
    run: (m) => {
      const c = m('moderation.count')
      const a = m('moderation.activeCount')
      if (!c || !a || c.value === null || a.value === null || c.value === a.value) return null
      return { severity: 'warning', metricIds: ['moderation.count', 'moderation.activeCount'], text: `${fmt(c.value - a.value)} of ${fmt(c.value)} moderators had no matched activity; check their handles match the platform display names.` }
    },
  },
  {
    id: 'moderation.share',
    section: 'moderation',
    run: (m) => {
      const s = m('moderation.shareOfMessages')
      if (!s || s.value === null) return null
      if (s.value > 35) return { severity: 'warning', metricIds: ['moderation.shareOfMessages'], text: `Moderators wrote ${fmt(s.value, 'pct')} of all messages: conversation is being carried by staff rather than members.` }
      return null
    },
  },
  // --- incidents
  {
    id: 'incidents.spike',
    section: 'incidents',
    run: (m) => {
      const t = m('incidents.total')
      if (!t || t.value === null || t.prev === null || t.value < 3 || t.value < t.prev * 2) return null
      if (t.prev === 0) return { severity: 'warning', metricIds: ['incidents.total'], text: `${fmt(t.value)} incidents were logged this period; none in the previous one.` }
      return { severity: 'critical', metricIds: ['incidents.total'], text: `Incidents doubled: ${fmt(t.value)} this period against ${fmt(t.prev)} before.` }
    },
  },
  {
    id: 'incidents.stale',
    section: 'incidents',
    run: (m) => {
      const s = m('incidents.staleOpen')
      if (!s || s.value === null || s.value === 0) return null
      return { severity: 'warning', metricIds: ['incidents.staleOpen'], text: `${fmt(s.value)} incident${s.value === 1 ? ' has' : 's have'} been open or escalated for more than 72 hours.` }
    },
  },
  {
    id: 'incidents.resolution',
    section: 'incidents',
    run: (m) => {
      const r = m('incidents.resolutionRate')
      const t = m('incidents.total')
      if (!r || r.value === null || !t || (t.value ?? 0) < 3) return null
      if (r.value >= 90) return { severity: 'positive', metricIds: ['incidents.resolutionRate'], text: `${fmt(r.value, 'pct')} of incidents in the period are resolved.` }
      if (r.value < 50) return { severity: 'warning', metricIds: ['incidents.resolutionRate'], text: `Only ${fmt(r.value, 'pct')} of incidents in the period are resolved.` }
      return null
    },
  },
  // --- kols
  {
    id: 'kols.inactive',
    section: 'kols',
    run: (m) => {
      const s = m('kols.activeShare')
      const t = m('kols.total')
      if (!s || s.value === null || !t || (t.value ?? 0) < 2 || s.value >= 50) return null
      return { severity: 'warning', metricIds: ['kols.activeShare', 'kols.total'], text: `Only ${fmt(s.value, 'pct')} of tracked KOLs showed activity in the period.` }
    },
  },
  // --- operations
  {
    id: 'operations.overdue',
    section: 'operations',
    run: (m) => {
      const o = m('operations.tasks.overdue')
      if (!o || o.value === null || o.value === 0) return null
      return { severity: o.value >= 5 ? 'critical' : 'warning', metricIds: ['operations.tasks.overdue'], text: `${fmt(o.value)} task${o.value === 1 ? ' is' : 's are'} past due.` }
    },
  },
  {
    id: 'operations.completion.low',
    section: 'operations',
    run: (m) => {
      const c = m('operations.tasks.completion')
      const t = m('operations.tasks.total')
      if (!c || c.value === null || !t || (t.value ?? 0) < 5 || c.value >= 70) return null
      return { severity: 'warning', metricIds: ['operations.tasks.completion', 'operations.tasks.total'], text: `Task completion stands at ${fmt(c.value, 'pct')} of ${fmt(t.value)} tasks.` }
    },
  },
  {
    id: 'operations.content.adherence',
    section: 'operations',
    run: (m) => {
      const a = m('operations.content.adherence')
      const p = m('operations.content.planned')
      if (!a || a.value === null || !p || (p.value ?? 0) < 3 || a.value >= 80) return null
      return { severity: 'warning', metricIds: ['operations.content.adherence', 'operations.content.planned'], text: `${fmt(a.value, 'pct')} of planned content was published on schedule.` }
    },
  },
]

export function runInsights(sections: Record<SectionId, Section>): Insight[] {
  const all = new Map<string, Metric>()
  for (const s of Object.values(sections)) for (const m of s.metrics) all.set(m.id, m)
  const lookup: Lookup = (id) => all.get(id)
  const out: Insight[] = []
  for (const d of DETECTORS) {
    if (sections[d.section].state !== 'ok') continue
    const r = d.run(lookup)
    if (r) out.push({ id: d.id, sectionId: d.section, ...r })
  }
  return out
}

export const SEVERITY_RANK: Record<Insight['severity'], number> = { critical: 0, warning: 1, positive: 2, info: 3 }
