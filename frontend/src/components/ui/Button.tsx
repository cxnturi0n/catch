import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'sheen bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)] text-white shadow-[var(--glow-emerald)] hover:shadow-[var(--glow-emerald-strong)] hover:brightness-110 active:brightness-95',
  secondary:
    'border border-[var(--border-card)] bg-[var(--surface-1)] text-[var(--text-primary)] hover:bg-[var(--surface-2)] hover:border-[var(--accent-emerald)]/40 active:bg-[var(--surface-1)]',
  ghost:
    'text-[var(--text-secondary)] hover:bg-[var(--raise-hover)] hover:text-[var(--text-primary)] active:bg-[var(--surface-1)]',
  danger:
    'border border-red-500/40 bg-red-500/[0.06] text-red-300 hover:bg-red-500/15 hover:border-red-500/60 active:bg-red-500/10',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`focus-ring relative inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:brightness-100 ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" />}
      {children}
    </button>
  )
}
