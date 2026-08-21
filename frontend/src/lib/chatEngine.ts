// ── Catch internal assistant — engine ────────────────────────────────────────
// Deterministic, NO-AI, zero-cost, and privacy-safe: nothing leaves the app.
// It routes the user around the platform and answers grounded questions about
// what Catch really does (knowledge base mirrors the honest capability facts).
//
// PLUGGABLE BRAIN: `respond()` is the local engine. When an AI backend is wired
// later, call it first and fall back to `respond()` — the ChatReply shape stays
// the same, so the UI never changes. Keep answers honest: never invent metrics.

export interface ChatAction {
  label: string
  to: string
}
export interface ChatReply {
  content: string
  actions?: ChatAction[]
}

// Navigation targets — "go to / open / show <x>" or a bare keyword jumps here.
// Keys keep a few Italian synonyms too, so older habits still match.
const NAV: { keys: string[]; label: string; to: string }[] = [
  { keys: ['overview', 'analytics', 'analisi', 'community analytics'], label: 'Overview', to: '/dashboard/analytics' },
  { keys: ['discord'], label: 'Discord', to: '/dashboard/analytics?platform=discord' },
  { keys: ['telegram'], label: 'Telegram', to: '/dashboard/analytics?platform=telegram' },
  { keys: ['galxe'], label: 'Galxe', to: '/dashboard/analytics?platform=galxe' },
  { keys: ['zealy'], label: 'Zealy', to: '/dashboard/analytics?platform=zealy' },
  { keys: ['report', 'recap'], label: 'Report', to: '/dashboard/report' },
  { keys: ['moderator', 'moderatori', 'mod', 'team', 'turni', 'shift'], label: 'Moderators', to: '/dashboard/moderators' },
  { keys: ['kol', 'ambassador', 'influencer'], label: 'KOLs', to: '/dashboard/kol' },
  { keys: ['task', 'calendar', 'calendario', 'meeting'], label: 'Task Manager', to: '/dashboard/tasks' },
  { keys: ['resource', 'risorse', 'sop', 'playbook', 'template'], label: 'Resources', to: '/dashboard/resources' },
  { keys: ['payment', 'pagament', 'salar', 'compens', 'punti', 'points'], label: 'Payments', to: '/dashboard/payments' },
  { keys: ['integration', 'integrazion', 'connett', 'collega', 'connect'], label: 'Integrations', to: '/dashboard/integrations' },
  { keys: ['instruction', 'istruzioni', 'guida', 'guide'], label: 'Instructions', to: '/dashboard/instructions' },
  { keys: ['profil', 'timezone', 'fuso', 'account', 'lingua', 'language'], label: 'Profile', to: '/dashboard/profile' },
]

