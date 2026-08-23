import type { ComponentType } from 'react'
import {
  BarChart3,
  BookMarked,
  BookOpen,
  CalendarDays,
  Contact,
  FolderOpen,
  LayoutTemplate,
  ListChecks,
  Megaphone,
  NotebookPen,
  Palette,
} from 'lucide-react'
import type { BadgeTone } from '../../ui/Badge'

interface SectionMeta {
  icon: ComponentType<{ size?: number | string; className?: string }>
  tone: BadgeTone
  /** Solid hex accent for tinted icon tiles / pills, derived from the tone. */
  accent: string
}

/** Bright hex per tone, mirrors the Badge palette so tiles + pills stay cohesive. */
const TONE_HEX: Record<BadgeTone, string> = {
  green: '#34d399',
  emerald: '#2dd4bf',
  cyan: '#38bdf8',
  blue: '#4d9fff',
  indigo: '#818cf8',
  purple: '#a78bfa',
  yellow: '#fbbf24',
  orange: '#fb923c',
  red: '#f87171',
  gray: '#94a3b8',
}

const MAP: Record<string, { icon: SectionMeta['icon']; tone: BadgeTone }> = {
  Playbook: { icon: BookOpen, tone: 'emerald' },
  SOP: { icon: ListChecks, tone: 'cyan' },
  Template: { icon: LayoutTemplate, tone: 'blue' },
  'Meeting notes': { icon: NotebookPen, tone: 'indigo' },
  'Marketing material': { icon: Megaphone, tone: 'purple' },
  'Brand asset': { icon: Palette, tone: 'orange' },
  Reference: { icon: BookMarked, tone: 'green' },
  Schedule: { icon: CalendarDays, tone: 'yellow' },
  Directory: { icon: Contact, tone: 'blue' },
  Report: { icon: BarChart3, tone: 'red' },
}

const FALLBACK = { icon: FolderOpen, tone: 'gray' as BadgeTone }

export function sectionMeta(sectionType: string): SectionMeta {
  const m = MAP[sectionType] ?? FALLBACK
  return { ...m, accent: TONE_HEX[m.tone] }
}
