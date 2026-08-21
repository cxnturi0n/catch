// Per-macro-section first-visit tutorial copy.
//
// Each entry is keyed by a stable `id` and matched against the current route by
// `pathPrefix` (longest prefix wins, so more specific routes take precedence).
// Blurbs are intentionally short — 1-2 plain sentences in CM-facing language —
// so the pop-up reads in a couple of seconds and never gets in the way.

export interface TutorialEntry {
  /** Stable id — also the localStorage suffix: `catch:tutorial:<id>`. */
  id: string
  /** Pathname prefix this tutorial applies to. */
  pathPrefix: string
  /** Short section name shown as the pop-up heading. */
  title: string
  /** 1-2 short sentences explaining what the section is for. */
  blurb: string
}

export const TUTORIAL_ENTRIES: TutorialEntry[] = [
  {
    id: 'analytics',
    pathPrefix: '/dashboard/analytics',
    title: 'Community Analytics',
    blurb:
      'Track your community across every connected platform. The Overview aggregates all platforms; each connected platform also gets its own view automatically.',
  },
  {
    id: 'report',
    pathPrefix: '/dashboard/report',
    title: 'Report',
    blurb:
      'Generate branded one-pager reports in seconds. Pick a report type and date range, add the shift-coverage analysis, then optionally email it out.',
  },
  {
    id: 'moderators',
    pathPrefix: '/dashboard/moderators',
    title: 'Moderators',
    blurb:
      'Your team hub, in tabs: Directory, Analytics (performance + shifts), Payments (points → salary), Reports and Leaderboard.',
  },
  {
    id: 'tasks',
    pathPrefix: '/dashboard/tasks',
    title: 'Task Manager',
    blurb:
      'Plan work in a table, board, or time-blocked calendar — drag the divider for a split view. Filter the calendar between tasks and meetings.',
  },
  {
    id: 'resources',
    pathPrefix: '/dashboard/resources',
    title: 'Resources',
    blurb:
      'Organize playbooks, SOPs, templates and more into sections that work like folders. Import files inside each folder; pin the important ones.',
  },
  {
    id: 'kol',
    pathPrefix: '/dashboard/kol',
    title: 'KOLs',
    blurb:
      'Keep tabs on the influencers you work with — their reach, engagement and current status.',
  },
  {
    id: 'integrations',
    pathPrefix: '/dashboard/integrations',
    title: 'Integrations',
    blurb:
      'Connect Discord, Telegram, Galxe and Zealy to pull your community data into Catch.',
  },
  {
    id: 'instructions',
    pathPrefix: '/dashboard/instructions',
    title: 'Catch Instructions',
    blurb:
      'Follow step-by-step guides to connect each platform without guesswork.',
  },
  {
    id: 'catchlab',
    pathPrefix: '/dashboard/catchlab',
    title: 'CatchLab',
    blurb:
      'See what is on the public roadmap and share feedback on where Catch goes next.',
  },
]

/**
 * Resolve the tutorial entry for a given pathname by longest-matching prefix.
 * Returns null when no macro section matches the current route.
 */
export function getTutorialForPath(pathname: string): TutorialEntry | null {
  let best: TutorialEntry | null = null
  for (const entry of TUTORIAL_ENTRIES) {
    if (pathname === entry.pathPrefix || pathname.startsWith(entry.pathPrefix + '/') || pathname.startsWith(entry.pathPrefix)) {
      if (!best || entry.pathPrefix.length > best.pathPrefix.length) best = entry
    }
  }
  return best
}

export const TUTORIAL_KEY_PREFIX = 'catch:tutorial:'
