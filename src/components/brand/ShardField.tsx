import { useEffect, useRef } from 'react'

interface Shard {
  x: number
  y: number
  len: number
  angle: number
  va: number // angular velocity
  vx: number
  vy: number
  hue: [number, number, number] // rgb
  alpha: number
}

const PALETTE: [number, number, number][] = [
  [52, 245, 197], // bright emerald
  [16, 185, 129], // emerald
  [6, 182, 212], // cyan
  [124, 58, 237], // faint purple accent
]

/**
 * Ambient "shard" field — thin glowing slivers drifting slowly across a dark
 * surface, echoing the signature data-vortex. Deliberately low-contrast: it
 * should register subconsciously, never compete with content. One <canvas>,
 * rAF-driven, DPR-aware, and fully static under prefers-reduced-motion.
 */
export function ShardField({ density = 1, className }: { density?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const ctx = context // non-null bindings captured by the inner closures below
    const cv = canvas

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    let shards: Shard[] = []
    let raf = 0

    function seed() {
      const parent = cv.parentElement
      w = parent?.clientWidth ?? window.innerWidth
      h = parent?.clientHeight ?? window.innerHeight
      cv.width = w * dpr
      cv.height = h * dpr
      cv.style.width = `${w}px`
      cv.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const count = Math.round(Math.min(26, Math.max(10, (w * h) / 62000)) * density)
      shards = Array.from({ length: count }).map(() => {
        const speed = 0.06 + Math.random() * 0.14
        const dir = Math.random() * Math.PI * 2
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          len: 70 + Math.random() * 190,
          angle: Math.random() * Math.PI,
          va: (Math.random() - 0.5) * 0.0012,
          vx: Math.cos(dir) * speed,
          vy: Math.sin(dir) * speed,
          hue: PALETTE[Math.floor(Math.random() * PALETTE.length)],
          alpha: 0.04 + Math.random() * 0.09,
        }
      })
    }

    function drawShard(s: Shard) {
      const dx = Math.cos(s.angle) * s.len * 0.5
      const dy = Math.sin(s.angle) * s.len * 0.5
      const [r, g, b] = s.hue
      const grad = ctx.createLinearGradient(s.x - dx, s.y - dy, s.x + dx, s.y + dy)
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`)
      grad.addColorStop(0.5, `rgba(${r},${g},${b},${s.alpha})`)
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.3
      ctx.shadowBlur = 14
      ctx.shadowColor = `rgba(${r},${g},${b},${s.alpha * 1.6})`
      ctx.beginPath()
      ctx.moveTo(s.x - dx, s.y - dy)
      ctx.lineTo(s.x + dx, s.y + dy)
      ctx.stroke()
    }

    function frame() {
      ctx.clearRect(0, 0, w, h)
      for (const s of shards) {
        s.x += s.vx
        s.y += s.vy
        s.angle += s.va
        const m = s.len
        if (s.x < -m) s.x = w + m
        if (s.x > w + m) s.x = -m
        if (s.y < -m) s.y = h + m
        if (s.y > h + m) s.y = -m
        drawShard(s)
      }
      ctx.shadowBlur = 0
      raf = requestAnimationFrame(frame)
    }

    seed()
    if (reduce) {
      for (const s of shards) drawShard(s)
      ctx.shadowBlur = 0
    } else {
      raf = requestAnimationFrame(frame)
    }

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      seed()
      if (reduce) {
        for (const s of shards) drawShard(s)
        ctx.shadowBlur = 0
      } else {
        raf = requestAnimationFrame(frame)
      }
    })
    if (cv.parentElement) ro.observe(cv.parentElement)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [density])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
}
