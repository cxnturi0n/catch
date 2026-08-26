import { useEffect, useState, type FormEvent } from 'react'
import type { Moderator, ModeratorContractType, ModeratorCurrency, ModeratorPlatform, ModeratorShift, ModeratorStatus } from '../../../types'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { FormField, inputClass } from '../../ui/FormControls'
import { ShiftPicker, type ShiftPickerValue } from './ShiftPicker'
import { PlatformUserPicker, type LinkedUser } from './PlatformUserPicker'
import { useWorkspace } from '../../../context/WorkspaceContext'

const CONTRACT_TYPES: ModeratorContractType[] = ['Volunteer', 'Paid', 'Trial']
const CURRENCIES: ModeratorCurrency[] = ['USD', 'EUR', 'USDT']
const STATUSES: ModeratorStatus[] = ['On Duty', 'Off Duty', 'On Leave', 'Inactive']
const PLATFORMS: ModeratorPlatform[] = ['Discord', 'Telegram']

// Legacy shift label kept in sync with the numeric window for back-compat with
// pre-016 consumers that still read Moderator.shift as a coarse string.
function labelFromWindow(start: number): ModeratorShift {
  if (start >= 6 && start < 14) return 'Morning (06-14)'
  if (start >= 14 && start < 22) return 'Afternoon (14-22)'
  return 'Night (22-06)'
}

function windowFromLabel(label: ModeratorShift): { start: number; end: number } {
  if (label === 'Afternoon (14-22)') return { start: 14, end: 22 }
  if (label === 'Night (22-06)') return { start: 22, end: 6 }
  return { start: 6, end: 14 }
}

interface FormState {
  fullName: string
  discordHandle: string
  telegramHandle: string
  discordUser: LinkedUser | null
  telegramUser: LinkedUser | null
  country: string
  platforms: ModeratorPlatform[]
  startDate: string
  contractType: ModeratorContractType
  monthlyRate: string
  currency: ModeratorCurrency
  shift: ShiftPickerValue
  status: ModeratorStatus
  notes: string
}

function emptyForm(): FormState {
  return {
    fullName: '',
    discordHandle: '',
    telegramHandle: '',
    discordUser: null,
    telegramUser: null,
    country: '',
    platforms: [],
    startDate: new Date().toISOString().slice(0, 10),
    contractType: 'Volunteer',
    monthlyRate: '',
    currency: 'USD',
    shift: { timezone: 'UTC', shiftStartUtc: 9, shiftEndUtc: 17, shiftDays: [1, 2, 3, 4, 5] },
    status: 'On Duty',
    notes: '',
  }
}

