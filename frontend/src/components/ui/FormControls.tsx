import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export const inputClass =
  'focus-ring w-full rounded-xl border border-[var(--border-card)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] transition-colors hover:border-[var(--accent-emerald)]/40'

export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring appearance-none rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] py-2.5 pl-3 pr-9 text-sm text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--accent-emerald)]/40"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
    </div>
  )
}

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  )
}