// Knowledge base — grounded, honest answers. `score` = keyword hits.
const KB: { keys: string[]; answer: string; actions?: ChatAction[] }[] = [
  {
    keys: ['what do you do', 'who are you', 'help', 'what can you', 'how do you work', 'cosa fai', 'chi sei', 'aiuto', 'cosa puoi', 'come funzioni'],
    answer:
      'I’m the Catch assistant. I can take you to any section, explain what the platform really tracks (for Discord, Telegram, Galxe, Zealy, X), how to connect an integration, and how moderators, compensation and reports work. Just ask me things like “how do I connect Discord?”, “what does Telegram track?”, “take me to moderators”.',
  },
  {
    keys: ['discord', 'what does discord', 'discord metrics', 'cosa fa discord', 'metriche discord'],
    answer:
      'With Discord (bot: Token + Server ID) Catch tracks: members (≈ approximate), 7-day bans (needs “View Audit Log”), an hour×day activity heatmap, messages/bans/timeouts per moderator, and tenure/retention (requires the privileged MEMBERS intent). It doesn’t read message content yet (sentiment/scam) — that comes with AI.',
    actions: [{ label: 'Open Discord', to: '/dashboard/analytics?platform=discord' }, { label: 'Integrations', to: '/dashboard/integrations' }],
  },
  {
    keys: ['telegram', 'what does telegram', 'telegram metrics', 'cosa fa telegram', 'metriche telegram'],
    answer:
      'With Telegram (admin bot: Token + Chat ID) Catch tracks: member count, message count (only from activation on, no history) and messages per moderator (handle match). You need the admin bot + privacy OFF to count messages.',
    actions: [{ label: 'Open Telegram', to: '/dashboard/analytics?platform=telegram' }, { label: 'Integrations', to: '/dashboard/integrations' }],
  },
  {
    keys: ['galxe', 'zealy', 'quest', 'xp'],
    answer:
      'Galxe (public space alias): followers, participants, campaigns. Zealy (subdomain + API key): members and total XP. Note: funnel stages and quest completion rates are NOT provided by the integrations, so we don’t track them.',
    actions: [{ label: 'Integrations', to: '/dashboard/integrations' }],
  },
  {
    keys: ['twitter', ' x ', 'csv', 'impression'],
    answer:
      'Twitter/X has no free API: the data (impressions, engagement, likes, retweets) is imported via a manual CSV from analytics.twitter.com. A live API connection is paid (pay-per-use) → reserved for higher plans.',
    actions: [{ label: 'Analytics', to: '/dashboard/analytics' }],
  },
  {
    keys: ['connect', 'how do i integrate', 'setup', 'bot token', 'connett', 'collega', 'come integro'],
    answer:
      'To connect a platform: go to Integrations, pick the platform and follow the steps. Discord = Bot Token + Server ID (with View Audit Log permission). Telegram = Bot Token + Chat ID (admin bot). Zealy = Subdomain + API Key. Galxe = Space Alias only. Step-by-step guides live in Catch Instructions.',
    actions: [{ label: 'Integrations', to: '/dashboard/integrations' }, { label: 'Guides', to: '/dashboard/instructions' }],
  },
  {
    keys: ['moderator', 'moderatori', 'turni', 'copertura', 'shift', 'coverage'],
    answer:
      'The Moderators section runs the team: directory (handle, timezone, shift, CV), analytics/punctuality, points-based compensation, reports and leaderboard. Activity metrics come from the bot (matching the mod’s handle) — moderators do NOT need to log in or grant personal permissions.',
    actions: [{ label: 'Moderators', to: '/dashboard/moderators' }],
  },
  {
    keys: ['compens', 'points', 'punti', 'salar', 'payment', 'payout', 'pagament'],
    answer:
      'Compensation works on points: you assign a point value to each metric (e.g. 1 message = 1 pt, 1 ban = 5 pt) and a points→currency rate. Catch computes each moderator’s earnings; the salary log lives in Payments. Amounts are calculated, not transferred by the platform.',
    actions: [{ label: 'Payments', to: '/dashboard/payments' }],
  },
  {
    keys: ['kol', 'ambassador', 'influencer'],
    answer:
      'The KOL Tracker is a CRM for ambassadors: name, channel, reach, status, notes. Today the data is entered by hand (no automatic social listening — that would require the paid X API).',
    actions: [{ label: 'KOLs', to: '/dashboard/kol' }],
  },
  {
    keys: ['report', 'recap', 'send', 'email', 'invio'],
    answer:
      'In Report you build the client recap: pick the type and period on the left, fill the email details on the right, then “Generate report”. You can schedule automatic delivery (off/daily/weekly). Sections are built from the real connected data.',
    actions: [{ label: 'Report', to: '/dashboard/report' }],
  },
  {
    keys: ['resource', 'risorse', 'sop', 'playbook', 'template', 'knowledge'],
    answer:
      'Resources is the knowledge drive: folders for Playbook, SOP, Template, Meeting notes, Brand asset, Reference, Schedule. You upload the team’s files into them.',
    actions: [{ label: 'Resources', to: '/dashboard/resources' }],
  },
  {
    keys: ['task', 'calendar', 'calendario', 'meeting'],
    answer:
      'The Task Manager has table, board and a 30-minute-slot calendar view (with meetings). You assign tasks to anyone on the team; times follow your account timezone.',
    actions: [{ label: 'Task Manager', to: '/dashboard/tasks' }],
  },
  {
    keys: ['timezone', 'fuso', 'orario', 'time zone'],
    answer:
      'You set your account timezone in Profile: from there the calendar, meetings and times are shown in your own timezone.',
    actions: [{ label: 'Profile', to: '/dashboard/profile' }],
  },
  {
    keys: ['scam', 'sentiment', 'ai', 'phishing', 'agent', 'agente', 'intelligenza'],
    answer:
      'Today Catch counts activity but doesn’t read message content. With AI (coming) you unlock: real-time scam/phishing detection, community sentiment and topics, real response-time and monitoring agents. It’s under evaluation — it requires client consent and a commercial AI backend (zero-retention).',
  },
  {
    keys: ['price', 'pricing', 'plan', 'cost', 'tier', 'free', 'prezzo', 'piano'],
    answer:
      'Planned structure: a generous Free (limited in data history and volumes) + Starter, Pro and Agency. The internal-content AI features are cheap (~$1-10/month per community); external social listening (X API) is expensive → an Agency add-on.',
  },
]

