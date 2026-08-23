import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  FolderOpen,
  LayoutGrid,
  Link as LinkIcon,
  List as ListIcon,
  Loader2,
  Plus,
  Rows3,
  Search,
  Upload,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { Button } from '../ui/Button'
import { Card, EmptyState } from '../ui/Card'
import { FormField, inputClass } from '../ui/FormControls'
import { Modal } from '../ui/Modal'
import {
  SECTION_TYPES,
  createFolder,
  deleteFolder,
  fetchFolders,
  fetchUnfiledCount,
  insertFolderResource,
  togglePinFolder,
  type FolderFilePreview,
  type FolderWithStats,
} from '../../lib/resourceFolders'
import { FolderCard } from './resources/FolderCard'
import { FolderTable, type FolderRowVM } from './resources/FolderTable'
import { FolderView, type FolderTarget } from './resources/FolderView'
import { NewSectionModal } from './resources/NewSectionModal'

type ViewMode = 'grid' | 'list' | 'type'

interface DisplayFolder {
  id: string | null
  name: string
  sectionType: string
  fileCount: number
  lastUpdated: string | null
  pinned: boolean
  isUnfiled: boolean
  filePreview: FolderFilePreview[]
}

type UnfiledState = { count: number; lastUpdated: string | null; filePreview: FolderFilePreview[] }

const UNFILED_NAME = 'Unfiled'