function moderatorToForm(m: Moderator): FormState {
  const win = windowFromLabel(m.shift)
  return {
    fullName: m.fullName,
    discordHandle: m.discordHandle,
    telegramHandle: m.telegramHandle,
    discordUser: m.discordUserId ? { id: m.discordUserId, name: m.discordHandle || null } : null,
    telegramUser: m.telegramUserId ? { id: m.telegramUserId, name: m.telegramHandle || null } : null,
    country: m.country ?? '',
    platforms: m.platforms,
    startDate: m.startDate,
    contractType: m.contractType,
    monthlyRate: m.monthlyRate ? String(m.monthlyRate) : '',
    currency: m.currency ?? 'USD',
    shift: {
      timezone: m.timezone || 'UTC',
      shiftStartUtc: typeof m.shiftStartUtc === 'number' ? m.shiftStartUtc : win.start,
      shiftEndUtc: typeof m.shiftEndUtc === 'number' ? m.shiftEndUtc : win.end,
      shiftDays: m.shiftDays && m.shiftDays.length > 0 ? m.shiftDays : [1, 2, 3, 4, 5],
    },
    status: m.status,
    notes: m.notes,
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function AddModeratorModal({
  open,
  onClose,
  onSubmit,
  editing,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (moderator: Moderator) => void | Promise<void>
  editing: Moderator | null
}) {
  const { activeWorkspaceId, getWorkspaceIntegrations } = useWorkspace()
  const integrations = getWorkspaceIntegrations(activeWorkspaceId)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<{ fullName?: string; startDate?: string; timezone?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(editing ? moderatorToForm(editing) : emptyForm())
      setErrors({})
      setSubmitting(false)
    }
  }, [open, editing])

  function togglePlatform(p: ModeratorPlatform) {
    setForm((f) => ({
      ...f,
      platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p],
    }))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (!form.fullName.trim()) nextErrors.fullName = 'Full name is required.'
    if (!form.startDate) nextErrors.startDate = 'Start date is required.'
    if (!form.shift.timezone) nextErrors.timezone = 'Timezone is required.'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSubmitting(true)
    setTimeout(async () => {
      const base: Moderator = editing ?? {
        id: `mod-${Date.now()}`,
        fullName: '',
        discordHandle: '',
        telegramHandle: '',
        avatarInitials: '',
        startDate: '',
        contractType: 'Volunteer',
        timezone: '',
        shift: 'Morning (06-14)',
        platforms: [],
        status: 'On Duty',
        messagesThisMonth: 0,
        bansExecuted: 0,
        timeoutsGiven: 0,
        avgResponseTime: 'n/a',
        lastActiveDate: new Date().toISOString().slice(0, 10),
        shiftsCompleted: 0,
        shiftsAssigned: 0,
        warnings: [],
        notes: '',
        rating: 5,
      }

      const moderator: Moderator = {
        ...base,
        fullName: form.fullName.trim(),
        discordHandle: form.discordHandle.trim(),
        telegramHandle: form.telegramHandle.trim(),
        // '' clears a previous link on edit (the API maps it to null).
        discordUserId: form.discordUser?.id ?? '',
        telegramUserId: form.telegramUser?.id ?? '',
        avatarInitials: initialsOf(form.fullName.trim()),
        country: form.country.trim() || undefined,
        startDate: form.startDate,
        contractType: form.contractType,
        monthlyRate: form.contractType === 'Paid' && form.monthlyRate ? Number(form.monthlyRate) : undefined,
        currency: form.contractType === 'Paid' ? form.currency : undefined,
        timezone: form.shift.timezone,
        shift: labelFromWindow(form.shift.shiftStartUtc),
        shiftStartUtc: form.shift.shiftStartUtc,
        shiftEndUtc: form.shift.shiftEndUtc,
        shiftDays: form.shift.shiftDays,
        platforms: form.platforms,
        status: form.status,
        notes: form.notes.trim(),
      }
      try {
        await onSubmit(moderator)
      } finally {
        setSubmitting(false)
      }
    }, 500)
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Moderator' : 'Add Moderator'}>
      <form onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1">
        <section className="flex flex-col gap-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Identity</h3>
          <FormField label="Full Name">
            <input
              className={`${inputClass} ${errors.fullName ? 'border-red-500' : ''}`}
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              placeholder="e.g. Marco Rossi"
            />
            {errors.fullName && <span className="text-xs text-red-400">{errors.fullName}</span>}
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Discord Handle">
              <input
                className={inputClass}
                value={form.discordHandle}
                onChange={(e) => setForm((f) => ({ ...f, discordHandle: e.target.value }))}
                placeholder="e.g. marco_mod"
              />
            </FormField>
            <FormField label="Telegram Handle">
              <input
                className={inputClass}
                value={form.telegramHandle}
                onChange={(e) => setForm((f) => ({ ...f, telegramHandle: e.target.value }))}
                placeholder="e.g. @marco_mod"
              />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <PlatformUserPicker
              workspaceId={integrations.discord.status === 'Connected' ? activeWorkspaceId : null}
              platform="discord"
              value={form.discordUser}
              onChange={(u) => setForm((f) => ({ ...f, discordUser: u, discordHandle: f.discordHandle || (u?.name ?? '').replace(/^@/, '') }))}
            />
            <PlatformUserPicker
              workspaceId={integrations.telegram.status === 'Connected' ? activeWorkspaceId : null}
              platform="telegram"
              value={form.telegramUser}
              onChange={(u) => setForm((f) => ({ ...f, telegramUser: u, telegramHandle: f.telegramHandle || (u?.name ?? '') }))}
            />
          </div>
          <p className="text-xs text-[var(--text-secondary)]">Linking the platform user makes activity, punctuality, bans and response times follow the person even when the display name changes. Handles stay as a fallback.</p>
          <FormField label="Country">
            <input
              className={inputClass}
              value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
              placeholder="e.g. Brazil"
            />
          </FormField>
          <FormField label="Platforms">
            <div className="flex gap-3">
              {PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm text-white">
                  <input type="checkbox" checked={form.platforms.includes(p)} onChange={() => togglePlatform(p)} />
                  {p}
                </label>
              ))}
            </div>
          </FormField>
        </section>

        <section className="flex flex-col gap-4 border-t border-[var(--border-card)] pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Contract</h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Start Date">
              <input
                type="date" lang="en-US"
                min="2020-01-01"
                className={`${inputClass} ${errors.startDate ? 'border-red-500' : ''}`}
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
              {errors.startDate && <span className="text-xs text-red-400">{errors.startDate}</span>}
            </FormField>
            <FormField label="Contract Type">
              <select
                className={inputClass}
                value={form.contractType}
                onChange={(e) => setForm((f) => ({ ...f, contractType: e.target.value as ModeratorContractType }))}
              >
                {CONTRACT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          {form.contractType === 'Paid' && (
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Monthly Rate">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={form.monthlyRate}
                  onChange={(e) => setForm((f) => ({ ...f, monthlyRate: e.target.value }))}
                  placeholder="e.g. 500"
                />
              </FormField>
              <FormField label="Currency">
                <select
                  className={inputClass}
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as ModeratorCurrency }))}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4 border-t border-[var(--border-card)] pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Schedule</h3>
          <ShiftPicker value={form.shift} onChange={(shift) => setForm((f) => ({ ...f, shift }))} />
          {errors.timezone && <span className="text-xs text-red-400">{errors.timezone}</span>}
          <FormField label="Status">
            <select className={inputClass} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ModeratorStatus }))}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
        </section>

        <section className="flex flex-col gap-4 border-t border-[var(--border-card)] pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Notes</h3>
          <textarea
            className={`${inputClass} min-h-20 resize-none`}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Context, performance history, anything worth flagging..."
          />
        </section>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editing ? 'Save Changes' : 'Add Moderator'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
