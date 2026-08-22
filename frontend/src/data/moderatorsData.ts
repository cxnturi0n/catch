import type { Moderator, WorkspaceId } from '../types'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** No seeded moderators: every workspace starts empty. */
export function getModerators(_id: WorkspaceId): Moderator[] {
  return []
}

export function initials(name: string): string {
  return initialsOf(name)
}