export function Resources() {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [folders, setFolders] = useState<FolderWithStats[]>([])
  const [unfiled, setUnfiled] = useState<UnfiledState>({
    count: 0,
    lastUpdated: null,
    filePreview: [],
  })
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState<ViewMode>('grid')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('All')

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [sectionModal, setSectionModal] = useState(false)
  const [savingSection, setSavingSection] = useState(false)

  const [uploadDraft, setUploadDraft] = useState<{ file: File | null; title: string } | null>(null)
  const [linkDraft, setLinkDraft] = useState<{ url: string; title: string } | null>(null)
  const [savingResource, setSavingResource] = useState(false)

  const [folderTarget, setFolderTarget] = useState<FolderTarget | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DisplayFolder | null>(null)
  const [savingDelete, setSavingDelete] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      if (!user) {
        if (!cancelled) {
          setFolders([])
          setUnfiled({ count: 0, lastUpdated: null, filePreview: [] })
          setLoading(false)
        }
        return
      }
      try {
        const [f, u] = await Promise.all([
          fetchFolders(activeWorkspaceId),
          fetchUnfiledCount(activeWorkspaceId),
        ])
        if (!cancelled) {
          setFolders(f)
          setUnfiled(u)
        }
      } catch {
        if (!cancelled) {
          setFolders([])
          setUnfiled({ count: 0, lastUpdated: null, filePreview: [] })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, user])

  async function refresh() {
    if (!user) return
    try {
      const [f, u] = await Promise.all([
        fetchFolders(activeWorkspaceId),
        fetchUnfiledCount(activeWorkspaceId),
      ])
      setFolders(f)
      setUnfiled(u)
    } catch {
      /* toast surfaced by caller */
    }
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // ── Build the display list (folders + Unfiled pseudo-folder) ──
  const displayFolders = useMemo<DisplayFolder[]>(() => {
    const list: DisplayFolder[] = folders.map((f) => ({
      id: f.id,
      name: f.name,
      sectionType: f.sectionType,
      fileCount: f.fileCount,
      lastUpdated: f.lastUpdated,
      pinned: f.pinned,
      isUnfiled: false,
      filePreview: f.filePreview,
    }))
    if (unfiled.count > 0) {
      list.push({
        id: null,
        name: UNFILED_NAME,
        sectionType: UNFILED_NAME,
        fileCount: unfiled.count,
        lastUpdated: unfiled.lastUpdated,
        pinned: false,
        isUnfiled: true,
        filePreview: unfiled.filePreview,
      })
    }
    return list
  }, [folders, unfiled])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return displayFolders.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q)) return false
      if (category !== 'All' && f.sectionType !== category) return false
      return true
    })
  }, [displayFolders, query, category])

  const isDefaultView = category === 'All' && query.trim() === ''

  const pinned = useMemo(() => filtered.filter((f) => f.pinned && !f.isUnfiled), [filtered])
  const recentlyUpdated = useMemo(() => {
    return [...filtered]
      .filter((f) => !f.pinned)
      .sort((a, b) => (a.lastUpdated ?? '') < (b.lastUpdated ?? '') ? 1 : -1)
      .slice(0, 4)
  }, [filtered])

  const groupedByType = useMemo(() => {
    const groups = new Map<string, DisplayFolder[]>()
    for (const f of filtered) {
      const arr = groups.get(f.sectionType) ?? []
      arr.push(f)
      groups.set(f.sectionType, arr)
    }
    return Array.from(groups.entries())
  }, [filtered])

  // ── Handlers ──
  async function handleCreateSection(name: string, sectionType: string) {
    if (!user) {
      showToast('Sign in to create sections.', 'error')
      return
    }
    setSavingSection(true)
    try {
      const created = await createFolder({
        workspaceId: activeWorkspaceId,
        name,
        sectionType,
        createdBy: user.id,
      })
      showToast('Section created.', 'success')
      setSectionModal(false)
      await refresh()
      setFolderTarget({ id: created.id, name: created.name, sectionType: created.sectionType, isUnfiled: false })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create section.', 'error')
    } finally {
      setSavingSection(false)
    }
  }

  async function handleUpload() {
    if (!uploadDraft?.file || !uploadDraft.title.trim() || !user) return
    setSavingResource(true)
    try {
      await insertFolderResource({
        workspaceId: activeWorkspaceId,
        folderId: null,
        kind: 'file',
        title: uploadDraft.title.trim(),
        file: uploadDraft.file,
      })
      showToast('File uploaded to Unfiled.', 'success')
      setUploadDraft(null)
      await refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed.', 'error')
    } finally {
      setSavingResource(false)
    }
  }

  async function handleLink() {
    if (!linkDraft?.url.trim() || !linkDraft.title.trim() || !user) return
    setSavingResource(true)
    try {
      await insertFolderResource({
        workspaceId: activeWorkspaceId,
        folderId: null,
        kind: 'external_link',
        title: linkDraft.title.trim(),
        externalUrl: linkDraft.url.trim(),
        createdBy: user.id,
      })
      showToast('Link added to Unfiled.', 'success')
      setLinkDraft(null)
      await refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add link.', 'error')
    } finally {
      setSavingResource(false)
    }
  }

  async function handleTogglePin(f: DisplayFolder) {
    if (f.id === null) return
    // optimistic
    setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, pinned: !f.pinned } : x)))
    try {
      await togglePinFolder(activeWorkspaceId, f.id, !f.pinned)
    } catch (err) {
      setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, pinned: f.pinned } : x)))
      showToast(err instanceof Error ? err.message : 'Failed to update pin.', 'error')
    }
  }

  async function handleDelete() {
    if (!confirmDelete || confirmDelete.id === null) return
    setSavingDelete(true)
    try {
      await deleteFolder(activeWorkspaceId, confirmDelete.id)
      showToast('Section deleted. Its files moved to Unfiled.', 'success')
      setConfirmDelete(null)
      await refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed.', 'error')
    } finally {
      setSavingDelete(false)
    }
  }

  function openFolder(f: DisplayFolder) {
    setFolderTarget({ id: f.id, name: f.name, sectionType: f.sectionType, isUnfiled: f.isUnfiled })
  }

  function toRowVMs(items: DisplayFolder[]): FolderRowVM[] {
    return items.map((f) => ({
      id: f.id ?? UNFILED_NAME,
      name: f.name,
      sectionType: f.sectionType,
      fileCount: f.fileCount,
      lastUpdated: f.lastUpdated,
      pinned: f.pinned,
      isUnfiled: f.isUnfiled,
    }))
  }

  const byId = useMemo(() => {
    const m = new Map<string, DisplayFolder>()
    for (const f of filtered) m.set(f.id ?? UNFILED_NAME, f)
    return m
  }, [filtered])

  const categories = ['All', ...SECTION_TYPES]

  function renderGridCards(items: DisplayFolder[]) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((f) => (
          <FolderCard
            key={f.id ?? UNFILED_NAME}
            name={f.name}
            sectionType={f.sectionType}
            fileCount={f.fileCount}
            lastUpdated={f.lastUpdated}
            pinned={f.pinned}
            filePreview={f.filePreview}
            isUnfiled={f.isUnfiled}
            onOpen={() => openFolder(f)}
            onTogglePin={f.isUnfiled ? undefined : () => handleTogglePin(f)}
            onDelete={f.isUnfiled ? undefined : () => setConfirmDelete(f)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Resources</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            A knowledge drive for your team, organise files and links into typed sections.
          </p>
        </div>
        <div className="relative" ref={menuRef}>
          <Button onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>
            <Plus size={14} /> New resource <ChevronDown size={14} />
          </Button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-[var(--border-card)] bg-[#0b1018] p-1 shadow-2xl"
            >
              <MenuItem
                icon={<FolderOpen size={14} />}
                label="New section"
                onClick={() => {
                  setMenuOpen(false)
                  setSectionModal(true)
                }}
              />
              <MenuItem
                icon={<Upload size={14} />}
                label="Upload file"
                onClick={() => {
                  setMenuOpen(false)
                  setUploadDraft({ file: null, title: '' })
                }}
              />
              <MenuItem
                icon={<LinkIcon size={14} />}
                label="Add link"
                onClick={() => {
                  setMenuOpen(false)
                  setLinkDraft({ url: '', title: '' })
                }}
              />
            </div>
          )}
        </div>
      </header>

      {/* Controls: search + category chips + view toggle */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 sm:max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sections…"
              className={`${inputClass} pl-9`}
            />
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-1">
            <ViewButton active={view === 'grid'} label="Grid" onClick={() => setView('grid')}>
              <LayoutGrid size={15} />
            </ViewButton>
            <ViewButton active={view === 'list'} label="List" onClick={() => setView('list')}>
              <ListIcon size={15} />
            </ViewButton>
            <ViewButton active={view === 'type'} label="By type" onClick={() => setView('type')}>
              <Rows3 size={15} />
            </ViewButton>
          </div>
        </div>
        <div className="-mx-1 flex flex-wrap gap-2 px-1">
          {categories.map((c) => {
            const active = category === c
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={active}
                style={
                  active
                    ? {
                        background:
                          'linear-gradient(90deg, rgba(91,140,255,.32), rgba(47,107,255,.16))',
                        borderColor: 'rgba(120,160,255,.34)',
                      }
                    : undefined
                }
                className={`focus-ring rounded-[20px] border px-[14px] py-[7px] text-xs font-medium transition-colors ${
                  active
                    ? 'text-white'
                    : 'border-[var(--border-card)] bg-white/[0.02] text-[var(--text-secondary)] hover:border-white/20 hover:text-white'
                }`}
              >
                {c}
              </button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <Card className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-[var(--text-secondary)]">
          <Loader2 size={16} className="animate-spin" /> Loading resources…
        </Card>
      ) : displayFolders.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={20} />}
          title={user ? 'No sections yet' : 'Sign in to manage resources'}
          description={
            user
              ? 'Create your first section, a Playbook, SOP, Template and more, then import files and links into it.'
              : 'Guest mode preview, resources persist once you sign in.'
          }
          action={
            user ? (
              <Button onClick={() => setSectionModal(true)}>
                <FolderOpen size={14} /> New section
              </Button>
            ) : null
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={20} />}
          title="Nothing matches"
          description="Try a different search term or category filter."
        />
      ) : view === 'list' ? (
        <FolderTable
          folders={toRowVMs(filtered)}
          onOpen={(id) => {
            const f = byId.get(id)
            if (f) openFolder(f)
          }}
          onTogglePin={(row) => {
            const f = byId.get(row.id)
            if (f) void handleTogglePin(f)
          }}
          onDelete={(row) => {
            const f = byId.get(row.id)
            if (f) setConfirmDelete(f)
          }}
        />
      ) : view === 'type' ? (
        <div className="flex flex-col gap-6">
          {groupedByType.map(([type, items]) => (
            <section key={type} className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                {type} <span className="text-slate-600">· {items.length}</span>
              </h3>
              {renderGridCards(items)}
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {isDefaultView && pinned.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Pinned</h3>
              {renderGridCards(pinned)}
            </section>
          )}
          {isDefaultView && recentlyUpdated.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Recently updated
              </h3>
              {renderGridCards(recentlyUpdated)}
            </section>
          )}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              {isDefaultView ? 'All resources' : 'Results'}
            </h3>
            {renderGridCards(filtered)}
          </section>
        </div>
      )}

      {/* Open folder */}
      {folderTarget && (
        <FolderView
          target={folderTarget}
          workspaceId={activeWorkspaceId}
          userId={user?.id ?? null}
          onClose={() => setFolderTarget(null)}
          onChanged={() => void refresh()}
          showToast={showToast}
        />
      )}

      <NewSectionModal
        open={sectionModal}
        saving={savingSection}
        onClose={() => setSectionModal(false)}
        onCreate={handleCreateSection}
      />

      {/* Top-level upload → Unfiled */}
      <Modal open={uploadDraft !== null} onClose={() => setUploadDraft(null)} title="Upload a file">
        {uploadDraft && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void handleUpload()
            }}
          >
            <p className="text-xs text-[var(--text-secondary)]">
              This file lands in <span className="text-white">Unfiled</span>. Open a section to import directly into it.
            </p>
            <FormField label="File">
              <input
                type="file"
                onChange={(e) => setUploadDraft({ ...uploadDraft, file: e.target.files?.[0] ?? null })}
                className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-white/5 file:px-3 file:py-1 file:text-white`}
                required
              />
            </FormField>
            <FormField label="Title">
              <input
                type="text"
                value={uploadDraft.title}
                onChange={(e) => setUploadDraft({ ...uploadDraft, title: e.target.value })}
                className={inputClass}
                placeholder="Team onboarding deck"
                required
              />
            </FormField>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setUploadDraft(null)} disabled={savingResource}>
                Cancel
              </Button>
              <Button type="submit" loading={savingResource} disabled={savingResource || !uploadDraft.file || !uploadDraft.title.trim()}>
                Upload
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Top-level link → Unfiled */}
      <Modal open={linkDraft !== null} onClose={() => setLinkDraft(null)} title="Add an external link">
        {linkDraft && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void handleLink()
            }}
          >
            <p className="text-xs text-[var(--text-secondary)]">
              This link lands in <span className="text-white">Unfiled</span>. Open a section to import directly into it.
            </p>
            <FormField label="URL">
              <input
                type="url"
                value={linkDraft.url}
                onChange={(e) => setLinkDraft({ ...linkDraft, url: e.target.value })}
                className={inputClass}
                placeholder="https://drive.google.com/…"
                required
              />
            </FormField>
            <FormField label="Title">
              <input
                type="text"
                value={linkDraft.title}
                onChange={(e) => setLinkDraft({ ...linkDraft, title: e.target.value })}
                className={inputClass}
                placeholder="Brand kit, Notion"
                required
              />
            </FormField>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setLinkDraft(null)} disabled={savingResource}>
                Cancel
              </Button>
              <Button type="submit" loading={savingResource} disabled={savingResource || !linkDraft.url.trim() || !linkDraft.title.trim()}>
                Add link
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete section confirm */}
      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete section?">
        {confirmDelete && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--text-secondary)]">
              This removes the section <span className="text-white">{confirmDelete.name}</span>. Its{' '}
              {confirmDelete.fileCount} file{confirmDelete.fileCount === 1 ? '' : 's'} are kept and moved to{' '}
              <span className="text-white">Unfiled</span>.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(null)} disabled={savingDelete}>
                Cancel
              </Button>
              <Button type="button" variant="danger" loading={savingDelete} onClick={handleDelete}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-white"
    >
      <span className="text-[var(--accent-emerald)]">{icon}</span>
      {label}
    </button>
  )
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`focus-ring flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active ? 'bg-white/[0.08] text-white' : 'text-[var(--text-secondary)] hover:text-white'
      }`}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
