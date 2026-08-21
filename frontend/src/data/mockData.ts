// Deterministic mock data for the Catch Web3 Community Manager dashboard.
// All numbers are simulated — no live API calls are made anywhere in this app.

import type {
  CatchTask,
  KOL,
  ModerationIncident,
  TrendPoint,
  Workspace,
  WorkspaceData,
  WorkspaceId,
  WorkspaceStats,
} from '../types'

export const initialWorkspaces: Workspace[] = [
  {
    id: 'arbitrum',
    name: 'Arbitrum Foundation',
    shortName: 'ARB',
    colorFrom: '#7c3aed',
    colorTo: '#06b6d4',
  },
  {
    id: 'kucoin',
    name: 'KuCoin Exchange',
    shortName: 'KCS',
    colorFrom: '#06b6d4',
    colorTo: '#10b981',
  },
]

// Small seeded PRNG so charts are stable across renders/reloads.
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function formatDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function buildTrend(days: number, endValue: number, weeklyChangePct: number, seed: number, noise: number): TrendPoint[] {
  const rand = mulberry32(seed)
  const startValue = endValue / (1 + weeklyChangePct / 100)
  const points: TrendPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const progress = (days - 1 - i) / (days - 1)
    const base = startValue + (endValue - startValue) * progress
    const wobble = (rand() - 0.5) * 2 * noise
    const value = i === 0 ? endValue : Math.max(0, Math.round(base + wobble))
    points.push({ date: formatDate(i), value })
  }
  return points
}

function buildDailyVolume(days: number, weekTotal: number, prevWeekTotal: number, seed: number): TrendPoint[] {
  const rand = mulberry32(seed)
  const weights: number[] = Array.from({ length: days }, () => 0.6 + rand())
  const half = days / 2
  const points: TrendPoint[] = []
  const prevWeights = weights.slice(0, half)
  const prevSum = prevWeights.reduce((a, b) => a + b, 0)
  const currWeights = weights.slice(half)
  const currSum = currWeights.reduce((a, b) => a + b, 0)

  for (let i = 0; i < half; i++) {
    const daysAgo = days - 1 - i
    const value = Math.round((prevWeights[i] / prevSum) * prevWeekTotal)
    points.push({ date: formatDate(daysAgo), value })
  }
  for (let i = 0; i < half; i++) {
    const daysAgo = half - 1 - i
    const value = Math.round((currWeights[i] / currSum) * weekTotal)
    points.push({ date: formatDate(daysAgo), value })
  }
  return points
}

function statsFrom(
  activeMembers: number,
  activeMembersDelta: number,
  messagesWeek: number,
  messagesDelta: number,
  newMembers: number,
  newMembersDelta: number,
  scamAlertsBlocked: number,
  scamAlertsDelta: number,
): WorkspaceStats {
  return {
    activeMembers,
    activeMembersDelta,
    messagesWeek,
    messagesDelta,
    newMembers,
    newMembersDelta,
    scamAlertsBlocked,
    scamAlertsDelta,
  }
}

const arbitrumStats = statsFrom(45230, 12, 8940, 5, 1240, 18, 7, 40)
const kucoinStats = statsFrom(128450, 3, 23100, -2, 3890, 8, 23, 15)

const arbitrumIncidents: ModerationIncident[] = [
  { id: 'arb-inc-1', date: '2026-07-15', type: 'Phishing', channel: 'Discord', actionTaken: 'Banned user, purged links', status: 'Resolved' },
  { id: 'arb-inc-2', date: '2026-07-12', type: 'Fake Link', channel: 'Telegram', actionTaken: 'Removed message, warned channel', status: 'Resolved' },
  { id: 'arb-inc-3', date: '2026-07-09', type: 'Impersonation', channel: 'Discord', actionTaken: 'Reported fake admin account to platform', status: 'Open' },
  { id: 'arb-inc-4', date: '2026-07-05', type: 'Rugpull Warning', channel: 'Telegram', actionTaken: 'Pinned community warning notice', status: 'Resolved' },
  { id: 'arb-inc-5', date: '2026-06-30', type: 'Fake Link', channel: 'Discord', actionTaken: 'Auto-modbot deleted, user timed out', status: 'Open' },
]

