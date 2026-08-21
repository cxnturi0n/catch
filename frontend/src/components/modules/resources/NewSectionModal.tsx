import { useState } from 'react'
import { Button } from '../../ui/Button'
import { FormField, inputClass } from '../../ui/FormControls'
import { Modal } from '../../ui/Modal'
import { SECTION_TYPES } from '../../../lib/resourceFolders'
import { sectionMeta } from './sectionMeta'

export function NewSectionModal({
  open,
  saving,
  onClose,
  onCreate,
}: {
  open: boolean
  saving: boolean
  onClose: () => void
  onCreate: (name: string, sectionType: string) => void
}) {
  const [sectionType, setSectionType] = useState<string>(SECTION_TYPES[0])
  const [name, setName] = useState('')

  function reset() {
    setSectionType(SECTION_TYPES[0])
    setName('')
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="New section"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          onCreate(name.trim(), sectionType)
        }}
      >
        <FormField label="Section type">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SECTION_TYPES.map((t) => {
              const { icon: Icon } = sectionMeta(t)
              const active = t === sectionType
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSectionType(t)}
                  className={`focus-ring flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                    active
                      ? 'border-[var(--accent-emerald)]/50 bg-[var(--accent-emerald)]/10 text-white'
                      : 'border-[var(--border-card)] bg-white/[0.02] text-[var(--text-secondary)] hover:border-white/20 hover:text-white'
                  }`}
                >
                  <Icon size={15} className={active ? 'text-[var(--accent-emerald)]' : ''} />
                  <span className="truncate">{t}</span>
                </button>
              )
            })}
          </div>
        </FormField>
        <FormField label="Section name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="e.g. Community onboarding"
            required
          />
        </FormField>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset()
              onClose()
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={saving || !name.trim()}>
            Create section
          </Button>
        </div>
      </form>
    </Modal>
  )
}