const GREETING = /^(ciao|hey|salve|hello|hi|buongiorno|buonasera)\b/i

// ── Workspace setup prompt ───────────────────────────────────────────────────
// "This project is for company X, I run Discord and Telegram with 5 moderators."
// We only recognise platforms Catch can genuinely connect — never invent one —
// and answer with the concrete setup checklist rather than pretending we built it.

const SETUP_PLATFORMS: { key: string; label: string; patterns: RegExp }[] = [
  { key: 'discord', label: 'Discord', patterns: /\bdiscord\b/i },
  { key: 'telegram', label: 'Telegram', patterns: /\btelegram\b/i },
  { key: 'zealy', label: 'Zealy', patterns: /\bzealy\b/i },
  { key: 'galxe', label: 'Galxe', patterns: /\bgalxe\b/i },
  { key: 'x', label: 'X / Twitter', patterns: /(\bx\b|twitter)/i },
]

const SETUP_HINT = /\b(project|progetto|community|comunit|manage|gestisc|gestisco|run|seguo|work(ing)? (for|with)|client|cliente|azienda|company|brand|protocol)\b/i

export interface SetupPlan {
  platforms: { key: string; label: string }[]
  moderators: number | null
  managers: number | null
}

/** Extract a workspace plan from a free-form description. Null when it doesn't look like one. */
export function parseSetupPrompt(input: string): SetupPlan | null {
  const text = input.trim()
  if (text.length < 20 || !SETUP_HINT.test(text)) return null

  const platforms = SETUP_PLATFORMS.filter((p) => p.patterns.test(text)).map((p) => ({ key: p.key, label: p.label }))
  if (platforms.length === 0) return null

  // Allow a qualifier between the count and the noun ("1 other community manager").
  const mods = text.match(/(\d+)\s+(?:\w+\s+){0,2}?(?:moderator|moderatori|mod)s?\b/i)
  const cms = text.match(/(\d+)\s+(?:\w+\s+){0,2}?(?:community manager|cm|manager)s?\b/i)

  return {
    platforms,
    moderators: mods ? Number(mods[1]) : null,
    managers: cms ? Number(cms[1]) : null,
  }
}