const kucoinIncidents: ModerationIncident[] = [
  { id: 'kc-inc-1', date: '2026-07-16', type: 'Phishing', channel: 'Telegram', actionTaken: 'Blocked domain, alerted users', status: 'Open' },
  { id: 'kc-inc-2', date: '2026-07-15', type: 'Fake Link', channel: 'Discord', actionTaken: 'Removed message, muted user', status: 'Resolved' },
  { id: 'kc-inc-3', date: '2026-07-14', type: 'Impersonation', channel: 'Telegram', actionTaken: 'Reported fake support account', status: 'Resolved' },
  { id: 'kc-inc-4', date: '2026-07-12', type: 'Fake Link', channel: 'Telegram', actionTaken: 'Banned 3 bot accounts', status: 'Resolved' },
  { id: 'kc-inc-5', date: '2026-07-10', type: 'Rugpull Warning', channel: 'Discord', actionTaken: 'Posted official clarification', status: 'Resolved' },
  { id: 'kc-inc-6', date: '2026-07-09', type: 'Phishing', channel: 'Discord', actionTaken: 'Reported to Discord Trust & Safety', status: 'Open' },
  { id: 'kc-inc-7', date: '2026-07-07', type: 'Fake Link', channel: 'Telegram', actionTaken: 'Auto-modbot deleted', status: 'Resolved' },
  { id: 'kc-inc-8', date: '2026-07-05', type: 'Impersonation', channel: 'Discord', actionTaken: 'Verified badge added to reduce confusion', status: 'Resolved' },
  { id: 'kc-inc-9', date: '2026-07-03', type: 'Fake Link', channel: 'Discord', actionTaken: 'Removed message, warned user', status: 'Open' },
  { id: 'kc-inc-10', date: '2026-06-30', type: 'Phishing', channel: 'Telegram', actionTaken: 'Blocked domain across all groups', status: 'Resolved' },
  { id: 'kc-inc-11', date: '2026-06-28', type: 'Rugpull Warning', channel: 'Telegram', actionTaken: 'Pinned warning, escalated to legal', status: 'Open' },
  { id: 'kc-inc-12', date: '2026-06-25', type: 'Impersonation', channel: 'Discord', actionTaken: 'Banned duplicate account', status: 'Resolved' },
]

const arbitrumKols: KOL[] = [
  { id: 'arb-kol-1', name: 'CryptoNova', handle: '@cryptonova', channel: 'Twitter', reach: 182000, status: 'Active', lastActivity: '2026-07-15', notes: 'Weekly AMA host, strong engagement' },
  { id: 'arb-kol-2', name: 'DeFi Dan', handle: '@defidan', channel: 'YouTube', reach: 96000, status: 'Active', lastActivity: '2026-07-14', notes: 'Monthly ecosystem deep-dive videos' },
  { id: 'arb-kol-3', name: 'L2 Watcher', handle: '@l2watcher', channel: 'Twitter', reach: 54000, status: 'Pending', lastActivity: '2026-07-01', notes: 'Onboarding for Q3 campaign' },
  { id: 'arb-kol-4', name: 'ChainSignal', handle: '@chainsignal', channel: 'Telegram', reach: 41000, status: 'Active', lastActivity: '2026-07-13', notes: 'Daily market recaps mentioning ARB' },
  { id: 'arb-kol-5', name: 'RollupRadar', handle: '@rolluprader', channel: 'YouTube', reach: 28500, status: 'Inactive', lastActivity: '2026-05-20', notes: 'No content in 8 weeks, follow up' },
  { id: 'arb-kol-6', name: 'GasFeeGuru', handle: '@gasfeeguru', channel: 'Twitter', reach: 73000, status: 'Active', lastActivity: '2026-07-16', notes: 'Frequently compares L2 fees favorably' },
]

