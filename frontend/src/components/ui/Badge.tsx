import type { ReactNode } from 'react'

export type BadgeTone =
  | 'green'
  | 'red'
  | 'yellow'
  | 'gray'
  | 'blue'
  | 'orange'
  | 'purple'
  | 'indigo'
  | 'cyan'
  | 'emerald'

/**
 * Sapphire-family palette: the "cool" tones (green→purple) span teal→cyan→sky→
 * sapphire→indigo→violet so they stay cohesive on the dark surface yet remain
 * distinguishable, while red/yellow/orange keep true semantic warmth so danger
 * and warning states read instantly. Each uses a soft tint fill, a legible bright
 * text shade, and a matching hairline border.
 */
const toneClasses: Record<BadgeTone, string> = {
  green: 'bg-[#34d399]/12 text-[#5eead4] border-[#34d399]/30',
  emerald: 'bg-[#2dd4bf]/12 text-[#5eead4] border-[#2dd4bf]/30',
  cyan: 'bg-[#38bdf8]/12 text-[#7dd3fc] border-[#38bdf8]/30',
  blue: 'bg-[#4d9fff]/12 text-[#8cc5ff] border-[#4d9fff]/30',
  indigo: 'bg-[#818cf8]/12 text-[#a5b4fc] border-[#818cf8]/30',
  purple: 'bg-[#a78bfa]/12 text-[#c4b5fd] border-[#a78bfa]/30',
  yellow: 'bg-[#fbbf24]/12 text-[#fcd34d] border-[#fbbf24]/30',
  orange: 'bg-[#fb923c]/12 text-[#fdba74] border-[#fb923c]/30',
  red: 'bg-[#f87171]/12 text-[#fca5a5] border-[#f87171]/30',
  gray: 'bg-slate-400/10 text-slate-300 border-slate-400/25',
}

export function Badge({
  tone,
  children,
  dot = true,
}: {
  tone: BadgeTone
  children: ReactNode
  dot?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${toneClasses[tone]}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
