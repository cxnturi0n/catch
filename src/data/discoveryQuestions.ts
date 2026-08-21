// Discovery questionnaire — Web3 community interview framework.
//
// The form routes each respondent to ONE of five short variants based on a
// single start question ("Which option best describes your work?"). Each variant
// is 10 plain-English questions, aimed at a ~10-15 minute fill.
//
// Questions are either free text or quick-select (chips / ranges / a platform
// matrix) with an optional detail note, so people can answer common questions
// fast.
//
// The JSONB `answers` blob stored in discovery_responses is keyed by question
// `id`, so THESE IDS MUST STAY STABLE once responses have been collected. A
// quick-select question's detail note is stored under `id + NOTE_SUFFIX`, and its
// selected platforms under `id + PLATFORMS_SUFFIX`. The selected variant is
// stored under the reserved key `variant`. You can freely edit `text` / `label` /
// `choices`, but do not rename an existing `id`.

export type DiscoveryVariant = 'freelance' | 'fulltime' | 'agency' | 'founder' | 'investor'

/** Reserved answers key that records which variant the respondent picked. */
export const VARIANT_KEY = 'variant'

/** Detail-note answers for a quick-select question are stored under `id + NOTE_SUFFIX`. */
export const NOTE_SUFFIX = '__note'

/** Selected platforms for a question are stored under `id + PLATFORMS_SUFFIX`. */
export const PLATFORMS_SUFFIX = '__platforms'

export interface DiscoveryQuestion {
  id: string
  text: string
  /** If set, the question shows selectable chips instead of a plain textarea. */
  choices?: string[]
  /** Allow selecting more than one chip (default: single-select). */
  multi?: boolean
  /** If set, show a multi-select platform matrix under the question. */
  platforms?: string[]
  /** If set, show an optional free-text detail box with this placeholder. */
  notePlaceholder?: string
}

export interface DiscoveryVariantDef {
  id: DiscoveryVariant
  /** Short label shown as an option on the start question. */
  label: string
  /** One-line helper under the label. */
  hint: string
  questions: DiscoveryQuestion[]
}

export const START_QUESTION = 'Which option best describes your work?'

const SIZE_CHOICES = ['Under 1k', '1k–10k', '10k–50k', '50k–200k', '200k+']

// Community platforms — most common in Web3 first, then the wider set.
export const PLATFORM_CHOICES = [
  'X',
  'Telegram',
  'Discord',
  'Instagram',
  'TikTok',
  'YouTube',
  'Reddit',
  'Farcaster',
  'LinkedIn',
  'Twitch',
  'Medium',
  'Mirror',
  'Lens',
  'Facebook',
  'WhatsApp',
  'Other',
]

