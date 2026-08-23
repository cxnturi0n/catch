import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import { getTutorialForPath, TUTORIAL_KEY_PREFIX, type TutorialEntry } from '../lib/tutorialContent'

function storageKey(id: string) {
  return `${TUTORIAL_KEY_PREFIX}${id}`
}

function hasSeen(id: string): boolean {
  try {
    return localStorage.getItem(storageKey(id)) === '1'
  } catch {
    // localStorage unavailable, treat as "not seen" but the markSeen write
    // below will also no-op, so it simply shows once per mount at worst.
    return false
  }
}

function markSeen(id: string) {
  try {
    localStorage.setItem(storageKey(id), '1')
  } catch {
    // Ignore, nothing we can persist; the pop-up may reappear next session.
  }
}

/**
 * First-visit tutorial pop-up. Mounted once (in MainLayout). Watches the route
 * and, the first time the user lands on a macro section, shows a small floating
 * card explaining what that section does. Dismissing it ("Got it" or X) marks
 * the section seen so it never auto-shows again.
 *
 * Non-intrusive by design: no scrim, does not block the page, only one card at
 * a time. Content is visible by default; only a transform is animated, and the
 * animation is skipped under prefers-reduced-motion.
 */
export function SectionTutorial() {
  const location = useLocation()
  const reduceMotion = useReducedMotion()
  const [entry, setEntry] = useState<TutorialEntry | null>(null)

  // Decide whether to show a tutorial for the current route.
  useEffect(() => {
    const match = getTutorialForPath(location.pathname)
    if (match && !hasSeen(match.id)) {
      setEntry(match)
    } else {
      // Navigated to a seen / non-tutorial section, hide any open card.
      setEntry(null)
    }
  }, [location.pathname])

  const dismiss = useCallback(() => {
    setEntry((current) => {
      if (current) markSeen(current.id)
      return null
    })
  }, [])

  // Escape closes the card (without blocking any other page interaction).
  useEffect(() => {
    if (!entry) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [entry, dismiss])

  return (
    <AnimatePresence>
      {entry && (
        <motion.div
          key={entry.id}
          role="dialog"
          aria-label={`${entry.title} tutorial`}
          // Fixed bottom-right, above content but non-blocking (auto pointer
          // events only on the card itself). No backdrop-filter here so it is
          // safe inside the overflow-hidden layout ancestor.
          className="glow-emerald fixed bottom-4 right-4 z-[55] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[rgba(120,170,255,0.20)] bg-[#0b1018] shadow-2xl print:hidden"
          initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Top accent bar */}
          <div aria-hidden className="gradient-bar-emerald h-1 w-full" />

          <div className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border-card)] bg-white/[0.03] text-[var(--accent-emerald)]">
                  <Sparkles size={15} />
                </span>
                <h2 className="text-shine text-base font-semibold">{entry.title}</h2>
              </div>
              <button
                onClick={dismiss}
                aria-label="Dismiss tutorial"
                className="focus-ring -mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">{entry.blurb}</p>

            <div className="mt-4 flex justify-end">
              <button
                onClick={dismiss}
                className="focus-ring sheen inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:brightness-110"
              >
                Got it
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
