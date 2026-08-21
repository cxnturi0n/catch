import { Link2, Mail, MessageCircle, Share2 } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import type { ReportData } from '../../../lib/reportBuilder'
import { reportDataToPlainText } from '../../../lib/reportBuilder'
import { formatLongDate } from '../../../lib/format'
import { useToast } from '../../../context/ToastContext'

/**
 * Share sheet for a generated report. The primary action uses the native
 * Web Share API (navigator.share) when the device supports it — that surfaces
 * the user's real targets (WhatsApp, Instagram, Google Drive, OneDrive,
 * iCloud Drive, Mail, …). We provide honest fallbacks (Email via mailto:,
 * WhatsApp via wa.me, and Copy link) for browsers without it. No fake OAuth.
 */
export function ShareReportModal({
  open,
  onClose,
  data,
}: {
  open: boolean
  onClose: () => void
  data: ReportData | null
}) {
  const { showToast } = useToast()

  if (!data) return null
  const reportData = data

  const shareUrl = `https://catch.app/report/${reportData.workspaceSlug}-${reportData.periodEnd.slice(0, 10)}`
  const title = `Community Report — ${reportData.workspaceName}`
  const periodLine = `${formatLongDate(reportData.periodStart)} – ${formatLongDate(reportData.periodEnd)}`
  const plainText = reportDataToPlainText(reportData)
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function handleNativeShare() {
    try {
      await navigator.share({ title, text: `${title}\n${periodLine}`, url: shareUrl })
      onClose()
    } catch (err) {
      // AbortError = user dismissed the sheet; anything else we surface.
      if (err instanceof Error && err.name !== 'AbortError') showToast('Could not open the share sheet', 'error')
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      showToast('Link copied!')
      onClose()
    } catch {
      showToast('Could not copy link', 'error')
    }
  }

  function handleEmail() {
    const subject = encodeURIComponent(title)
    const body = encodeURIComponent(plainText)
    window.location.href = `mailto:?subject=${subject}&body=${body}`
    onClose()
  }

  function handleWhatsapp() {
    const summary = encodeURIComponent(`${title}\n${periodLine}\n${shareUrl}`)
    window.open(`https://wa.me/?text=${summary}`, '_blank', 'noopener,noreferrer')
    onClose()
  }

  const fallbacks = [
    { label: 'Email', icon: Mail, onClick: handleEmail, tone: 'text-blue-400' },
    { label: 'WhatsApp', icon: MessageCircle, onClick: handleWhatsapp, tone: 'text-emerald-400' },
    { label: 'Copy link', icon: Link2, onClick: handleCopyLink, tone: 'text-sky-400' },
  ]

  return (
    <Modal open={open} onClose={onClose} title="Share report">
      <div className="flex flex-col gap-3">
        {canNativeShare && (
          <>
            <button
              onClick={handleNativeShare}
              className="flex items-center gap-3 rounded-xl border border-[var(--accent-emerald)]/50 bg-[var(--accent-emerald)]/[0.10] px-4 py-3 text-left text-sm font-semibold text-[var(--accent-emerald-bright)] transition-colors hover:bg-[var(--accent-emerald)]/20"
            >
              <Share2 size={18} />
              <span>
                Share via device…
                <span className="mt-0.5 block text-xs font-normal text-[var(--text-secondary)]">
                  WhatsApp, Instagram, Drive, OneDrive, iCloud, Mail and more
                </span>
              </span>
            </button>
            <div className="my-1 flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-500">
              <span className="h-px flex-1 bg-[var(--border-card)]" />
              or
              <span className="h-px flex-1 bg-[var(--border-card)]" />
            </div>
          </>
        )}

        {!canNativeShare && (
          <p className="text-xs text-[var(--text-secondary)]">
            Send this report through one of your apps. These route through your device.
          </p>
        )}

        {fallbacks.map((opt) => {
          const Icon = opt.icon
          return (
            <button
              key={opt.label}
              onClick={opt.onClick}
              className="flex items-center gap-3 rounded-xl border border-[var(--border-card)] bg-white/[0.02] px-4 py-3 text-left text-sm font-medium text-white transition-colors hover:bg-white/[0.05]"
            >
              <Icon size={18} className={opt.tone} />
              {opt.label}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
