import { useEffect, useState, type FormEvent } from 'react'
import type { Warning, WarningSeverity } from '../../../types'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { FormField, inputClass } from '../../ui/FormControls'
import { useAuth } from '../../../context/AuthContext'

const SEVERITIES: WarningSeverity[] = ['Low', 'Medium', 'High']

export function AddWarningModal({
  open,
  onClose,
  moderatorName,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  moderatorName: string
  onSubmit: (warning: Warning) => void | Promise<void>
}) {
  const { user } = useAuth()
  const [reason, setReason] = useState('')
  const [severity, setSeverity] = useState<WarningSeverity>('Low')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setReason('')
      setSeverity('Low')
      setError('')
      setSubmitting(false)
    }
  }, [open])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!reason.trim()) {
      setError('Describe the reason for this warning.')
      return
    }
    setError('')
    setSubmitting(true)
    setTimeout(async () => {
      try {
        await onSubmit({
          id: `warn-${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          reason: reason.trim(),
          severity,
          issuedBy: user?.name ?? 'Unknown',
        })
      } finally {
        setSubmitting(false)
      }
    }, 400)
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add Warning — ${moderatorName}`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField label="Severity">
          <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value as WarningSeverity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Reason">
          <textarea
            className={`${inputClass} min-h-24 resize-none ${error ? 'border-red-500' : ''}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe what happened..."
          />
          {error && <span className="text-xs text-red-400">{error}</span>}
        </FormField>
        <div className="mt-1 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting} variant="danger">
            Issue Warning
          </Button>
        </div>
      </form>
    </Modal>
  )
}
