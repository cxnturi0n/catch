// Derives the Community Manager's real notification feed from workspace data.
// Today it surfaces shift punctuality (no-shows + late arrivals); the shape is
// deliberately generic so other sources (scam spikes, sentiment drops, quota)
// can be folded in later.

import type { Moderator, ModeratorShiftEvent } from '../types'

export type NotificationKind = 'no_show' | 'late' | 'info'
export type NotificationSeverity = 'high' | 'medium' | 'low'

export interface AppNotification {
  id: string
  kind: NotificationKind
  severity: NotificationSeverity
  title: string
  detail: string
  /** ISO timestamp the event is anchored to — used for ordering + relative time. */
  at: string
}

function nameFor(moderators: Moderator[], moderatorId: string): string {
  return moderators.find((m) => m.id === moderatorId)?.fullName ?? 'A moderator'
}

/**
 * Turns shift events into no-show / late notifications.
 *
 *  • no_show → the shift's expected end has passed and the moderator never
 *    showed any activity (firstActivityUtc is null).
 *  • late    → the moderator did show up, but outside the on-time window
 *    (wasOnTime === false).
 *
 * A shift still in progress with no activity yet is NOT flagged (the moderator
 * may still be about to start), so we require expectedEnd < now for no-shows.
 */
export function buildShiftNotifications(
  events: ModeratorShiftEvent[],
  moderators: Moderator[],
  now: Date = new Date(),
): AppNotification[] {
  const nowMs = now.getTime()
  const out: AppNotification[] = []

  for (const ev of events) {
    const name = nameFor(moderators, ev.moderatorId)
    const endMs = new Date(ev.expectedEndUtc).getTime()
    const startLabel = new Date(ev.expectedStartUtc).toLocaleString(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

    if (ev.firstActivityUtc === null && endMs < nowMs) {
      out.push({
        id: `noshow-${ev.moderatorId}-${ev.day}`,
        kind: 'no_show',
        severity: 'high',
        title: `${name} missed their shift`,
        detail: `No activity during the ${startLabel} shift on any assigned platform.`,
        at: ev.expectedEndUtc,
      })
    } else if (ev.wasOnTime === false && ev.firstActivityUtc !== null) {
      const firstLabel = new Date(ev.firstActivityUtc).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
      out.push({
        id: `late-${ev.moderatorId}-${ev.day}`,
        kind: 'late',
        severity: 'medium',
        title: `${name} was late to their shift`,
        detail: `Shift started ${startLabel}; first activity at ${firstLabel}.`,
        at: ev.firstActivityUtc,
      })
    }
  }

  // Most recent first.
  out.sort((a, b) => (a.at < b.at ? 1 : -1))
  return out
}
