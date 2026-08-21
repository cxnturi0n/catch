import { useRef, useState, type ReactNode } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'

/**
 * Two panels side-by-side with a draggable vertical divider. The split ratio is
 * kept as a percentage of the container width and persisted per `storageKey`.
 * Below the `lg` breakpoint the panels stack (left then right) and the divider
 * is hidden, so it degrades gracefully on mobile.
 */
export function SplitPane({
  storageKey,
  left,
  right,
  initialLeftPct = 75,
  minLeftPct = 25,
  maxLeftPct = 85,
  className = '',
  leftClassName = '',
  rightClassName = '',
}: {
  storageKey: string
  left: ReactNode
  right: ReactNode
  initialLeftPct?: number
  minLeftPct?: number
  maxLeftPct?: number
  className?: string
  leftClassName?: string
  rightClassName?: string
}) {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const containerRef = useRef<HTMLDivElement>(null)
  const [leftPct, setLeftPct] = useState<number>(() => {
    if (typeof window === 'undefined') return initialLeftPct
    const raw = Number(window.localStorage.getItem(storageKey))
    if (!Number.isFinite(raw) || raw <= 0) return initialLeftPct
    return Math.min(maxLeftPct, Math.max(minLeftPct, raw))
  })
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)

  function startDrag(e: React.PointerEvent) {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(maxLeftPct, Math.max(minLeftPct, pct)))
    }
    const onUp = () => {
      draggingRef.current = false
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      try {
        setLeftPct((p) => {
          window.localStorage.setItem(storageKey, String(Math.round(p)))
          return p
        })
      } catch {
        /* storage unavailable — ratio still applies for this session */
      }
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (!isDesktop) {
    return (
      <div className={`flex flex-col gap-4 ${className}`}>
        <div className={leftClassName}>{left}</div>
        <div className={rightClassName}>{right}</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={`flex w-full items-stretch ${className}`}>
      <div style={{ width: `${leftPct}%` }} className={`min-w-0 ${leftClassName}`}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        onPointerDown={startDrag}
        className="group relative mx-1 w-1.5 shrink-0 cursor-col-resize self-stretch"
      >
        <div className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded transition-colors ${dragging ? 'bg-[var(--accent-emerald)]' : 'bg-[var(--border-card)] group-hover:bg-[var(--accent-emerald)]/60'}`} />
      </div>
      <div className={`min-w-0 flex-1 ${rightClassName}`}>{right}</div>
    </div>
  )
}
