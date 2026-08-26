import {
  AtSign,
  BarChart2,
  CheckSquare,
  FileText,
  FolderOpen,
  Gem,
  MessageSquare,
  Plug,
  Rocket,
  Send,
  Star,
  Trophy,
  Users,
  Vote,
  type LucideIcon,
} from 'lucide-react'

// Detailed, click-through setup guides shown as a grid in Instructions › Integrations.
export interface PlatformSetup {
  key: string
  name: string
  icon: LucideIcon
  tagline: string
  status: 'live' | 'csv' | 'soon'
  steps: string[]
  paste?: string
}

export const PLATFORM_SETUP: PlatformSetup[] = [
  {
    key: 'discord',
    name: 'Discord',
    icon: MessageSquare,
    tagline: 'Bot Token + Server ID',
    status: 'live',
    steps: [
      'Go to discord.com/developers/applications and log in.',
      'Open your bot application (or click "New Application" and give it a name).',
      'In the left menu click "Bot". Under Token, click "Reset Token" → confirm → "Copy". This is your Bot Token, keep it safe.',
      'Still under "Bot", scroll to Privileged Gateway Intents and enable "Server Members Intent" and "Message Content Intent" (free for bots in fewer than 100 servers). They give real time joins and leaves and the message text used by the AI features.',
      'In the left menu click "OAuth2" → "URL Generator". Under Scopes, tick "bot".',
      'Under Bot Permissions, tick: View Channels, Read Message History, and View Audit Log (needed for bans, kicks and timeouts per moderator).',
      'Copy the generated URL at the bottom, open it in your browser, pick your server, and click "Authorize".',
      'In the Discord app: User Settings (⚙️) → Advanced → turn on "Developer Mode".',
      'Right-click your server name (top-left) → "Copy Server ID".',
      'Back in Catch → Integrations → Discord → Connect. Paste the Bot Token and the Server ID, then click Connect. Catch imports the last 30 days of messages and then keeps a live connection to the server.',
    ],
    paste: 'You paste into Catch: Bot Token + Server ID.',
  },
  {
    key: 'telegram',
    name: 'Telegram',
    icon: Send,
    tagline: 'Bot Token + Chat ID',
    status: 'live',
    steps: [
      'Open Telegram and search for "@BotFather" (the official one, with the blue check).',
      'Send /newbot, choose a display name, then a username that ends in "bot".',
      'BotFather replies with your Bot Token (a long string like 123456:ABC...). Copy it.',
      'Open your group → add your new bot as a member.',
      'Make the bot an Admin of the group (required to read the member count and to receive every message).',
      'If you prefer not to make it an admin, send /setprivacy to @BotFather, pick the bot and choose Disable, otherwise the bot only sees commands.',
      'Get the Chat ID: temporarily add "@RawDataBot" to the group, it posts the group id (a negative number like -1001234567890). Copy it, then remove that bot. A public group can also be entered as @username.',
      'Back in Catch → Integrations → Telegram → Connect. Paste the Bot Token and the Chat ID, then click Connect. Catch registers the webhook by itself; for public groups it also imports the last 30 days of history.',
    ],
    paste: 'You paste into Catch: Bot Token + Chat ID.',
  },
  {
    key: 'twitter',
    name: 'Twitter / X',
    icon: AtSign,
    tagline: 'Manual CSV import',
    status: 'csv',
    steps: [
      'X has no free API, so data is imported manually (takes 1 minute).',
      'Go to analytics.twitter.com and log in.',
      'Click the "Tweets" tab.',
      'Set the date range (up to 90 days).',
      'Click "Export data" → "By tweet" to download the CSV.',
      'In Catch → Analytics → scroll to the X Analytics section → click "Import CSV" and upload the file.',
      'Your impressions, engagements, likes and retweets appear immediately.',
    ],
  },
  {
    key: 'zealy',
    name: 'Zealy',
    icon: Trophy,
    tagline: 'Community Subdomain + API Key',
    status: 'live',
    steps: [
      'Log in to zealy.io as an admin of your community.',
      'Open your community, then go to Settings → API (the "API keys" section).',
      'Click "Create API key", give it a name, and copy the key, Zealy shows it only once, so store it safely.',
      'Find your community subdomain: it’s the slug in your Zealy URL, zealy.io/cw/<subdomain> (e.g. "arbitrum").',
      'Back in Catch → Integrations → Zealy → Connect. Paste the Community Subdomain and the API Key, then click Connect.',
    ],
    paste: 'You paste into Catch: Community Subdomain + API Key.',
  },
  {
    key: 'galxe',
    name: 'Galxe',
    icon: Gem,
    tagline: 'Space Alias (public, no key)',
    status: 'live',
    steps: [
      'Open galxe.com and go to your project’s Space page.',
      'Your Space alias is the last part of the Space URL: galxe.com/<alias> (e.g. galxe.com/optimism → the alias is "optimism").',
      'No API key is needed, Catch reads public Space stats (followers, active campaigns, participants).',
      'Back in Catch → Integrations → Galxe → Connect. Paste the Space Alias, then click Connect.',
    ],
    paste: 'You paste into Catch: Space Alias.',
  },
  { key: 'snapshot', name: 'Snapshot', icon: Vote, tagline: 'Coming soon', status: 'soon', steps: ['Live connection coming soon. You’ll enter your Space ENS, e.g. arbitrum.eth.'] },
]