const kucoinKols: KOL[] = [
  { id: 'kc-kol-1', name: 'TokenTalk', handle: '@tokentalk', channel: 'Twitter', reach: 310000, status: 'Active', lastActivity: '2026-07-16', notes: 'Top referral partner, exclusive AMAs' },
  { id: 'kc-kol-2', name: 'AltcoinAlex', handle: '@altcoinalex', channel: 'YouTube', reach: 245000, status: 'Active', lastActivity: '2026-07-15', notes: 'Weekly exchange review series' },
  { id: 'kc-kol-3', name: 'MarginMaven', handle: '@marginmaven', channel: 'Twitter', reach: 128000, status: 'Active', lastActivity: '2026-07-14', notes: 'Futures trading tutorials on KuCoin' },
  { id: 'kc-kol-4', name: 'SpotSensei', handle: '@spotsensei', channel: 'Telegram', reach: 87000, status: 'Pending', lastActivity: '2026-07-02', notes: 'Contract under review' },
  { id: 'kc-kol-5', name: 'YieldYuki', handle: '@yieldyuki', channel: 'YouTube', reach: 61000, status: 'Active', lastActivity: '2026-07-11', notes: 'Staking & earn product walkthroughs' },
  { id: 'kc-kol-6', name: 'ChartChaser', handle: '@chartchaser', channel: 'Twitter', reach: 152000, status: 'Inactive', lastActivity: '2026-04-30', notes: 'Contract lapsed, renewal pending' },
  { id: 'kc-kol-7', name: 'CandleQueen', handle: '@candlequeen', channel: 'Twitter', reach: 203000, status: 'Active', lastActivity: '2026-07-16', notes: 'High engagement on listing announcements' },
  { id: 'kc-kol-8', name: 'FuturesFox', handle: '@futuresfox', channel: 'Discord', reach: 39000, status: 'Active', lastActivity: '2026-07-10', notes: 'Community mod + KOL hybrid role' },
  { id: 'kc-kol-9', name: 'BlockBrief', handle: '@blockbrief', channel: 'Telegram', reach: 58000, status: 'Pending', lastActivity: '2026-06-28', notes: 'Awaiting rate card negotiation' },
]

const arbitrumTasks: CatchTask[] = [
  { id: 'arb-task-1', title: 'Draft Q3 KOL campaign brief', assignee: 'Mia Chen', priority: 'High', dueDate: '2026-07-18', status: 'In Progress' },
  { id: 'arb-task-2', title: 'Review scam report escalation process', assignee: 'Jordan Lee', priority: 'High', dueDate: '2026-07-19', status: 'To Do' },
  { id: 'arb-task-3', title: 'Publish weekly community digest', assignee: 'Priya Nair', priority: 'Medium', dueDate: '2026-07-17', status: 'To Do' },
  { id: 'arb-task-4', title: 'Onboard L2 Watcher as verified KOL', assignee: 'Mia Chen', priority: 'Medium', dueDate: '2026-07-22', status: 'To Do' },
  { id: 'arb-task-5', title: 'Update Discord auto-mod keyword list', assignee: 'Sam Torres', priority: 'High', dueDate: '2026-07-16', status: 'Done' },
  { id: 'arb-task-6', title: 'Coordinate AMA with DeFi Dan', assignee: 'Priya Nair', priority: 'Low', dueDate: '2026-07-25', status: 'In Progress' },
  { id: 'arb-task-7', title: 'Audit Telegram admin permissions', assignee: 'Jordan Lee', priority: 'Medium', dueDate: '2026-07-14', status: 'Done' },
  { id: 'arb-task-8', title: 'Prepare monthly scam trend report', assignee: 'Sam Torres', priority: 'Low', dueDate: '2026-07-28', status: 'To Do' },
]

const kucoinTasks: CatchTask[] = [
  { id: 'kc-task-1', title: 'Finalize listing announcement KOL push', assignee: 'Elena Vance', priority: 'High', dueDate: '2026-07-17', status: 'In Progress' },
  { id: 'kc-task-2', title: 'Investigate phishing domain cluster', assignee: 'Marcus Webb', priority: 'High', dueDate: '2026-07-16', status: 'In Progress' },
  { id: 'kc-task-3', title: 'Renew ChartChaser KOL contract', assignee: 'Elena Vance', priority: 'Medium', dueDate: '2026-07-20', status: 'To Do' },
  { id: 'kc-task-4', title: 'Escalate rugpull warning to legal team', assignee: 'Marcus Webb', priority: 'High', dueDate: '2026-07-17', status: 'To Do' },
  { id: 'kc-task-5', title: 'Weekly futures trading AMA w/ MarginMaven', assignee: 'Diego Ruiz', priority: 'Medium', dueDate: '2026-07-19', status: 'To Do' },
  { id: 'kc-task-6', title: 'Review Discord verified-badge rollout', assignee: 'Sofia Park', priority: 'Low', dueDate: '2026-07-24', status: 'In Progress' },
  { id: 'kc-task-7', title: 'Negotiate BlockBrief rate card', assignee: 'Elena Vance', priority: 'Low', dueDate: '2026-07-23', status: 'To Do' },
  { id: 'kc-task-8', title: 'Publish exchange security best-practices post', assignee: 'Marcus Webb', priority: 'Medium', dueDate: '2026-07-15', status: 'Done' },
  { id: 'kc-task-9', title: 'Sync with FuturesFox on mod coverage', assignee: 'Diego Ruiz', priority: 'Low', dueDate: '2026-07-21', status: 'Done' },
  { id: 'kc-task-10', title: 'Audit Telegram group admin list', assignee: 'Sofia Park', priority: 'Medium', dueDate: '2026-07-18', status: 'To Do' },
  { id: 'kc-task-11', title: 'Prepare monthly KOL performance report', assignee: 'Elena Vance', priority: 'Medium', dueDate: '2026-07-26', status: 'To Do' },
  { id: 'kc-task-12', title: 'Review impersonation report backlog', assignee: 'Marcus Webb', priority: 'High', dueDate: '2026-07-16', status: 'Done' },
  { id: 'kc-task-13', title: 'Set up scam alert webhook to Slack', assignee: 'Sofia Park', priority: 'High', dueDate: '2026-07-20', status: 'In Progress' },
  { id: 'kc-task-14', title: 'Draft CandleQueen listing collab brief', assignee: 'Diego Ruiz', priority: 'Medium', dueDate: '2026-07-22', status: 'To Do' },
  { id: 'kc-task-15', title: 'Close out June moderation summary', assignee: 'Elena Vance', priority: 'Low', dueDate: '2026-07-14', status: 'Done' },
]

