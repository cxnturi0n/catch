import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import type { Workspace } from '../../types'
import { QuotaExceededError, useWorkspace } from '../../context/WorkspaceContext'
import { useToast } from '../../context/ToastContext'
import { PROJECT_TYPES } from '../../lib/constants'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { FormField, inputClass } from '../ui/FormControls'
import { QuotaBanner } from '../QuotaBanner'
import { UpgradeModal } from '../UpgradeModal'

// Community size is deliberately not asked here, the user describes the
// project to Catch Intelligence right after creation, in plain language.
const emptyForm = {
  name: '',
  projectType: PROJECT_TYPES[0] as string,
}

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, addWorkspace } = useWorkspace()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const ref = useRef<HTMLDivElement>(null)
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0]

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function closeAddModal() {
    setAddModalOpen(false)
    setForm(emptyForm)
    setError('')
    setSubmitting(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Workspace name is required.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await addWorkspace({
        name: form.name.trim(),
        projectType: form.projectType,
        platforms: [],
      })
      closeAddModal()
      showToast('Workspace created successfully')
      // A brand-new workspace starts in the Catch assistant, where the user
      // describes the project and gets its layout + setup steps.
      navigate('/dashboard/catch')
    } catch (err) {
      setSubmitting(false)
      if (err instanceof QuotaExceededError) {
        closeAddModal()
        setUpgradeOpen(true)
        return
      }
      setError('Failed to create workspace.')
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex w-full items-center gap-2.5 rounded-xl border border-[var(--border-card)] bg-white/[0.02] px-2.5 py-2.5 text-left transition-colors hover:border-white/15 hover:bg-white/[0.04]"
        title={active.name}
      >
        <WorkspaceAvatar workspace={active} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{active.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)] shadow-[0_0_6px_rgba(77,159,255,0.9)]" />
            Active workspace
          </div>
        </div>
        <ChevronsUpDown size={16} className="shrink-0 text-slate-500" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="glow absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1.5"
          >
            {workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  setActiveWorkspaceId(w.id)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/5 transition-colors"
              >
                <WorkspaceAvatar workspace={w} />
                <span className="min-w-0 flex-1 truncate text-sm text-white">{w.name}</span>
                {w.id === activeWorkspaceId && <Check size={15} className="shrink-0 text-blue-400" />}
              </button>
            ))}
            <div className="my-1 h-px bg-[var(--border-card)]" />
            <button
              onClick={() => {
                setOpen(false)
                setAddModalOpen(true)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-[var(--accent-cyan)] hover:bg-white/5 transition-colors"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--border-card)]">
                <Plus size={15} />
              </span>
              Add New Workspace
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={addModalOpen} onClose={closeAddModal} title="Add New Workspace">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <QuotaBanner resource="workspaces" used={workspaces.length} />
          <FormField label="Workspace Name">
            <input
              className={`${inputClass} ${error ? 'border-red-500' : ''}`}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Optimism Collective"
            />
            {error && <span className="text-xs text-red-400">{error}</span>}
          </FormField>
          <FormField label="Project Type">
            <select
              className={inputClass}
              value={form.projectType}
              onChange={(e) => setForm((f) => ({ ...f, projectType: e.target.value }))}
            >
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>
          <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            Once it’s created, tell Catch about the project, platforms, team size, who it’s for, and it shapes the
            workspace around your answer.
          </p>
          <div className="mt-1 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={closeAddModal}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Create Workspace
            </Button>
          </div>
        </form>
      </Modal>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        resource="workspaces"
        used={workspaces.length}
      />
    </div>
  )
}

export function WorkspaceAvatar({ workspace }: { workspace: Workspace }) {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
      style={{ background: `linear-gradient(135deg, ${workspace.colorFrom}, ${workspace.colorTo})` }}
    >
      {workspace.shortName}
    </div>
  )
}
