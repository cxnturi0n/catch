import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react'

export interface MetricTooltip {
  what: string
  how: string
  why: string
}

const TOOLTIP_MAX_WIDTH = 200
const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 8
const ARROW_INSET = 12 // keeps the arrow clear of the tooltip's rounded corners

interface TooltipPosition {
  top: number
  left: number
  arrowLeft: number
  placement: 'top' | 'bottom'
}

const OFFSCREEN_POSITION: TooltipPosition = { top: -9999, left: -9999, arrowLeft: ARROW_INSET, placement: 'top' }

/**
 * Hover-triggered tooltip portaled to <body> and positioned with `position: fixed`
 * from the trigger's live getBoundingClientRect(). Portaling is required because the
 * card is a `motion.div` with `whileHover`, applying a transform on hover would turn
 * it into the containing block for any `position: fixed` descendant, breaking
 * viewport-relative placement right when the tooltip opens.
 */
function HoverTooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition>(OFFSCREEN_POSITION)
  const anchorRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  function recalculate() {
    const anchor = anchorRef.current
    const tooltip = tooltipRef.current
    if (!anchor || !tooltip) return

    const anchorRect = anchor.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const tooltipWidth = tooltipRect.width || TOOLTIP_MAX_WIDTH
    const tooltipHeight = tooltipRect.height

    // Vertical: always prefer above the anchor; only flip below if there truly
    // isn't room above, so it never overlaps cards further down the page.
    const spaceAbove = anchorRect.top
    const placement: 'top' | 'bottom' = spaceAbove >= tooltipHeight + ANCHOR_GAP + VIEWPORT_MARGIN ? 'top' : 'bottom'
    const top = placement === 'top' ? anchorRect.top - tooltipHeight - ANCHOR_GAP : anchorRect.bottom + ANCHOR_GAP

    // Horizontal: center on the anchor, then clamp so it never crosses either edge.
    const anchorCenterX = anchorRect.left + anchorRect.width / 2
    const maxLeft = Math.max(window.innerWidth - tooltipWidth - VIEWPORT_MARGIN, VIEWPORT_MARGIN)
    const left = Math.min(Math.max(anchorCenterX - tooltipWidth / 2, VIEWPORT_MARGIN), maxLeft)

    // Arrow stays under the anchor's center even after the tooltip body was clamped.
    const arrowLeft = Math.min(Math.max(anchorCenterX - left, ARROW_INSET), tooltipWidth - ARROW_INSET)

    setPosition({ top, left, arrowLeft, placement })
  }

  useLayoutEffect(() => {
    if (!open) return
    recalculate()
    window.addEventListener('resize', recalculate)
    window.addEventListener('scroll', recalculate, true)
    return () => {
      window.removeEventListener('resize', recalculate)
      window.removeEventListener('scroll', recalculate, true)
    }
    // recalculate reads live refs/DOM state, only the open transition should re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleEnter() {
    setOpen(true)
  }

  function handleLeave() {
    setOpen(false)
    setPosition(OFFSCREEN_POSITION)
  }

  return (
    <div
      ref={anchorRef}
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
      {createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            maxWidth: TOOLTIP_MAX_WIDTH,
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            zIndex: 9999,
            pointerEvents: 'none',
            opacity: open ? 1 : 0,
            visibility: open ? 'visible' : 'hidden',
            transition: 'opacity 0.15s ease',
          }}
          className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3 text-xs shadow-xl"
        >
          {content}
          <span
            style={{ left: position.arrowLeft }}
            className={`absolute h-2 w-2 -translate-x-1/2 rotate-45 border border-[var(--border-card)] bg-[var(--bg-card)] ${
              position.placement === 'bottom' ? '-top-1 border-r-0 border-b-0' : '-bottom-1 border-t-0 border-l-0'
            }`}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}

function MetricTooltipBody({ name, tooltip }: { name: string; tooltip: MetricTooltip }) {
  return (
    <>
      <div className="mb-1.5 font-semibold text-[var(--text-primary)]">{name}</div>
      <p className="mb-1 leading-relaxed text-[var(--text-muted)]">
        <span className="text-[var(--text-secondary)]">What: </span>
        {tooltip.what}
      </p>
      <p className="mb-1 leading-relaxed text-[var(--text-muted)]">
        <span className="text-[var(--text-secondary)]">How: </span>
        {tooltip.how}
      </p>
      <p className="leading-relaxed text-[var(--text-muted)]">
        <span className="text-[var(--text-secondary)]">Why: </span>
        {tooltip.why}
      </p>
    </>
  )
}

export function StatCard({
  label,
  value,
  delta,
  icon,
  tooltip,
  deltaTooltip,
}: {
  label: string
  value: string
  /** Percent change vs. previous period. Pass null when it can't be computed (e.g. previous value was 0). */
  delta: number | null
  icon: ReactNode
  /** What/how/why explainer shown on hover over the info icon. */
  tooltip?: MetricTooltip
  /** Text shown on hover over the period-over-period delta badge, e.g. "Compared to the previous 7-day period". */
  deltaTooltip?: string
}) {
  const positive = delta !== null && delta >= 0
  const negative = delta !== null && delta < 0

  const deltaBadge = (
    <div className={`sf-pill ${positive ? 'sf-pill-pos' : negative ? 'sf-pill-neg' : 'sf-pill-neutral'}`}>
      {positive && <ArrowUpRight size={12} />}
      {negative && <ArrowDownRight size={12} />}
      {delta === null ? <Minus size={12} /> : null}
      {delta === null ? 'n/a' : `${Math.abs(delta)}%`}
    </div>
  )

  return (
    <div className="group relative glass sf-card sf-card--interactive p-5">
      {tooltip && (
        <div className="absolute top-3 right-3">
          <HoverTooltip content={<MetricTooltipBody name={label} tooltip={tooltip} />}>
            <button type="button" aria-label={`About ${label}`} className="text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
              <Info size={14} />
            </button>
          </HoverTooltip>
        </div>
      )}

      <div className="flex items-start justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--hairline)] bg-gradient-to-br from-[var(--accent-cyan)]/25 to-[var(--accent-emerald)]/25 text-[var(--accent-emerald-bright)]">
          {icon}
        </div>
        {deltaTooltip ? (
          <HoverTooltip content={<p className="leading-relaxed text-[var(--text-secondary)]">{deltaTooltip}</p>}>{deltaBadge}</HoverTooltip>
        ) : (
          deltaBadge
        )}
      </div>
      <div className="sf-value mt-4 text-[var(--text-primary)]">{value}</div>
      <div className="mt-1.5 pr-5 text-sm text-[var(--text-secondary)]">{label}</div>
    </div>
  )
}