const dataByWorkspace: Record<WorkspaceId, WorkspaceData> = {
  arbitrum: {
    stats: arbitrumStats,
    activeMembersTrend: buildTrend(30, arbitrumStats.activeMembers, arbitrumStats.activeMembersDelta ?? 0, 1, 350),
    dailyMessages: buildDailyVolume(
      14,
      arbitrumStats.messagesWeek,
      arbitrumStats.messagesWeek / (1 + (arbitrumStats.messagesDelta ?? 0) / 100),
      3,
    ),
    incidents: arbitrumIncidents,
    kols: arbitrumKols,
    tasks: arbitrumTasks,
  },
  kucoin: {
    stats: kucoinStats,
    activeMembersTrend: buildTrend(30, kucoinStats.activeMembers, kucoinStats.activeMembersDelta ?? 0, 2, 900),
    dailyMessages: buildDailyVolume(
      14,
      kucoinStats.messagesWeek,
      kucoinStats.messagesWeek / (1 + (kucoinStats.messagesDelta ?? 0) / 100),
      4,
    ),
    incidents: kucoinIncidents,
    kols: kucoinKols,
    tasks: kucoinTasks,
  },
}

export const incidentTypes: ModerationIncident['type'][] = ['Fake Link', 'Impersonation', 'Phishing', 'Rugpull Warning']
export const incidentChannels: ModerationIncident['channel'][] = ['Discord', 'Telegram']
export const incidentStatuses: ModerationIncident['status'][] = ['Resolved', 'Open']
export const kolStatuses: KOL['status'][] = ['Active', 'Inactive', 'Pending']
export const kolChannels: KOL['channel'][] = ['Discord', 'Telegram', 'Twitter', 'YouTube']
export const taskPriorities: CatchTask['priority'][] = ['High', 'Medium', 'Low']
export const taskStatuses: CatchTask['status'][] = ['To Do', 'In Progress', 'Done']

// Fallback data for workspaces created at runtime (e.g. via onboarding) that
// have no seeded mock records — keeps every module rendering a sane empty
// state instead of crashing on an unknown workspace id.
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

export function getStats(id: WorkspaceId): WorkspaceStats {
  return dataByWorkspace[id]?.stats ?? EMPTY_STATS
}

export function getActiveMembersTrend(id: WorkspaceId): TrendPoint[] {
  return dataByWorkspace[id]?.activeMembersTrend ?? emptyTrend(30)
}

export function getDailyMessages(id: WorkspaceId): TrendPoint[] {
  return dataByWorkspace[id]?.dailyMessages ?? emptyTrend(14)
}

export function getIncidents(id: WorkspaceId): ModerationIncident[] {
  return dataByWorkspace[id]?.incidents ?? []
}

export function getKols(id: WorkspaceId): KOL[] {
  return dataByWorkspace[id]?.kols ?? []
}

export function getTasks(id: WorkspaceId): CatchTask[] {
  return dataByWorkspace[id]?.tasks ?? []
}
