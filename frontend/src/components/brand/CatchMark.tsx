import { memo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * Catch brand mark, a faceted, crystalline "C": an angular letterform cut into
 * flat planes, with a pale facet catching the light top-left and a deep navy
 * facet falling away bottom-right.
 *
 * Theme handling lives in CSS (`.catch-mark` in index.css), driven by
 * <html data-theme>, so the mark works anywhere without a provider:
 *   night → outer glow, no cast shadow
 *   day   → no glow, projected shadow + stronger dark facet
 *
 * Robustness rule: every facet is fully opaque and visible by default. The only
 * motion is a transform-safe scale-in, so a frozen animation never hides the
 * logo. `play={false}` skips it entirely (sidebar, headers).
 */

// Outer silhouette + the inner mouth, traced as one path.
const C_PATH =
  'M 34 7 L 78 7 L 95 25 L 66 35 L 38 37 L 26 50 L 38 63 L 66 65 L 95 75 L 78 93 L 34 93 L 5 50 Z'
// Upper-left plane, the facet that catches the light.
const FACET_LIGHT = 'M 34 7 L 78 7 L 66 35 L 38 37 L 26 50 L 5 50 Z'
// Lower plane, falls away into shadow.
const FACET_DARK = 'M 26 50 L 38 63 L 66 65 L 95 75 L 78 93 L 34 93 L 5 50 Z'
// The wedge tip of the top arm.
const FACET_TIP = 'M 78 7 L 95 25 L 66 35 Z'
// Four-pointed spark hooked onto the lower facet, the AI signature. It stays
// sapphire even on the gold mark: gold = intelligence, blue = Catch itself.
const SPARK = 'M 88 46 Q 89.5 58.5 101 60 Q 89.5 61.5 88 74 Q 86.5 61.5 75 60 Q 86.5 58.5 88 46 Z'

/** Sapphire = the product. Gold = Catch's own AI assistant. */
export type MarkVariant = 'brand' | 'gold'

const PALETTES: Record<MarkVariant, { body: [string, string]; light: [string, string]; dark: [string, string]; tip: [string, string] }> = {
  brand: {
    body: ['#5C93FF', '#2F6BFF'],
    light: ['#D7E5FF', '#93B8FF'],
    dark: ['#2F6BFF', '#1B3EA8'],
    tip: ['#7FADFF', '#3F7BFF'],
  },
  gold: {
    body: ['#F2CE7A', '#DFAE45'],
    light: ['#FFF3D4', '#F4D892'],
    dark: ['#DCA93E', '#9A6B14'],
    tip: ['#F9E2A8', '#E4BB58'],
  },
}

export const CatchMark = memo(function CatchMark({
  size = 96,
  play = true,
  variant = 'brand',
  className,
}: {
  size?: number
  play?: boolean
  variant?: MarkVariant
  className?: string
}) {
  const reduce = useReducedMotion()
  const animate = play && !reduce
  const p = PALETTES[variant]
  // Suffix every gradient id so a sapphire and a gold mark can coexist on a page.
  const uid = (name: string) => `cm${name}-${variant}`

  return (
    <motion.div
      className={`catch-mark catch-mark--${variant}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, lineHeight: 0 }}
      initial={animate ? { scale: 0.92 } : false}
      animate={animate ? { scale: 1 } : undefined}
      transition={{ type: 'spring', stiffness: 200, damping: 16 }}
    >
      {/* The gold mark carries the spark, which reaches past the letterform, widen its viewBox so it isn't clipped. The sapphire mark is unchanged. */}
      <svg width={size} height={size} viewBox={variant === 'gold' ? '0 0 106 100' : '0 0 100 100'}>
        <defs>
          <linearGradient id={uid('Spark')} x1="75" y1="46" x2="101" y2="74" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7FADFF" />
            <stop offset="1" stopColor="#2F6BFF" />
          </linearGradient>
          <linearGradient id={uid('Body')} x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={p.body[0]} />
            <stop offset="1" stopColor={p.body[1]} />
          </linearGradient>
          <linearGradient id={uid('Light')} x1="10" y1="4" x2="70" y2="52" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={p.light[0]} />
            <stop offset="1" stopColor={p.light[1]} />
          </linearGradient>
          <linearGradient id={uid('Dark')} x1="20" y1="50" x2="90" y2="95" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={p.dark[0]} />
            <stop offset="1" stopColor={p.dark[1]} />
          </linearGradient>
          <linearGradient id={uid('Tip')} x1="66" y1="7" x2="95" y2="35" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={p.tip[0]} />
            <stop offset="1" stopColor={p.tip[1]} />
          </linearGradient>
        </defs>

        {/* Body, the full letterform, so no gap can ever show between facets */}
        <path d={C_PATH} fill={`url(#${uid('Body')})`} />

        {/* Planes: light top-left, deep bottom-right, mid wedge at the arm tip */}
        <path d={FACET_DARK} fill={`url(#${uid('Dark')})`} className="cm-facet-dark" />
        <path d={FACET_LIGHT} fill={`url(#${uid('Light')})`} />
        <path d={FACET_TIP} fill={`url(#${uid('Tip')})`} />

        {/* Crystalline edges between planes */}
        <path d="M 5 50 L 26 50 L 38 37" fill="none" stroke="#FFFFFF" strokeOpacity="0.28" strokeWidth="0.9" strokeLinejoin="round" />
        <path d="M 66 35 L 78 7" fill="none" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="0.9" />

        {/* AI spark, gold mark only, and always Catch sapphire */}
        {variant === 'gold' && <path d={SPARK} fill={`url(#${uid('Spark')})`} className="cm-spark" />}
      </svg>
    </motion.div>
  )
})