export interface MetricExplained {
  name: string
  what: string
  how: string
  why: string
}

export interface ExplainedItem {
  name: string
  description: string
}

export interface InstructionSection {
  key: string
  icon: LucideIcon
  navLabel: string
  navDescription: string
  intro: string
  howToUseTitle: string
  steps: string[]
  metricsTitle?: string
  metrics?: MetricExplained[]
  explainedTitle?: string
  explainedItems?: ExplainedItem[]
  proTips: string[]
}

export const INSTRUCTION_SECTIONS: InstructionSection[] = [
  {
    key: 'getting-started',
    icon: Rocket,
    navLabel: 'Getting Started',
    navDescription: 'How to set up Catch and onboard your first client',
    intro:
      'Catch is built for freelance and agency community managers managing multiple Web3 clients simultaneously. One login, one dashboard, every client workspace kept cleanly separate.',
    howToUseTitle: 'How to use it',
    steps: [
      'Create your account',
      'Complete onboarding',
      'Add your first workspace/client',
      'Connect your platforms via Integrations',
      'Build your team in Team → Moderators',
      'Plan work in Operations → Task Manager and track KOLs',
    ],
    proTips: [
      'Create one workspace per client, never mix data across clients.',
      'Connect integrations before inviting moderators, so live stats are ready when your team joins.',
      'Use the Report module to send weekly updates to clients from day one.',
    ],
  },
  {
    key: 'analytics',
    icon: BarChart2,
    navLabel: 'Community Analytics',
    navDescription: 'Understanding your community metrics',
    intro: 'Community Analytics gives you a real-time view of each client’s community health. The Overview aggregates every connected platform; each platform you connect also appears automatically as its own entry under Community Analytics.',
    howToUseTitle: 'How to use it',
    steps: [
      'Open "Overview" for the aggregated dashboard across all platforms, with dynamic Platform / Metric / Range filters.',
      'Each connected platform (Discord, Telegram, Zealy, Galxe…) shows up on its own under Community Analytics, no setup, it appears the moment you connect it in Integrations.',
      'Windows adapt to the data you actually hold: 1h / 5h use hourly snapshots, 24h / 7d / 30d use the daily rollup.',
    ],
    metricsTitle: 'Metrics explained',
    metrics: [
      {
        name: 'Active Members',
        what: 'Unique users who sent at least one message in the selected period.',
        how: 'Counted from the messages Catch collects live from Discord (gateway) and Telegram (webhook), plus the 30 day import at connect time.',
        why: 'Primary indicator of real community engagement vs. passive membership.',
      },
      {
        name: 'Messages This Week',
        what: 'Total messages sent across connected platforms.',
        how: 'Summed from Discord channel and thread messages and Telegram group messages. Text is stored encrypted for 30 days for the AI features, then deleted; the counts stay.',
        why: 'Measures conversation volume and content activity level.',
      },
      {
        name: 'New Members',
        what: 'Net new joins in the period.',
        how: 'Telegram: join and leave events from the bot webhook. Discord: live member events from the gateway when the Server Members Intent is on, otherwise membership snapshots.',
        why: 'Measures community growth rate and acquisition effectiveness.',
      },
      {
        name: 'Retention & tenure',
        what: 'How long members stay, and how many recent joiners are still around.',
        how: 'Built from Discord member tenure + membership snapshots over time.',
        why: 'Growth means little if members churn, retention shows real stickiness.',
      },
      {
        name: 'Period-over-period %',
        what: 'Comparison vs. the previous equivalent period.',
        how: 'Current period value compared against the prior period of equal length.',
        why: 'Green means improvement, red means decline, quick health signal at a glance.',
      },
    ],
    proTips: [
      'A sudden drop in active members often signals a bad news event, investigate immediately.',
      'Spikes in scam alerts often precede market volatility, treat them as an early warning.',
      'Share analytics screenshots directly in client reports for extra credibility.',
    ],
  },
  {
    key: 'moderators',
    icon: Users,
    navLabel: 'Moderators',
    navDescription: 'Your team hub, directory, analytics, payments, reports, leaderboard',
    intro: 'Everything about your team lives here, split into tabs: Directory, Analytics, Payments, Reports and Leaderboard. Under the Team group alongside KOLs.',
    howToUseTitle: 'How to use it',
    steps: [
      'Directory: add moderators with handles, timezone and shift; click a row to open the full profile (bio, skills, CV).',
      'Analytics: performance, punctuality vs assigned shifts, response rate, and the activity heatmap for planning coverage.',
      'Payments: set point values per metric and a points→currency rate, then track earnings and the salary log.',
      'Reports: per-moderator drill-downs. Leaderboard: your most active contributors at a glance.',
    ],
    metricsTitle: 'Metrics explained',
    metrics: [
      {
        name: 'Shift Coverage %',
        what: 'Shifts completed vs. shifts assigned.',
        how: 'Completed shifts divided by assigned shifts, as a percentage.',
        why: 'Below 80% requires attention, it signals scheduling or reliability problems.',
      },
      {
        name: 'Avg Response Time',
        what: 'How quickly the moderator answers members.',
        how: 'Per channel, the first moderator message within 60 minutes after a member message counts as its answer (a reply targets that message). Computed nightly from collected messages.',
        why: 'Target under 5 minutes, slow answers let questions and scams sit unattended.',
      },
      {
        name: 'Bans Executed',
        what: 'Total bans and kicks performed by the moderator (timeouts and mutes are shown next to it).',
        how: 'Discord audit log (the bot needs View Audit Log) and Telegram admin actions, attributed through the linked platform user id or the handle.',
        why: 'Shows enforcement activity and workload distribution across the team.',
      },
      {
        name: 'Rating',
        what: 'Overall performance score for the moderator.',
        how: 'Auto-calculated from coverage rate and warning count.',
        why: '5.0 is a perfect score, use it to spot who needs support or recognition.',
      },
    ],
    proTips: [
      'Always build overlap between shifts so handoffs don’t drop context.',
      'Night shift is hardest to fill, consider volunteers in Asian timezones.',
    ],
  },
  {
    key: 'kol',
    icon: Star,
    navLabel: 'KOL Tracker',
    navDescription: 'Tracking ambassadors and influencers',
    intro: 'Your ambassador CRM. Every KOL relationship lives here, status, reach, last contact, notes.',
    howToUseTitle: 'How to use it',
    steps: [
      'Add KOLs as you onboard them, with their channel and reach.',
      'Update status after each campaign wraps.',
      'Sort by reach to prioritize outreach for upcoming campaigns.',
    ],
    explainedTitle: 'Status explained',
    explainedItems: [
      { name: 'Active', description: 'Currently running campaigns with this KOL.' },
      { name: 'Pending', description: 'In negotiation or onboarding, not yet confirmed.' },
      { name: 'Inactive', description: 'Past relationship, not currently engaged.' },
    ],
    proTips: [
      'Add notes after every interaction, memory fades fast across dozens of KOLs.',
      'Track reach carefully, vanity metrics vs. real engagement differ widely in Web3.',
    ],
  },
  {
    key: 'tasks',
    icon: CheckSquare,
    navLabel: 'Task Manager',
    navDescription: 'Table, board and time-blocked calendar in one place',
    intro: 'Plan and track work across your team from one place, as a table, a board, or a time-blocked calendar.',
    howToUseTitle: 'How to use it',
    steps: [
      'The default table has Area, To do, Status, Assignee, Start date and Due date, click a column header arrow to sort by it.',
      'Assign work to yourself or anyone on the team, assignees are not limited to moderators.',
      'Switch to Board or Calendar, or drag the divider between the two panes for an adjustable split view.',
      'The calendar is time-blocked in 30-minute slots; use the filter to show Tasks, Meetings, or both.',
    ],
    explainedTitle: 'Views explained',
    explainedItems: [
      { name: 'Table', description: 'Sortable columns (Area, To do, Status, Assignee, Start, Due), the fastest way to scan everything.' },
      { name: 'Board', description: 'Kanban columns by status, drag work forward as it progresses.' },
      { name: 'Calendar', description: 'Day/week grid in 30-minute slots. Tasks and meetings appear at their times; filter between them.' },
      { name: 'Split view', description: 'Drag the divider between table/board and calendar to size each pane however you like.' },
    ],
    proTips: [
      'Use the Area column to group work by client, campaign or workstream.',
      'Block calendar time in 30-minute slots during launch windows, that’s when things slip.',
    ],
  },
  {
    key: 'resources',
    icon: FolderOpen,
    navLabel: 'Resources',
    navDescription: 'Playbooks, SOPs, templates and knowledge for your team',
    intro: 'Your workspace knowledge drive. Organize playbooks, SOPs, templates, meeting notes and marketing material into sections that behave like folders.',
    howToUseTitle: 'How to use it',
    steps: [
      'Click "+ New resource" → "New section", pick a type (Playbook, SOP, Template, Meeting notes, Marketing material, and more) to create a folder.',
      'Open a folder and import files (or add links) inside it, each folder shows a live file count.',
      'Switch between Grid, List and By-type views from the top-right; search and category filters narrow things down.',
      'Pin the folders your team needs most so they sit at the top.',
    ],
    proTips: [
      'Keep one SOP folder per recurring workflow, onboarding, incident response, reporting.',
      'Drop the anti-scam playbook and shift roster where the whole team can find them fast.',
    ],
  },
  {
    key: 'report',
    icon: FileText,
    navLabel: 'Report',
    navDescription: 'Generating and sharing client reports',
    intro: 'Generate your weekly client report in seconds instead of hours.',
    howToUseTitle: 'How to use it',
    steps: [
      'Select the workspace you want to report on.',
      'Click Generate Report and let Catch pull the week’s data together.',
      'Review the output, then share it via email or Telegram.',
    ],
    explainedTitle: 'Report sections explained',
    explainedItems: [
      { name: 'Executive Summary', description: 'A one-paragraph overview written for busy founders.' },
      { name: 'Community Growth', description: 'Member and message metrics for the period, pulled live from connected platforms.' },
      { name: 'Moderator Activity', description: 'What each moderator did, from the points/compensation engine.' },
      { name: 'Shift Coverage', description: 'Optional toggle, flags high-traffic hours with no moderator on shift.' },
      { name: 'KOL Activity', description: 'Ambassador highlights and campaign notes.' },
      { name: 'Payments & Tasks', description: 'Salary log and team productivity across the reporting window.' },
    ],
    proTips: [
      'Send reports every Monday morning, consistency builds client trust.',
      'Turn on the Shift Coverage analysis to show clients where you need more hands.',
      'Save reports to History for reference during renewal conversations.',
    ],
  },
  {
    key: 'integrations',
    icon: Plug,
    navLabel: 'Integrations',
    navDescription: 'Connecting Discord, Telegram and other platforms',
    intro: 'Connect your clients’ platforms to pull live data into Catch automatically.',
    howToUseTitle: 'How to use it',
    steps: [
      'Open the Integrations tab for the workspace you want to connect.',
      'Choose a platform, follow its setup steps below, and paste in the credentials.',
      'Once connected, data flows on its own: Discord through a live gateway connection, Telegram through a webhook, metrics every minute. Sync Now forces a fresh pull.',
    ],
    explainedTitle: 'How to use per platform',
    explainedItems: [
      {
        name: 'Discord',
        description:
          'Create a bot at discord.com/developers, enable the Server Members and Message Content intents, copy the Bot Token and Server ID, and paste them into Catch. The bot must be added to the server with View Channels, Read Message History and View Audit Log. Catch imports 30 days of history and then listens live.',
      },
      {
        name: 'Telegram',
        description: 'Create a bot via @BotFather, get the Bot Token, add the bot to the group as admin (or disable privacy mode), then paste the Chat ID into Catch. The webhook is registered automatically; public groups get a 30 day history import.',
      },
      {
        name: 'X / Twitter (CSV Import)',
        description:
          'X does not offer a free API. Instead, export your tweet analytics as a CSV: go to analytics.twitter.com → click the "Tweets" tab → set your date range (up to 90 days) → click "Export data" → select "By tweet". Then open the Analytics page in Catch, scroll to the X Analytics section and click "Import CSV" to upload the file. Your impressions, engagements, likes and retweets will appear immediately.',
      },
      {
        name: 'Zealy',
        description:
          'Copy your API key from the Zealy dashboard → Settings → API, and grab your community subdomain from your Zealy URL (zealy.io/cw/<subdomain>). Paste both into Catch to pull member count, total XP and the top questers.',
      },
      {
        name: 'Galxe',
        description:
          'Grab your Space alias from your Galxe URL (galxe.com/<alias>) and paste it into Catch, no API key needed. Catch reads public Space stats: followers, active campaigns and total participants.',
      },
      { name: 'Snapshot', description: 'Enter your Space ENS, e.g. arbitrum.eth.' },
    ],
    proTips: [
      'Ask clients to add the bot themselves, send them a one-page setup guide instead of asking for raw tokens.',
      'Reconnect integrations if a token expires, some platforms rotate tokens as often as every 90 days.',
    ],
  },
]
