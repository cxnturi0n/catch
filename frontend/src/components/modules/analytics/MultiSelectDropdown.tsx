import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface MultiOption {
  id: string
  label: string
  disabled?: boolean
  hint?: string
}

/**
 * Checkbox-style multi-select dropdown, styled to match the single-select
 * FilterDropdown used elsewhere in Analytics. Selection is fully controlled;
 * the trigger shows a compact summary ("All" / a single label / "N selected").
 */
export function MultiSelectDropdown({
  icon,
  label,
  options,
  selected,
  onChange,
  allLabel = 'All',
  summary,
  footer,
}: {
  icon?: ReactNode
  label: string
  options: MultiOption[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Text shown when nothing is explicitly selected. */
  allLabel?: string
  /** Optional custom summary for the trigger. */
  summary?: string
  /** Optional pinned footer (e.g. a "request a metric" action). Receives a
   *  `close` callback so it can dismiss the dropdown when it fires. */
  footer?: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  }

  const triggerText =
    summary ??
    (selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.id === selected[0])?.label ?? `${selected.length} selected`)
        : `${selected.length} selected`)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:border-[var(--accent-emerald)]/50"
      >
        {icon}
        <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">{label}</span>
        <span className="max-w-[180px] truncate">{triggerText}</span>
        <ChevronDown size={15} className={`text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 max-h-[320px] min-w-[230px] overflow-y-auto rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1.5 shadow-2xl">
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-slate-500">No options available</div>
          )}
          {options.map((o) => {
            const checked = selected.includes(o.id)
            return (
              <button
                key={o.id}
                type="button"
                disabled={o.disabled}
                title={o.disabled ? o.hint : undefined}
                onClick={() => {
                  if (o.disabled) return
                  toggle(o.id)
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  o.disabled
                    ? 'cursor-not-allowed text-slate-500'
                    : checked
                      ? 'bg-[var(--accent-emerald)]/[0.12] text-white'
                      : 'text-slate-300 hover:bg-white/[0.05]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                      checked
                        ? 'border-[var(--accent-emerald)] bg-[var(--accent-emerald)]/25 text-[var(--accent-emerald-bright)]'
                        : 'border-[var(--border-card)] bg-transparent'
                    }`}
                  >
                    {checked && <Check size={12} />}
                  </span>
                  <span>{o.label}</span>
                </span>
                {o.disabled && o.hint && <span className="text-[10px] uppercase tracking-wide text-slate-600">{o.hint}</span>}
              </button>
            )
          })}
          {footer && (
            <div className="mt-1 border-t border-[var(--border-card)] pt-1">
              {footer(() => setOpen(false))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
