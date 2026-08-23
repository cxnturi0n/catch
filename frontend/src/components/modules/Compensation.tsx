import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BadgeDollarSign, Loader2, Pencil, Users } from 'lucide-react'
import type {
  CompCurrency,
  CompensationConfig,
  CompensationKind,
  FixedPeriod,
  Moderator,
} from '../../types'
import { fetchModerators } from '../../lib/db'
import {
  applyCompensationConfigToAll,
  fetchCompensationConfigs,
  upsertCompensationConfig,
  type CompConfigUpsert,
} from '../../lib/dbPlatformV2'
import { getModerators as getSeedModerators } from '../../data/moderatorsData'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState } from '../ui/Card'
import { FormField, inputClass } from '../ui/FormControls'
import { Modal } from '../ui/Modal'

const CURRENCY_OPTIONS: CompCurrency[] = ['USD', 'EUR', 'USDT']
const PERIOD_OPTIONS: FixedPeriod[] = ['monthly', 'weekly', 'hourly']
const KIND_OPTIONS: { value: CompensationKind; label: string; hint: string }[] = [
  { value: 'fixed', label: 'Fixed', hint: 'Flat salary, same every period' },
  { value: 'variable', label: 'Variable', hint: 'Paid from the points catalog' },
  { value: 'both', label: 'Both', hint: 'Base salary plus variable on top' },
]

const KIND_TONE: Record<CompensationKind, BadgeTone> = {
  fixed: 'cyan',
  variable: 'purple',
  both: 'emerald',
}

const CURRENCY_SYMBOL: Record<CompCurrency, string> = { USD: '$', EUR: '€', USDT: '₮' }

function formatFixed(cfg: CompensationConfig | undefined): string {
  if (!cfg || cfg.kind === 'variable' || cfg.fixedAmount == null) return 'n/a'
  const sym = cfg.fixedCurrency ? CURRENCY_SYMBOL[cfg.fixedCurrency] : ''
  const per = cfg.fixedPeriod ? ` / ${cfg.fixedPeriod}` : ''
  return `${sym}${cfg.fixedAmount.toLocaleString()}${per}`
}

interface Draft {
  moderatorId: string | null // null = "apply to all" mode
  kind: CompensationKind
  fixedAmount: string
  fixedCurrency: CompCurrency
  fixedPeriod: FixedPeriod
  variableNotes: string
  applyToAll: boolean
}

function draftFromConfig(mod: Moderator | null, existing?: CompensationConfig): Draft {
  return {
    moderatorId: mod?.id ?? null,
    kind: existing?.kind ?? 'fixed',
    fixedAmount: existing?.fixedAmount != null ? String(existing.fixedAmount) : '',
    fixedCurrency: (existing?.fixedCurrency as CompCurrency) ?? 'USD',
    fixedPeriod: (existing?.fixedPeriod as FixedPeriod) ?? 'monthly',
    variableNotes: existing?.variableNotes ?? '',
    applyToAll: mod === null,
  }
}

