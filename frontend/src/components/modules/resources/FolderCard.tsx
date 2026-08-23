import { File as FileIcon, Link as LinkIcon, Pin, Trash2 } from 'lucide-react'
import { Card } from '../../ui/Card'
import { formatRelativeTime } from '../../../lib/format'
import type { FolderFilePreview } from '../../../lib/resourceFolders'
import { sectionMeta } from './sectionMeta'

export interface FolderCardProps {
  name: string
  sectionType: string
  fileCount: number
  lastUpdated: string | null
  pinned: boolean
  /** Newest-first preview of the files inside, rendered as inset rows. */
  filePreview?: FolderFilePreview[]
  /** The "Unfiled" pseudo-folder, no pin / delete controls. */
  isUnfiled?: boolean
  onOpen: () => void
  onTogglePin?: () => void
  onDelete?: () => void
}

export function FolderCard({
  name,
  sectionType,
  fileCount,
  lastUpdated,
  pinned,
  filePreview = [],
  isUnfiled = false,
  onOpen,
  onTogglePin,
  onDelete,
}: FolderCardProps) {
  const { icon: Icon, accent } = sectionMeta(sectionType)
  const pillLabel = isUnfiled ? 'Unfiled' : sectionType
  const overflow = fileCount - filePreview.length

  return (
    <Card hover className="group relative">
      {/* Whole box is the open control, folder behaviour. */}
      <button
        type="button"
        onClick={onOpen}
        className="focus-ring flex w-full flex-col gap-3.5 rounded-2xl p-4 text-left"
      >
        {/* Header: tinted icon tile + name/meta, type pill top-right */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl border"
              style={{ backgroundColor: `${accent}1f`, borderColor: `${accent}3d`, color: accent }}
            >
              <Icon size={17} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-white">{name}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
                {fileCount} {fileCount === 1 ? 'file' : 'files'}
                {' · '}
                {lastUpdated ? `updated ${formatRelativeTime(lastUpdated)}` : 'empty'}
              </div>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-opacity ${
              isUnfiled ? '' : 'group-hover:opacity-0 group-focus-within:opacity-0'
            }`}
            style={{ backgroundColor: `${accent}1a`, color: accent }}
          >
            {pillLabel}
          </span>
        </div>

        {/* Body: files inside as inset rows */}
        {filePreview.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {filePreview.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5"
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)]"
                  style={{ backgroundColor: `${accent}14` }}
                >
                  {f.kind === 'file' ? <FileIcon size={12} /> : <LinkIcon size={12} />}
                </span>
                <span className="min-w-0 truncate text-xs text-[var(--text-secondary)]">{f.title}</span>
              </div>
            ))}
            {overflow > 0 && (
              <div className="px-2.5 pt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                +{overflow} more
              </div>
            )}
          </div>
        )}
      </button>

      {!isUnfiled && (
        <div className="pointer-events-none absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              aria-label={pinned ? 'Unpin section' : 'Pin section'}
              className={`focus-ring pointer-events-auto rounded-lg border p-1.5 ${
                pinned
                  ? 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
                  : 'border-transparent text-slate-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <Pin size={13} className={pinned ? 'fill-current' : ''} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete section"
              className="focus-ring pointer-events-auto rounded-lg border border-transparent p-1.5 text-slate-400 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
    </Card>
  )
}
