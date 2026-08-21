import { Star } from 'lucide-react'

export function RatingStars({ rating }: { rating: number }) {
  const clamped = Math.max(0, Math.min(5, rating))
  const rounded = Math.round(clamped * 2) / 2 // nearest half-star

  return (
    <div className="flex items-center gap-1" title={`${clamped.toFixed(1)} / 5`}>
      <div className="flex">
        {[1, 2, 3, 4, 5].map((n) => {
          const fill = rounded >= n ? '100%' : rounded >= n - 0.5 ? '50%' : '0%'
          return (
            <span key={n} className="relative inline-block">
              <Star size={14} className="text-slate-700" />
              <span className="absolute inset-0 overflow-hidden" style={{ width: fill }}>
                <Star size={14} className="fill-amber-400 text-amber-400" />
              </span>
            </span>
          )
        })}
      </div>
      <span className="text-xs text-[var(--text-secondary)]">{clamped.toFixed(1)}</span>
    </div>
  )
}
