import { useEffect, useMemo, useState } from 'react'
import { Loader2, MessageSquare, ShieldCheck } from 'lucide-react'
import type { Moderator } from '../../../types'
import { fetchMemberMessages, type MemberMessageStat } from '../../../lib/db'
import { useWorkspace } from '../../../context/WorkspaceContext'
import { useAuth } from '../../../context/AuthContext'
import { Card } from '../../ui/Card'
import { Badge } from '../../ui/Badge'
import { formatInt } from './report'

function normHandle(h: string): string {
  const t = h.trim().toLowerCase()
  if (!t) return ''
  return t.startsWith('@') ? t : `@${t}`
}

export function MemberMessagesCard({ moderators }: { moderators: Moderator[] }) {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const [stats, setStats] = useState<MemberMessageStat[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setStats([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchMemberMessages(activeWorkspaceId)
      .then((s) => {
        if (!cancelled) setStats(s)
      })
      .catch(() => {
        if (!cancelled) setStats([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, user])

  const modByHandle = useMemo(() => {
    const map = new Map<string, Moderator>()
    for (const m of moderators) {
      const h = normHandle(m.telegramHandle)
      if (h) map.set(h, m)
    }
    return map
  }, [moderators])

  const top = (stats ?? []).slice(0, 12)
  const max = top[0]?.messages ?? 0

  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-[var(--border-card)] px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
          <MessageSquare size={16} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">Messages per member · Telegram</h3>
          <p className="text-xs text-[var(--text-secondary)]">Last 30 days · moderators are tagged</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--text-secondary)]">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : top.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-[var(--text-secondary)]">
          <MessageSquare size={24} className="text-slate-600" />
          <p className="max-w-md text-sm">
            No message data yet. Enable the Telegram webhook (bot privacy OFF) to start counting messages per member — counts
            accrue from activation onward.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-card)]">
          {top.map((s, i) => {
            const mod = modByHandle.get(normHandle(s.displayName))
            const barPct = max > 0 ? Math.max(2, (s.messages / max) * 100) : 0
            return (
              <li key={s.memberRef} className="flex items-center gap-3 px-5 py-2.5">
                <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-500">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-white">{s.displayName}</span>
                    {mod && (
                      <Badge tone="emerald">
                        <ShieldCheck size={11} /> {mod.fullName.split(' ')[0]}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="gradient-bar-emerald h-full rounded-full" style={{ width: `${barPct}%` }} />
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-white">{formatInt(s.messages)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