export function Compensation() {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [moderators, setModerators] = useState<Moderator[]>([])
  const [configs, setConfigs] = useState<Record<string, CompensationConfig>>({})
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      if (!user) {
        if (cancelled) return
        setModerators(getSeedModerators(activeWorkspaceId))
        setConfigs({})
        setLoading(false)
        return
      }
      try {
        const [mods, cfgs] = await Promise.all([
          fetchModerators(activeWorkspaceId),
          fetchCompensationConfigs(activeWorkspaceId),
        ])
        if (cancelled) return
        setModerators(mods)
        const map: Record<string, CompensationConfig> = {}
        for (const c of cfgs) map[c.moderatorId] = c
        setConfigs(map)
      } catch {
        if (cancelled) return
        setModerators([])
        setConfigs({})
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, user])

  const rows = useMemo(
    () => moderators.map((m) => ({ mod: m, cfg: configs[m.id] })),
    [moderators, configs],
  )

  function openEdit(mod: Moderator) {
    setDraft(draftFromConfig(mod, configs[mod.id]))
  }

  function openApplyToAll() {
    setDraft({ ...draftFromConfig(null), applyToAll: true })
  }

  async function handleSave() {
    if (!draft) return
    // Guest mode, persist in-memory so the CM can preview the flow.
    if (!user) {
      const now = new Date().toISOString()
      const base: Omit<CompensationConfig, 'moderatorId' | 'workspaceId' | 'updatedAt'> = {
        kind: draft.kind,
        fixedAmount: draft.kind === 'variable' ? null : Number(draft.fixedAmount) || 0,
        fixedCurrency: draft.kind === 'variable' ? null : draft.fixedCurrency,
        fixedPeriod: draft.kind === 'variable' ? null : draft.fixedPeriod,
        variableNotes: draft.kind === 'fixed' ? null : draft.variableNotes || null,
      }
      setConfigs((prev) => {
        const next = { ...prev }
        const targets = draft.applyToAll ? moderators.map((m) => m.id) : [draft.moderatorId!]
        for (const id of targets) {
          next[id] = { moderatorId: id, workspaceId: activeWorkspaceId, updatedAt: now, ...base }
        }
        return next
      })
      showToast(draft.applyToAll ? 'Applied to all moderators (local preview).' : 'Saved locally.', 'success')
      setDraft(null)
      return
    }

    setSaving(true)
    try {
      const base: Omit<CompConfigUpsert, 'moderatorId' | 'workspaceId'> = {
        kind: draft.kind,
        fixedAmount: draft.kind === 'variable' ? null : Number(draft.fixedAmount) || 0,
        fixedCurrency: draft.kind === 'variable' ? null : draft.fixedCurrency,
        fixedPeriod: draft.kind === 'variable' ? null : draft.fixedPeriod,
        variableNotes: draft.kind === 'fixed' ? null : draft.variableNotes || null,
      }
      if (draft.applyToAll) {
        await applyCompensationConfigToAll(activeWorkspaceId, moderators.map((m) => m.id), base)
        const refreshed = await fetchCompensationConfigs(activeWorkspaceId)
        const map: Record<string, CompensationConfig> = {}
        for (const c of refreshed) map[c.moderatorId] = c
        setConfigs(map)
        showToast(`Applied to ${moderators.length} moderators.`, 'success')
      } else if (draft.moderatorId) {
        const saved = await upsertCompensationConfig({
          moderatorId: draft.moderatorId,
          workspaceId: activeWorkspaceId,
          ...base,
        })
        setConfigs((prev) => ({ ...prev, [saved.moderatorId]: saved }))
        showToast('Compensation saved.', 'success')
      }
      setDraft(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save compensation.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Compensation</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Configure fixed and variable pay for each moderator, with a one-click apply-to-all default.
          </p>
        </div>
        <Button variant="secondary" onClick={openApplyToAll} disabled={moderators.length === 0}>
          <Users size={14} />
          Apply to all
        </Button>
      </header>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-[var(--text-secondary)]">
            <Loader2 size={16} className="animate-spin" /> Loading compensation…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<BadgeDollarSign size={20} />}
            title="No moderators yet"
            description="Add moderators from the Moderators section to configure their pay."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border-card)] text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                  <Th>Moderator</Th>
                  <Th>Kind</Th>
                  <Th>Fixed pay</Th>
                  <Th>Currency</Th>
                  <Th>Period</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ mod, cfg }) => (
                  <tr
                    key={mod.id}
                    className="border-b border-[var(--border-card)] last:border-0 transition-colors hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => openEdit(mod)}
                  >
                    <Td>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-cyan)]/60 to-[var(--accent-emerald)]/60 text-xs font-semibold text-white">
                          {mod.avatarInitials}
                        </div>
                        <div>
                          <div className="font-medium text-white">{mod.fullName}</div>
                          <div className="text-xs text-[var(--text-secondary)]">{mod.discordHandle || mod.telegramHandle || 'n/a'}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {cfg ? (
                        <Badge tone={KIND_TONE[cfg.kind]}>{cfg.kind}</Badge>
                      ) : (
                        <span className="text-xs text-[var(--text-secondary)]">Not configured</span>
                      )}
                    </Td>
                    <Td>
                      <span className={cfg?.fixedAmount != null ? 'text-white' : 'text-[var(--text-secondary)]'}>
                        {formatFixed(cfg)}
                      </span>
                    </Td>
                    <Td>{cfg?.fixedCurrency ?? 'n/a'}</Td>
                    <Td className="capitalize">{cfg?.fixedPeriod ?? 'n/a'}</Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(mod)
                        }}
                        className="focus-ring inline-flex items-center gap-1 rounded-lg border border-[var(--border-card)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:text-white hover:border-white/20"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CompensationModal
        draft={draft}
        moderators={moderators}
        saving={saving}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={handleSave}
      />
    </div>
  )
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-5 py-3 text-left font-medium ${className}`}>{children}</th>
}

function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-5 py-3 align-middle ${className}`}>{children}</td>
}

