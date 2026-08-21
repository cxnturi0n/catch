import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CatchMark } from '../brand/CatchMark'
import { BrandBackdrop } from '../brand/BrandBackdrop'

// Shared frame for every public auth screen (login, signup, reset, 2FA…).
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070b12] px-4 py-10">
      <BrandBackdrop />
      <div className="animate-rise-in glow-emerald relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b1018] p-8">
        <div aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-emerald-bright)]/60 to-transparent" />
        <div className="mb-6 flex flex-col items-center text-center">
          <Link to="/" className="mb-3" aria-label="Catch home">
            <CatchMark size={64} />
          </Link>
          <h1 className="text-xl font-semibold text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="mt-5 text-center text-xs text-slate-500">{footer}</div>}
      </div>
    </div>
  )
}

export function AuthError({ message }: { message: string }) {
  if (!message) return null
  return <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">{message}</div>
}

export function AuthNotice({ message }: { message: string }) {
  if (!message) return null
  return <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{message}</div>
}

export const authInputClass =
  'focus-ring w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-[var(--accent-emerald-bright)]/60'

export const authButtonClass =
  'focus-ring sheen flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)] py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60'

export const authSecondaryButtonClass =
  'focus-ring flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm font-medium text-white transition hover:bg-white/[0.08] disabled:opacity-60'
