import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { FormField, inputClass } from '../../ui/FormControls'

const TIMEZONE_GROUPS: { label: string; zones: string[] }[] = [
  { label: 'Americas', zones: ['EST', 'CST', 'MST', 'PST', 'BRT'] },
  { label: 'Europe', zones: ['GMT', 'CET', 'EET'] },
  { label: 'Asia', zones: ['IST', 'SGT', 'KST', 'JST'] },
  { label: 'Other', zones: ['UTC'] },
]

const WEEKDAYS: { key: number; short: string }[] = [
  { key: 1, short: 'Mon' },
  { key: 2, short: 'Tue' },
  { key: 3, short: 'Wed' },
  { key: 4, short: 'Thu' },
  { key: 5, short: 'Fri' },
  { key: 6, short: 'Sat' },
  { key: 0, short: 'Sun' },
]

export interface ShiftPickerValue {
  timezone: string
  shiftStartUtc: number
  shiftEndUtc: number
  shiftDays: number[]
}

interface ShiftPickerProps {
  value: ShiftPickerValue
  onChange: (v: ShiftPickerValue) => void
}

function formatHour(h: number): string {
  const normalized = ((h % 24) + 24) % 24
  return `${String(normalized).padStart(2, '0')}:00`
}

export function ShiftPicker({ value, onChange }: ShiftPickerProps) {
  const durationLabel = useMemo(() => {
    const span = (value.shiftEndUtc - value.shiftStartUtc + 24) % 24 || 24
    return `${span}h window`
  }, [value.shiftStartUtc, value.shiftEndUtc])

  function toggleDay(day: number) {
    const next = value.shiftDays.includes(day)
      ? value.shiftDays.filter((d) => d !== day)
      : [...value.shiftDays, day].sort()
    onChange({ ...value, shiftDays: next })
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[var(--border-card)] bg-white/[0.015] p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        <Clock size={13} className="text-[var(--accent-emerald-bright)]" /> Shift schedule
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label="Timezone">
          <select
            className={inputClass}
            value={value.timezone}
            onChange={(e) => onChange({ ...value, timezone: e.target.value })}
          >
            {TIMEZONE_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </FormField>
        <FormField label={`Start (UTC) — ${formatHour(value.shiftStartUtc)}`}>
          <input
            type="range"
            min={0}
            max={23}
            step={1}
            value={value.shiftStartUtc}
            onChange={(e) => onChange({ ...value, shiftStartUtc: Number(e.target.value) })}
            className="w-full accent-[var(--accent-emerald-bright)]"
          />
        </FormField>
        <FormField label={`End (UTC) — ${formatHour(value.shiftEndUtc)}`}>
          <input
            type="range"
            min={0}
            max={23}
            step={1}
            value={value.shiftEndUtc}
            onChange={(e) => onChange({ ...value, shiftEndUtc: Number(e.target.value) })}
            className="w-full accent-[var(--accent-emerald-bright)]"
          />
        </FormField>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const active = value.shiftDays.includes(d.key)
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => toggleDay(d.key)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-[var(--accent-emerald-bright)]/60 bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]'
                    : 'border-[var(--border-card)] text-slate-400 hover:text-white hover:border-white/20'
                }`}
              >
                {d.short}
              </button>
            )
          })}
        </div>
        <span className="text-[11px] text-[var(--text-secondary)]">{durationLabel}</span>
      </div>
    </div>
  )
}