function CompensationModal({
  draft,
  moderators,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  draft: Draft | null
  moderators: Moderator[]
  saving: boolean
  onChange: (d: Draft) => void
  onClose: () => void
  onSave: () => void
}) {
  const open = draft !== null
  const activeMod = draft?.moderatorId ? moderators.find((m) => m.id === draft.moderatorId) ?? null : null
  const title = draft?.applyToAll
    ? 'Apply compensation to all moderators'
    : activeMod
      ? `Edit compensation, ${activeMod.fullName}`
      : 'Edit compensation'

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {draft && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            onSave()
          }}
        >
          {draft.applyToAll && (
            <label className="flex items-start gap-3 rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-3 text-sm">
              <input
                type="checkbox"
                checked={draft.applyToAll}
                onChange={(e) => onChange({ ...draft, applyToAll: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-[var(--border-card)] bg-transparent"
              />
              <span>
                <span className="block font-medium text-white">Apply to every moderator</span>
                <span className="text-xs text-[var(--text-secondary)]">
                  This will overwrite the current config for {moderators.length} moderator{moderators.length === 1 ? '' : 's'}.
                </span>
              </span>
            </label>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-[var(--text-secondary)]">Kind</legend>
            <div className="grid grid-cols-3 gap-2">
              {KIND_OPTIONS.map((opt) => {
                const selected = draft.kind === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange({ ...draft, kind: opt.value })}
                    className={`focus-ring flex flex-col items-start gap-1 rounded-xl border p-3 text-left text-sm transition-colors ${
                      selected
                        ? 'border-[var(--accent-emerald)]/50 bg-[var(--accent-emerald)]/10 text-white shadow-[var(--glow-emerald)]'
                        : 'border-[var(--border-card)] bg-white/[0.02] text-[var(--text-secondary)] hover:border-white/20 hover:text-white'
                    }`}
                  >
                    <span className="font-semibold">{opt.label}</span>
                    <span className="text-xs opacity-80">{opt.hint}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          {(draft.kind === 'fixed' || draft.kind === 'both') && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="Amount">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.fixedAmount}
                  onChange={(e) => onChange({ ...draft, fixedAmount: e.target.value })}
                  className={inputClass}
                  placeholder="0"
                  required
                />
              </FormField>
              <FormField label="Currency">
                <select
                  value={draft.fixedCurrency}
                  onChange={(e) => onChange({ ...draft, fixedCurrency: e.target.value as CompCurrency })}
                  className={inputClass}
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Period">
                <select
                  value={draft.fixedPeriod}
                  onChange={(e) => onChange({ ...draft, fixedPeriod: e.target.value as FixedPeriod })}
                  className={inputClass}
                >
                  {PERIOD_OPTIONS.map((p) => (
                    <option key={p} value={p} className="capitalize">{p}</option>
                  ))}
                </select>
              </FormField>
            </div>
          )}

          {(draft.kind === 'variable' || draft.kind === 'both') && (
            <div className="rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-3">
              <p className="text-xs text-[var(--text-secondary)]">
                Variable pay is computed from the points catalog in{' '}
                <span className="text-white">Moderators → Compensation</span>. This section only owns
                the fixed portion and the mix, use the notes below to record your formula.
              </p>
              <div className="mt-3">
                <FormField label="Variable notes">
                  <textarea
                    value={draft.variableNotes}
                    onChange={(e) => onChange({ ...draft, variableNotes: e.target.value })}
                    className={`${inputClass} min-h-[80px] resize-y`}
                    placeholder="e.g. 1 point per like, cap at $500/mo"
                  />
                </FormField>
              </div>
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={saving}>
              {draft.applyToAll ? 'Apply to all' : 'Save changes'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
