import { useMemo, useState } from 'react'
import { AtSign, ClipboardPaste, Table2, Check, AlertTriangle } from 'lucide-react'
import type { Moderator } from '../../../types'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { X_METRICS, parseAmount } from './comp'

type Mode = 'manual' | 'csv'

interface Props {
  open: boolean
  onClose: () => void
  moderators: Moderator[]
  /** Current stored/effective value for a cell — used to pre-fill the manual grid. */
  valueOf: (moderatorId: string, metricKey: string) => number
  /** Commit one (moderator, metric) value (parent handles guest vs Supabase). */
  onCommit: (moderatorId: string, metricKey: string, value: number) => void
}

/** CSV column order after the leading Name column. */
const CSV_KEYS = X_METRICS.map((m) => m.metricKey) // content_created, likes, retweets, quote_tweets, replies, impressions

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/^@/, '')
}

interface ParsedRow {
  rawName: string
  moderator: Moderator | null
  values: Record<string, number>
}

function matchModerator(name: string, moderators: Moderator[]): Moderator | null {
  const n = normName(name)
  if (!n) return null
  return (
    moderators.find((m) => normName(m.fullName) === n) ??
    moderators.find((m) => normName(m.telegramHandle) === n || normName(m.discordHandle) === n) ??
    moderators.find((m) => normName(m.fullName.split(/\s+/)[0]) === n) ??
    null
  )
}

export function XMetricsImportModal({ open, onClose, moderators, valueOf, onCommit }: Props) {
  const [mode, setMode] = useState<Mode>('manual')

  // ── Manual grid drafts (keyed by `${modId}::${metricKey}`) ──
  const [grid, setGrid] = useState<Record<string, string>>({})

  // ── CSV paste ──
  const [csv, setCsv] = useState('')

  const parsed = useMemo<ParsedRow[]>(() => {
    if (mode !== 'csv') return []
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const rows: ParsedRow[] = []
    for (const line of lines) {
      const cols = line.split(',').map((c) => c.trim())
      const rawName = cols[0] ?? ''
      // Skip an optional header row.
      if (rows.length === 0 && /name/i.test(rawName) && /like|content|impression/i.test(line)) continue
      if (!rawName) continue
      const values: Record<string, number> = {}
      CSV_KEYS.forEach((key, i) => {
        const raw = cols[i + 1]
        if (raw !== undefined && raw !== '') values[key] = parseAmount(raw)
      })
      rows.push({ rawName, moderator: matchModerator(rawName, moderators), values })
    }
    return rows
  }, [csv, mode, moderators])

  const matchedRows = parsed.filter((r) => r.moderator)
  const unmatched = parsed.filter((r) => !r.moderator)

  function gridKey(modId: string, key: string): string {
    return `${modId}::${key}`
  }

  function gridVal(modId: string, key: string): string {
    const k = gridKey(modId, key)
    return grid[k] !== undefined ? grid[k] : String(valueOf(modId, key) || 0)
  }

  function applyManual() {
    let count = 0
    for (const [k, raw] of Object.entries(grid)) {
      const [modId, metricKey] = k.split('::')
      const next = parseAmount(raw)
      if (next !== (valueOf(modId, metricKey) || 0)) {
        onCommit(modId, metricKey, next)
        count++
      }
    }
    onClose()
    return count
  }

  function applyCsv() {
    for (const row of matchedRows) {
      if (!row.moderator) continue
      for (const [metricKey, value] of Object.entries(row.values)) {
        onCommit(row.moderator.id, metricKey, value)
      }
    }
    setCsv('')
    onClose()
  }

  const canApplyCsv = matchedRows.length > 0

  return (
    <Modal open={open} onClose={onClose} title="Import X / Twitter metrics">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-[var(--text-secondary)]">
          X has no live API, so enter each moderator&apos;s numbers by hand or paste a CSV. Values are saved per moderator and count
          toward compensation using the points you set in the catalog.
        </p>

        {/* Mode toggle */}
        <div className="inline-flex w-fit rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1">
          <button
            onClick={() => setMode('manual')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'manual' ? 'gradient-bar text-white' : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <Table2 size={14} /> Quick entry
          </button>
          <button
            onClick={() => setMode('csv')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'csv' ? 'gradient-bar text-white' : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <ClipboardPaste size={14} /> Paste CSV
          </button>
        </div>

        {mode === 'manual' ? (
          moderators.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border-card)] py-10 text-center text-sm text-[var(--text-secondary)]">
              <AtSign size={22} className="text-slate-600" />
              Add a moderator first to enter their X metrics.
            </div>
          ) : (
            <div className="max-h-[52vh] overflow-auto rounded-xl border border-[var(--border-card)]">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-card)] text-left text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                    <th className="sticky left-0 z-10 bg-[var(--bg-card)] px-4 py-2.5 font-medium">Moderator</th>
                    {X_METRICS.map((m) => (
                      <th key={m.metricKey} className="whitespace-nowrap px-2.5 py-2.5 text-right font-medium">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {moderators.map((mod) => (
                    <tr key={mod.id} className="border-b border-[var(--border-card)] last:border-0">
                      <td className="sticky left-0 z-10 bg-[var(--bg-card)] px-4 py-2.5 font-medium text-white">{mod.fullName}</td>
                      {X_METRICS.map((m) => (
                        <td key={m.metricKey} className="px-2.5 py-2 text-right">
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={`${mod.fullName} ${m.label}`}
                            className="w-20 rounded-lg border border-white/[0.09] bg-black/30 px-2 py-1.5 text-right text-sm text-white outline-none focus:border-[color:var(--accent-emerald)]"
                            value={gridVal(mod.id, m.metricKey)}
                            onChange={(e) => setGrid((g) => ({ ...g, [gridKey(mod.id, m.metricKey)]: e.target.value }))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={7}
              spellCheck={false}
              placeholder={'Name,content,likes,retweets,quotes,replies,impressions\nAlex Rivera,4,120,18,6,30,15000\nSam Lee,2,64,9,3,12,8200'}
              className="w-full rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2.5 font-mono text-xs text-white outline-none focus:border-[color:var(--accent-emerald)]"
            />
            <p className="text-[11px] text-[var(--text-secondary)]">
              One row per moderator: <span className="text-slate-300">Name,content,likes,retweets,quotes,replies,impressions</span>. A
              header row is optional. Names are matched to your roster (full name, first name, or @handle).
            </p>

            {parsed.length > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-[var(--accent-emerald-bright)]">
                    <Check size={13} /> {matchedRows.length} matched
                  </span>
                  {unmatched.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-amber-400">
                      <AlertTriangle size={13} /> {unmatched.length} unmatched: {unmatched.map((u) => u.rawName).join(', ')}
                    </span>
                  )}
                </div>
                <div className="max-h-40 overflow-auto">
                  <ul className="flex flex-col gap-1 text-xs">
                    {matchedRows.map((r, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-slate-300">
                        <span className="truncate">
                          <span className="text-white">{r.moderator!.fullName}</span>{' '}
                          <span className="text-slate-500">({r.rawName})</span>
                        </span>
                        <span className="shrink-0 text-slate-400">
                          {CSV_KEYS.map((k) => r.values[k] ?? 0).join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {mode === 'manual' ? (
            <Button onClick={applyManual} disabled={moderators.length === 0}>
              Save metrics
            </Button>
          ) : (
            <Button onClick={applyCsv} disabled={!canApplyCsv}>
              Import {matchedRows.length > 0 ? `${matchedRows.length} row${matchedRows.length === 1 ? '' : 's'}` : ''}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
