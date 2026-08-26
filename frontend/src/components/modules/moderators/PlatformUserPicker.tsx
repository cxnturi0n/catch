import { useEffect, useState } from 'react'
import { Link2, Loader2, X } from 'lucide-react'
import { fetchPlatformMembers, type MessagePlatform, type PlatformMember } from '../../../lib/api/metrics'
import { inputClass } from '../../ui/FormControls'

export interface LinkedUser {
  id: string
  name: string | null
}

/**
 * Typeahead over members seen in the last 30 days (plus Telegram admins) so a
 * moderator can be linked to a stable platform user id instead of a handle.
 */
export function PlatformUserPicker({ workspaceId, platform, value, onChange }: { workspaceId: string | null; platform: MessagePlatform; value: LinkedUser | null; onChange: (v: LinkedUser | null) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<PlatformMember[]>([])
  const [loading, setLoading] = useState(false)
  const label = platform === 'discord' ? 'Discord' : 'Telegram'

  useEffect(() => {
    if (!open || !workspaceId) return
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      fetchPlatformMembers(workspaceId, platform, q.trim(), 12)
        .then((r) => !cancelled && setRows(r))
        .catch(() => !cancelled && setRows([]))
        .finally(() => !cancelled && setLoading(false))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, q, platform, workspaceId])

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-[var(--accent-emerald)]/40 bg-white/[0.03] px-3 py-2 text-xs">
        <span className="flex items-center gap-2 text-white">
          <Link2 size={12} className="text-[var(--accent-emerald)]" />
          Linked {label} user: <span className="font-medium">{value.name ?? value.id}</span>
          <span className="text-[var(--text-secondary)]">({value.id})</span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-[var(--text-secondary)] hover:text-white" aria-label={`Unlink ${label} user`}>
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        className={inputClass}
        value={q}
        disabled={!workspaceId}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={workspaceId ? `Link a ${label} user seen recently` : 'Connect the platform first'}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] shadow-lg">
          {loading && rows.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)]">
              <Loader2 size={12} className="animate-spin" /> Searching
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">No members seen in the last 30 days.</div>
          ) : (
            rows.map((r) => (
              <button
                type="button"
                key={r.memberRef}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ id: r.memberRef, name: r.displayName })
                  setOpen(false)
                  setQ('')
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-white/[0.05]"
              >
                <span className="text-white">
                  {r.displayName ?? r.memberRef}
                  {r.isAdmin && <span className="ml-2 rounded-full bg-[var(--accent-emerald)]/20 px-1.5 py-0.5 text-[10px] text-[var(--accent-emerald)]">admin</span>}
                </span>
                <span className="text-[var(--text-secondary)]">{r.messages} msgs</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
