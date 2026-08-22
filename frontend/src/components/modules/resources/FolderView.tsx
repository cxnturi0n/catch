import { useEffect, useState } from 'react'
import {
  ExternalLink,
  File as FileIcon,
  Link as LinkIcon,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/Card'
import { FormField, inputClass } from '../../ui/FormControls'
import { Modal } from '../../ui/Modal'
import { formatRelativeTime } from '../../../lib/format'
import { deleteResource, getResourceSignedUrl } from '../../../lib/dbPlatformV2'
import { fetchFolderFiles, insertFolderResource, type FolderFile } from '../../../lib/resourceFolders'
import type { WorkspaceId } from '../../../types'
import { sectionMeta } from './sectionMeta'

function formatBytes(n: number | null): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export interface FolderTarget {
  id: string | null // null = Unfiled pseudo-folder
  name: string
  sectionType: string
  isUnfiled: boolean
}

export function FolderView({
  target,
  workspaceId,
  userId,
  onClose,
  onChanged,
  showToast,
}: {
  target: FolderTarget
  workspaceId: WorkspaceId
  userId: string | null
  onClose: () => void
  onChanged: () => void
  showToast: (msg: string, tone: 'success' | 'error') => void
}) {
  const [files, setFiles] = useState<FolderFile[]>([])
  const [loading, setLoading] = useState(true)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [mode, setMode] = useState<'none' | 'file' | 'link'>('none')
  const [saving, setSaving] = useState(false)

  // file draft
  const [file, setFile] = useState<File | null>(null)
  const [fileTitle, setFileTitle] = useState('')
  // link draft
  const [url, setUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')

  const { icon: Icon, tone } = sectionMeta(target.sectionType)
  const canImport = target.id !== null && userId !== null

  async function loadFiles() {
    setLoading(true)
    try {
      const list = await fetchFolderFiles(workspaceId, target.id)
      setFiles(list)
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadFiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id])

  function resetForms() {
    setMode('none')
    setFile(null)
    setFileTitle('')
    setUrl('')
    setLinkTitle('')
  }

  async function openFile(f: FolderFile) {
    setOpeningId(f.id)
    try {
      let signed = f.externalUrl ?? ''
      if (f.kind === 'file' && f.storagePath) signed = await getResourceSignedUrl(workspaceId, f.id)
      if (!signed) throw new Error('No URL available for this resource.')
      window.open(signed, '_blank', 'noopener,noreferrer')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open resource.', 'error')
    } finally {
      setOpeningId(null)
    }
  }

  async function submitFile() {
    if (!file || !fileTitle.trim() || !userId || target.id === null) return
    setSaving(true)
    try {
      await insertFolderResource({
        workspaceId,
        folderId: target.id,
        kind: 'file',
        title: fileTitle.trim(),
        file,
      })
      showToast('File imported.', 'success')
      resetForms()
      await loadFiles()
      onChanged()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function submitLink() {
    if (!url.trim() || !linkTitle.trim() || !userId || target.id === null) return
    setSaving(true)
    try {
      await insertFolderResource({
        workspaceId,
        folderId: target.id,
        kind: 'external_link',
        title: linkTitle.trim(),
        externalUrl: url.trim(),
        createdBy: userId,
      })
      showToast('Link added.', 'success')
      resetForms()
      await loadFiles()
      onChanged()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add link.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function removeFile(f: FolderFile) {
    setSaving(true)
    try {
      await deleteResource(workspaceId, f.id)
      setFiles((prev) => prev.filter((x) => x.id !== f.id))
      showToast('Removed.', 'success')
      onChanged()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={target.name}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--accent-emerald)]">
              <Icon size={17} />
            </span>
            <Badge tone={target.isUnfiled ? 'gray' : tone}>
              {target.isUnfiled ? 'Unfiled' : target.sectionType}
            </Badge>
          </div>
          {canImport && mode === 'none' && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setMode('link')}>
                <LinkIcon size={13} /> Add link
              </Button>
              <Button size="sm" onClick={() => setMode('file')}>
                <Upload size={13} /> Upload file
              </Button>
            </div>
          )}
        </div>

        {mode === 'file' && (
          <form
            className="flex flex-col gap-3 rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submitFile()
            }}
          >
            <FormField label="File">
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-white/5 file:px-3 file:py-1 file:text-white`}
                required
              />
            </FormField>
            <FormField label="Title">
              <input
                type="text"
                value={fileTitle}
                onChange={(e) => setFileTitle(e.target.value)}
                className={inputClass}
                placeholder="Onboarding deck"
                required
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={resetForms} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={saving} disabled={saving || !file || !fileTitle.trim()}>
                Import
              </Button>
            </div>
          </form>
        )}

        {mode === 'link' && (
          <form
            className="flex flex-col gap-3 rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submitLink()
            }}
          >
            <FormField label="URL">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={inputClass}
                placeholder="https://drive.google.com/…"
                required
              />
            </FormField>
            <FormField label="Title">
              <input
                type="text"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                className={inputClass}
                placeholder="Brand kit — Notion"
                required
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={resetForms} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={saving} disabled={saving || !url.trim() || !linkTitle.trim()}>
                Add link
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--text-secondary)]">
            <Loader2 size={16} className="animate-spin" /> Loading files…
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            icon={<FileIcon size={18} />}
            title="No files yet"
            description={
              canImport
                ? 'Upload a file or add a link to fill this section.'
                : target.isUnfiled
                  ? 'Older resources with no section appear here.'
                  : 'Sign in to import files.'
            }
          />
        ) : (
          <ul className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto">
            {files.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-2.5"
              >
                <button
                  type="button"
                  onClick={() => openFile(f)}
                  className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--accent-emerald)]">
                    {f.kind === 'file' ? <FileIcon size={14} /> : <LinkIcon size={14} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">{f.title}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      {f.kind === 'file' ? formatBytes(f.sizeBytes) : 'external link'} · {formatRelativeTime(f.createdAt)}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {openingId === f.id ? (
                    <Loader2 size={14} className="animate-spin text-slate-400" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => openFile(f)}
                      aria-label="Open"
                      className="focus-ring rounded-lg border border-transparent p-1.5 text-slate-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                    >
                      <ExternalLink size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(f)}
                    disabled={saving}
                    aria-label="Remove file"
                    className="focus-ring rounded-lg border border-transparent p-1.5 text-slate-400 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
