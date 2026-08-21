// Bespoke, two-tone section glyphs for the sidebar group headers.
//
// These are deliberately NOT lucide/stock icons: each is hand-drawn to read as
// premium and specific to its section. The line-work uses `currentColor`, so it
// inherits the header's text tier (muted → primary on hover); a single filled
// node uses the sapphire accent, giving every glyph a restrained "deluxe" pop
// that stays put regardless of the text color. Kept small and low-detail so
// they're never invasive next to the uppercase label.

import type { ReactElement, SVGProps } from 'react'

interface SectionIconProps {
  size?: number
  className?: string
}

const accent = { fill: 'var(--accent-emerald)' } as const

function base(size: number, className?: string): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    className,
    'aria-hidden': true,
  }
}

/** Community Analytics — an upward pulse with a lit sapphire endpoint node. */
export function AnalyticsGlyph({ size = 15, className }: SectionIconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3.5 19H20.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.32" />
      <path d="M4.6 15.2L8.6 10.8L11.9 13.4L19.4 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="19.4" cy="6" r="2.3" style={accent} />
    </svg>
  )
}

/** Team — three linked members; the lead node is lit in sapphire. */
export function TeamGlyph({ size = 15, className }: SectionIconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8.9 6.6H15.1M8.3 8.6L10.8 14.4M15.7 8.6L13.2 14.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.4" />
      <circle cx="7" cy="6.6" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="6.6" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="16.4" r="2.5" style={accent} />
    </svg>
  )
}

/** Operations — an open dual-arc cycle with sapphire beads at the leading ends. */
export function OperationsGlyph({ size = 15, className }: SectionIconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6 10.2A6.1 6.1 0 0 1 16.4 7.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M18 13.8A6.1 6.1 0 0 1 7.6 16.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16.4" cy="7.3" r="1.7" style={accent} />
      <circle cx="7.6" cy="16.7" r="1.7" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** Setup — an integration hub: a lit core wired out to three connectors. */
export function SetupGlyph({ size = 15, className }: SectionIconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 11.6V4.9M12 11.6L17 16M12 11.6L7 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.42" />
      <circle cx="12" cy="4.4" r="1.8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17.2" cy="16.4" r="1.8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6.8" cy="16.4" r="1.8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="11.6" r="2.5" style={accent} />
    </svg>
  )
}

/** CatchLab — a bespoke flask with sapphire reaction bubbles. */
export function CatchLabGlyph({ size = 15, className }: SectionIconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9.5 3.6H14.5M11 3.6V8.9L6.7 15.9A2.2 2.2 0 0 0 8.6 19.3H15.4A2.2 2.2 0 0 0 17.3 15.9L13 8.9V3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="11.7" cy="15.2" r="1.5" style={accent} />
      <circle cx="14.4" cy="17.4" r="0.95" style={accent} opacity="0.7" />
    </svg>
  )
}

/** Header label → glyph. Keys match the NavGroup labels in Sidebar. */
export const SECTION_GLYPH: Record<string, (p: SectionIconProps) => ReactElement> = {
  'Community Analytics': AnalyticsGlyph,
  Team: TeamGlyph,
  Operations: OperationsGlyph,
  Setup: SetupGlyph,
}
