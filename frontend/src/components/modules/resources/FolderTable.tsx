import { Files, Pin, Trash2 } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Card } from '../../ui/Card'
import { formatRelativeTime } from '../../../lib/format'
import { sectionMeta } from './sectionMeta'

export interface FolderRowVM {
  id: string
  name: string
  sectionType: string
  fileCount: number
  lastUpdated: string | null
  pinned: boolean
  isUnfiled: boolean
}

export function FolderTable({
  folders,
  onOpen,
  onTogglePin,
  onDelete,
}: {
  folders: FolderRowVM[]
  onOpen: (id: string) => void
  onTogglePin: (row: FolderRowVM) => void
  onDelete: (row: FolderRowVM) => void
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-card)] text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Files</th>
              <th className="px-4 py-3 font-medium">Updated</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {folders.map((f) => {
              const { icon: Icon, tone } = sectionMeta(f.sectionType)
              return (
                <tr key={f.id} className="border-b border-[var(--border-card)]/60 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onOpen(f.id)}
                      className="focus-ring flex items-center gap-2.5 rounded-lg text-left font-medium text-white hover:text-[var(--accent-emerald)]"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--accent-emerald)]">
                        <Icon size={15} />
                      </span>
                      <span className="truncate">{f.name}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={f.isUnfiled ? 'gray' : tone}>{f.isUnfiled ? 'Unfiled' : f.sectionType}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1">
                      <Files size={13} />
                      {f.fileCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {f.lastUpdated ? formatRelativeTime(f.lastUpdated) : 'n/a'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {!f.isUnfiled && (
                        <>
                          <button
                            type="button"
                            onClick={() => onTogglePin(f)}
                            aria-label={f.pinned ? 'Unpin section' : 'Pin section'}
                            className={`focus-ring rounded-lg border p-1.5 ${
                              f.pinned
                                ? 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
                                : 'border-transparent text-slate-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'
                            }`}
                          >
                            <Pin size={13} className={f.pinned ? 'fill-current' : ''} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(f)}
                            aria-label="Delete section"
                            className="focus-ring rounded-lg border border-transparent p-1.5 text-slate-400 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
