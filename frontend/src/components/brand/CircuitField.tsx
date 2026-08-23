import { useEffect, useRef } from 'react'

interface Shard {
  x: number
  y: number
  len: number // long side of the rectangular shard
  w: number // short side
  angle: number
  va: number // slow rotation
  vx: number
  vy: number
  base: number // base alpha
  phase: number // blink phase
  speed: number // blink speed (slow)
  rgb: [number, number, number]
}

interface Dot {
  x: number
  y: number
  r: number
  a: number
  tw: number
  vx: number
  vy: number
}

// Sapphire palette, from deep to icy bright, so lit shards read as sparks of light.
const SHARD_RGB: [number, number, number][] = [
  [77, 159, 255], // sapphire
  [109, 179, 255], // brighter
  [140, 197, 255], // icy
  [47, 124, 246], // deep
]

/**
 * Sapphire ember field, the app background. Thin blue-sapphire SHARDS drift
 * slowly through the air and light up on a slow, staggered intermittence (like
 * embers of fire dust, but shard-shaped), over a few steady luminous points.
 * No circuit lines. Canvas, DPR-aware, draws a static frame first so it's
 * visible even if rAF never runs; fully static under prefers-reduced-motion.
 */
export function CircuitField({ intensity = 1, className }: { intensity?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const ctx = context
    const cv = canvas

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    let raf = 0
    let t = 0
    let last = 0
    let shards: Shard[] = []
    let dots: Dot[] = []

    function seed() {
      const shardCount = Math.round(Math.min(30, Math.max(12, (w * h) / 70000)) * intensity)
      shards = Array.from({ length: shardCount }).map(() => {
        const period = 4 + Math.random() * 6 // seconds, slow intermittence
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          len: 7 + Math.random() * 16, // short rectangular ember/shard
          w: 1.6 + Math.random() * 2.4,
          angle: Math.random() * Math.PI,
          va: (Math.random() - 0.5) * 0.06,
          vx: (Math.random() - 0.5) * 7, // gentle horizontal sway
          vy: -(6 + Math.random() * 12), // rises through the air like embers
          base: 0.16 + Math.random() * 0.2,
          phase: Math.random() * Math.PI * 2,
          speed: (Math.PI * 2) / period,
          rgb: SHARD_RGB[Math.floor(Math.random() * SHARD_RGB.length)],
        }
      })

      const dotCount = Math.round(Math.min(28, (w * h) / 90000) * intensity)
      dots = Array.from({ length: dotCount }).map(() => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.5 + Math.random() * 1.4,
        a: 0.1 + Math.random() * 0.28,
        tw: Math.random() * Math.PI * 2,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3,
      }))
    }

    function drawShard(s: Shard, lit: number) {
      const alpha = s.base * (0.28 + lit) // stays dim, flares up when lit
      const [r, g, b] = s.rgb
      ctx.save()
      ctx.translate(s.x, s.y)
      ctx.rotate(s.angle)
      ctx.shadowBlur = 6 + lit * 20 // glow swells when the shard lights up
      ctx.shadowColor = `rgba(${r},${g},${b},${Math.min(1, alpha * 2)})`
      // Rectangular ember shard, a small glowing bar
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
      const hl = s.len * 0.5
      const hw = s.w * 0.5
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(-hl, -hw, s.len, s.w, hw)
      else ctx.rect(-hl, -hw, s.len, s.w)
      ctx.fill()
      // Hot bright core when strongly lit, the spark catching light
      if (lit > 0.35) {
        ctx.shadowBlur = 10 + lit * 22
        ctx.fillStyle = `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 40)},255,${alpha * lit})`
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(-hl * 0.5, -hw, s.len * 0.5, s.w, hw)
        else ctx.rect(-hl * 0.5, -hw, s.len * 0.5, s.w)
        ctx.fill()
      }
      ctx.restore()
    }

    function litOf(s: Shard): number {
      // Envelope biased toward "mostly dim, occasional slow flare".
      const v = Math.sin(t * s.speed + s.phase) * 0.5 + 0.5
      return v * v * v
    }

    function drawDots() {
      for (const d of dots) {
        const a = d.a * (0.55 + 0.45 * Math.sin(d.tw))
        ctx.shadowBlur = 6
        ctx.shadowColor = `rgba(140,197,255,${a})`
        ctx.fillStyle = `rgba(180,210,255,${a})`
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.shadowBlur = 0
    }

    function drawStatic() {
      ctx.clearRect(0, 0, w, h)
      for (const s of shards) drawShard(s, 0.3)
      drawDots()
      ctx.shadowBlur = 0
    }

    function wrap(v: number, max: number, m: number): number {
      if (v < -m) return max + m
      if (v > max + m) return -m
      return v
    }

    function frame(now: number) {
      const dt = last ? Math.min(60, now - last) : 16
      last = now
      t += dt / 1000
      ctx.clearRect(0, 0, w, h)

      for (const s of shards) {
        s.x = wrap(s.x + (s.vx * dt) / 1000, w, s.len)
        s.y = wrap(s.y + (s.vy * dt) / 1000, h, s.len)
        s.angle += s.va * (dt / 16)
        drawShard(s, litOf(s))
      }
      for (const d of dots) {
        d.x = wrap(d.x + (d.vx * dt) / 1000, w, 4)
        d.y = wrap(d.y + (d.vy * dt) / 1000, h, 4)
        d.tw += dt / 500
      }
      drawDots()
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(frame)
    }

    function size(): boolean {
      const cvw = cv.clientWidth
      const cvh = cv.clientHeight
      const real = cvw > 0 && cvh > 0
      w = Math.ceil(cvw || window.innerWidth || 1600)
      h = Math.ceil(cvh || window.innerHeight || 1000)
      cv.width = w * dpr
      cv.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
      return real
    }

    function restart() {
      cancelAnimationFrame(raf)
      size()
      drawStatic()
      if (!reduce) raf = requestAnimationFrame(frame)
    }

    const gotReal = size()
    drawStatic()
    if (!reduce) raf = requestAnimationFrame(frame)

    let retry = 0
    if (!gotReal) {
      const tick = () => {
        if (size()) restart()
        else if (retry++ < 20) window.setTimeout(tick, 150)
      }
      window.setTimeout(tick, 150)
    }

    const onResize = () => restart()
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(() => restart())
    if (cv.parentElement) ro.observe(cv.parentElement)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      ro.disconnect()
    }
  }, [intensity])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
}