/** The reply for a recognised setup prompt: what we'll switch on, and what's next. */
export function setupReply(plan: SetupPlan): ChatReply {
  const names = plan.platforms.map((p) => p.label)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const team: string[] = []
  if (plan.managers) team.push(`${plan.managers} community manager${plan.managers === 1 ? '' : 's'}`)
  if (plan.moderators) team.push(`${plan.moderators} moderator${plan.moderators === 1 ? '' : 's'}`)

  const x = plan.platforms.find((p) => p.key === 'x')
  const connectable = plan.platforms.filter((p) => p.key !== 'x')

  const lines = [
    `Got it — I'll shape this workspace around **${list}**${team.length > 0 ? `, with ${team.join(' and ')}` : ''}.`,
    '',
    'Here’s what that means concretely:',
    connectable.length > 0
      ? `• **Analytics** gets one section per platform — ${connectable.map((p) => p.label).join(', ')} — as soon as each one is connected.`
      : '',
    x ? '• **X / Twitter** has no free API, so its numbers come in through the CSV import rather than a live connection.' : '',
    plan.moderators
      ? `• **Moderators** is where you add your ${plan.moderators}, set their shifts across time zones, and turn their activity into pay.`
      : '• **Moderators** is where you add your team, set shifts and turn activity into pay.',
    '',
    `Next step: connect ${connectable.length > 0 ? connectable.map((p) => p.label).join(' and ') : 'your platforms'} — you’ll need a bot token for each. I can walk you through it.`,
  ].filter(Boolean)

  return {
    content: lines.join('\n'),
    actions: [
      { label: 'Connect platforms', to: '/dashboard/integrations' },
      { label: 'Add moderators', to: '/dashboard/moderators' },
      { label: 'Setup guides', to: '/dashboard/instructions' },
    ],
  }
}

function scoreKeys(text: string, keys: string[]): number {
  let s = 0
  for (const k of keys) if (text.includes(k)) s += k.length // longer match = stronger
  return s
}

/** Local, deterministic reply. Never invents data; routes + explains. */
export function respond(input: string): ChatReply {
  const text = ` ${input.toLowerCase().trim()} `
  if (!input.trim()) return { content: 'Go ahead — I can take you to a section or explain what Catch tracks.' }

  // A workspace description wins over keyword routing: it's the onboarding path.
  const plan = parseSetupPrompt(input)
  if (plan) return setupReply(plan)

  // Explicit navigation intent.
  const wantsNav = /\b(vai|apri|mostra|porta(mi)?|va(i)? a|open|go to|show|take me)\b/.test(text)

  // Best knowledge-base match.
  let bestKb: { answer: string; actions?: ChatAction[] } | null = null
  let bestKbScore = 0
  for (const entry of KB) {
    const sc = scoreKeys(text, entry.keys)
    if (sc > bestKbScore) { bestKbScore = sc; bestKb = entry }
  }

  // Best navigation match.
  let bestNav: { label: string; to: string } | null = null
  let bestNavScore = 0
  for (const n of NAV) {
    const sc = scoreKeys(text, n.keys)
    if (sc > bestNavScore) { bestNavScore = sc; bestNav = n }
  }

  if (wantsNav && bestNav) {
    return { content: `Taking you to **${bestNav.label}**.`, actions: [{ label: `Open ${bestNav.label}`, to: bestNav.to }] }
  }
  if (bestKb && bestKbScore >= bestNavScore) {
    return { content: bestKb.answer, actions: bestKb.actions }
  }
  if (bestNav) {
    return { content: `Want to open **${bestNav.label}**?`, actions: [{ label: `Open ${bestNav.label}`, to: bestNav.to }] }
  }
  if (GREETING.test(input.trim())) {
    return { content: KB[0].answer, actions: KB[0].actions } // help
  }
  return {
    content:
      'I don’t have a ready answer. I can: take you to a section ("open moderators"), explain what a platform tracks ("what does Telegram do?") or how to connect it ("how do I connect Discord?").',
  }
}

/** Suggestion chips shown when the panel opens. */
export const CHAT_SUGGESTIONS: string[] = [
  'What can you do?',
  'How do I connect Discord?',
  'What does Telegram track?',
  'Open moderators',
  'How does compensation work?',
]
