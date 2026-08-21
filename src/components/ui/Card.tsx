import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** Static sapphire glow around the card. */
  glow?: boolean
  /** Lift + glow on hover (interactive cards). */
  hover?: boolean
}

export function Card({ children, glow = false, hover = false, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`glass sf-card ${glow ? 'shadow-[var(--glow-emerald)]' : ''} ${hover ? 'sf-card--interactive' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * Skeleton placeholder for loading states. Always renders a visible soft surface
 * with a sweeping sheen — never gates content on the animation.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

/** Consistent empty-state block for lists/tables with nothing to show. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--border-card)] bg-[var(--surface-1)] px-6 py-12 text-center ${className}`}>
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--accent-emerald)]">
          {icon}
        </div>
      )}
      <div>
        <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
        {description && <p className="mt-1 max-w-xs text-sm text-[var(--text-secondary)]">{description}</p>}
      </div>
      {action}
    </div>
  )
}
