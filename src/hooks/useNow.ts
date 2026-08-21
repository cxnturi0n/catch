import { useEffect, useState } from 'react'

/** 60s matches shift granularity — now-markers move in minutes, not seconds. */
const DEFAULT_INTERVAL_MS = 60_000

/** Current instant, re-rendered on an interval so time-derived UI (now-markers,
 *  "on shift" pills, coverage gaps) never sits frozen while the user watches.
 *
 *  The timer is suspended while the tab is hidden (browsers throttle background
 *  timers anyway) and the clock is resynced on the way back, so returning to the
 *  tab never shows a stale board. */
export function useNow(intervalMs: number = DEFAULT_INTERVAL_MS): Date {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
    const start = () => {
      stop()
      timer = setInterval(() => setNow(new Date()), intervalMs)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop()
        return
      }
      setNow(new Date())
      start()
    }

    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs])

  return now
}
