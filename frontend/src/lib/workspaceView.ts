import type { Workspace } from '../types'

// Presentation helpers for workspaces (avatar colours, short labels). Pure.
const COLOR_PAIRS: Array<[string, string]> = [
  ['#7c3aed', '#06b6d4'],
  ['#06b6d4', '#10b981'],
  ['#10b981', '#7c3aed'],
  ['#7c3aed', '#10b981'],
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function shortNameFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'NW'
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export interface ApiWorkspace {
  id: string
  name: string
  projectType: string | null
  communitySize: string | null
  platforms: string[]
  role: string
  createdAt: string
  updatedAt: string
}

export function toWorkspace(row: ApiWorkspace): Workspace & { role: string; platforms: string[] } {
  const [colorFrom, colorTo] = COLOR_PAIRS[hashString(row.id) % COLOR_PAIRS.length]
  return { id: row.id, name: row.name, shortName: shortNameFor(row.name), colorFrom, colorTo, role: row.role, platforms: row.platforms }
}