export const DISCOVERY_VARIANTS: DiscoveryVariantDef[] = [
  {
    id: 'freelance',
    label: 'Freelance community manager',
    hint: 'You work with more than one client.',
    questions: [
      { id: 'fl_clients', text: 'How many clients do you work with right now, and on which platforms?', choices: ['Just 1', '2–5', '6–10', '10+'], platforms: PLATFORM_CHOICES },
      { id: 'fl_tools', text: 'Which tools do you use every day to stay organized (tasks, notes, calendar, metrics)?' },
      { id: 'fl_pain', text: 'Which part of your week takes the most time or causes the most stress?' },
      { id: 'fl_switching', text: 'When you work with many clients, how do you organize your time for each one of them?' },
      { id: 'fl_reporting', text: 'How do you send reports to clients? Which format do you use, how long does one report take, and who reads the metrics besides you?' },
      { id: 'fl_metrics', text: 'How do you collect the metrics (KPIs) from each platform for one client? Is there a metric you would like to have but cannot get today?' },
      { id: 'fl_bots', text: 'Do you use bots in your daily work?', choices: ['Yes', 'No'], notePlaceholder: 'If yes, which ones?' },
      { id: 'fl_kol', text: 'Do you run KOL or ambassador campaigns?', choices: ['Yes', 'No'], notePlaceholder: 'If yes, how do you follow their results?' },
      { id: 'fl_relationship', text: 'Who do you report to at each client, and how do you keep that relationship strong?' },
      { id: 'fl_dream', text: 'If you had the budget for the perfect tool, what would it do that no tool does today?' },
    ],
  },
  {
    id: 'fulltime',
    label: 'Full-time community manager',
    hint: 'You work for one project or company.',
    questions: [
      { id: 'ft_community', text: 'How big is the community you manage, and on which platforms?', choices: SIZE_CHOICES, platforms: PLATFORM_CHOICES },
      { id: 'ft_tools', text: 'Which tools does your team use to work together (for example, Discord, Notion, Slack, or Trello)?' },
      { id: 'ft_pain', text: 'Which part of your week takes the most time or causes the most stress?' },
      { id: 'ft_coverage', text: 'How do you keep the community covered 24/7 across time zones? How do you hand over work from one shift to the next?' },
      { id: 'ft_reporting', text: 'How do you report inside the team? Which format do you use, how long does it take, and who reads the metrics?' },
      { id: 'ft_metrics', text: 'How do you collect the metrics (KPIs) from each platform for your community? Is there a metric you would like to have but cannot get today?' },
      { id: 'ft_bots', text: 'Do you use bots in your daily work?', choices: ['Yes', 'No'], notePlaceholder: 'If yes, which ones?' },
      { id: 'ft_kol', text: 'Do you run KOL or ambassador campaigns?', choices: ['Yes', 'No'], notePlaceholder: 'If yes, how do you follow their results?' },
      { id: 'ft_relationship', text: 'Who do you report to (founder or team lead), and how do you keep that relationship strong?' },
      { id: 'ft_dream', text: 'If you had the budget for the perfect tool, what would it do that no tool does today?' },
    ],
  },
  {
    id: 'agency',
    label: 'Agency',
    hint: 'You manage several clients, usually with a team.',
    questions: [
      { id: 'ag_scale', text: 'How many clients do you work with, and on which platforms?', choices: ['1–5', '6–15', '16–30', '30+'], platforms: PLATFORM_CHOICES, notePlaceholder: 'How big is your team?' },
      { id: 'ag_tools', text: 'Which tools does your team use to work together and stay organized across all your clients?' },
      { id: 'ag_bottleneck', text: 'What is the biggest thing that slows you down as you grow?' },
      { id: 'ag_moderators', text: 'How do you find, train, and manage moderators? How do you cover shifts 24/7?' },
      { id: 'ag_reporting', text: 'How does client reporting work? Which format do you use, how long does one report take, and who reads the metrics?' },
      { id: 'ag_metrics', text: 'How do you bring together the metrics (KPIs) from many clients and platforms? Is there a metric you would like to have but cannot get today?' },
      { id: 'ag_bots', text: 'Do you or your moderators use bots every day?', choices: ['Yes', 'No'], notePlaceholder: 'If yes, which ones?' },
      { id: 'ag_kol', text: 'Do you run KOL or ambassador campaigns for clients?', choices: ['Yes', 'No'], notePlaceholder: 'If yes, how do you follow and measure their results?' },
      { id: 'ag_relationship', text: 'Who is your main contact at each client, and how do you keep those relationships strong?' },
      { id: 'ag_dream', text: 'If you had the budget for the perfect tool, what would it do that no tool does today?' },
    ],
  },
  {
    id: 'founder',
    label: 'Founder / core team',
    hint: 'You are building a project.',
    questions: [
      { id: 'fnd_building', text: 'What stage are you at?', choices: ['Idea', 'Testnet', 'Live', 'Scaling'], notePlaceholder: 'What are you building, and on which chain(s)?' },
      { id: 'fnd_community', text: 'How big is your community today, and on which platforms?', choices: SIZE_CHOICES, platforms: PLATFORM_CHOICES },
      { id: 'fnd_who_runs', text: 'Who runs your community day to day?', choices: ['In-house team', 'Agency', 'Freelancers', 'Just me'], multi: true, notePlaceholder: 'Anything to add? (optional)' },
      { id: 'fnd_hardest', text: 'What is the hardest part of growing and keeping your community active?' },
      { id: 'fnd_health', text: 'How do you know if your community is healthy? Which metrics (KPIs) do you look at?' },
      { id: 'fnd_safety', text: 'How do you protect your community from scams and bad actors?' },
      { id: 'fnd_campaigns', text: 'Do you run KOL, ambassador, or quest campaigns?', choices: ['Yes', 'No'], notePlaceholder: 'If yes, how do you know if they work?' },
      { id: 'fnd_tools', text: 'Which tools do you pay for today to manage community and marketing?' },
      { id: 'fnd_trust', text: 'What would make you trust an outside tool or team with your community?' },
      { id: 'fnd_dream', text: 'If you had the perfect tool for community and growth, what would it do?' },
    ],
  },
  {
    id: 'investor',
    label: 'Investor / fund',
    hint: 'You invest in projects.',
    questions: [
      { id: 'inv_focus', text: 'What stage do you invest in?', choices: ['Pre-seed', 'Seed', 'Series A+'], multi: true, notePlaceholder: 'Which chains and sectors? (DeFi, gaming, infrastructure…)' },
      { id: 'inv_weight', text: 'When you look at a project, how much does the strength of its community affect your decision?', choices: ['Not much', 'Somewhat', 'A lot', 'It’s decisive'], notePlaceholder: 'Why? (optional)' },
      { id: 'inv_realcheck', text: 'How do you check if a community is real and not bots or paid hype?' },
      { id: 'inv_signals', text: 'Which signals tell you a community is growing in a healthy way?' },
      { id: 'inv_redflags', text: "What are the biggest red flags you see in a project's community or marketing?" },
      { id: 'inv_support', text: 'Do you help portfolio projects with community and growth after investing?', choices: ['Yes', 'No'], notePlaceholder: 'If yes, how?' },
      { id: 'inv_tools', text: "Which tools or data sources do you use to track a project's traction?" },
      { id: 'inv_data_gap', text: 'Which community or growth metrics (KPIs) do you wish you had but cannot get today?' },
      { id: 'inv_compare', text: 'How do you compare two projects that look similar on paper?' },
      { id: 'inv_dream', text: "If a tool could show you the real health of any project's community, what would you want to see?" },
    ],
  },
]

export const QUESTIONS_PER_VARIANT = 10

export function getVariant(id: DiscoveryVariant): DiscoveryVariantDef {
  const found = DISCOVERY_VARIANTS.find((v) => v.id === id)
  if (!found) throw new Error(`Unknown discovery variant: ${id}`)
  return found
}
