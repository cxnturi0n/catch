import { useState } from 'react'
import { Download, Eye, History, Mail, Send, Share2, UserPlus } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { inputClass } from '../../ui/FormControls'
import type { ReportHistoryEntry } from '../../../hooks/useReportHistory'
import { reportDataToPlainText } from '../../../lib/reportBuilder'
import { ShareReportModal } from './ShareReportModal'
import { reportKindLabel, type ReportDataWithMeta } from './reportMeta'

/** A person a report can be emailed to. */
export interface ReportContact {
  name: string
  email: string
}

/** dd/mm/YYYY, the format the History rows use. */
function formatDayMonthYear(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

const ROW_BTN =
  'flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white'

export function ReportHistoryTable({
  entries,
  onView,
  onDownloadPdf,
  contacts,
}: {
  entries: ReportHistoryEntry[]
  onView: (entry: ReportHistoryEntry) => void
  onDownloadPdf: (entry: ReportHistoryEntry) => void
  contacts: ReportContact[]
}) {
  // "Share with…" email picker + the multi-target share sheet, each scoped to a row.
  const [shareWith, setShareWith] = useState<ReportHistoryEntry | null>(null)
  const [shareSheet, setShareSheet] = useState<ReportHistoryEntry | null>(null)
  const [customEmail, setCustomEmail] = useState('')

  function mailtoReport(entry: ReportHistoryEntry, email: string) {
    const data = entry.data
    const subject = encodeURIComponent(`Community Report, ${data.workspaceName}`)
    const body = encodeURIComponent(reportDataToPlainText(data))
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`
    setShareWith(null)
    setCustomEmail('')
  }

  return (
    <Card className="p-6 print:hidden">
      <div className="mb-4 flex items-center gap-2">
        <History size={16} className="text-[var(--text-secondary)]" />
        <h3 className="text-sm font-semibold text-white">Report History</h3>
        <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
          {entries.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-card)] text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Actions</th>
              <th className="px-4 py-3 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-[var(--border-card)] transition-colors last:border-0 hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-slate-300">{formatDayMonthYear(entry.data.generatedAt)}</td>
                <td className="px-4 py-3 text-white">{reportKindLabel(entry.data as ReportDataWithMeta)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => onView(entry)} className={ROW_BTN}>
                      <Eye size={13} /> View
                    </button>
                    <button onClick={() => onDownloadPdf(entry)} className={ROW_BTN}>
                      <Download size={13} /> Download
                    </button>
                    <button onClick={() => { setShareWith(entry); setCustomEmail('') }} className={ROW_BTN}>
                      <UserPlus size={13} /> Share with…
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setShareSheet(entry)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-emerald)]/45 bg-[var(--accent-emerald)]/[0.10] px-2.5 py-1.5 text-xs font-semibold text-[var(--accent-emerald-bright)] transition-colors hover:bg-[var(--accent-emerald)]/20"
                  >
                    <Share2 size={13} /> Share
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-[var(--text-secondary)]">
                  No reports generated yet for this workspace
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* "Share with…", pick a person by name (has an email) or type a custom one. */}
      <Modal open={shareWith !== null} onClose={() => setShareWith(null)} title="Share with…">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Pick a recipient to open a prefilled email with this report.
          </p>

          {contacts.length > 0 ? (
            <div className="flex flex-col gap-2">
              {contacts.map((c) => (
                <button
                  key={`${c.name}-${c.email}`}
                  onClick={() => shareWith && mailtoReport(shareWith, c.email)}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border-card)] bg-white/[0.02] px-4 py-3 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <Mail size={16} className="text-blue-400" />
                  <span>
                    <span className="block text-sm font-medium text-white">{c.name}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">{c.email}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-[var(--border-card)] bg-white/[0.02] px-4 py-3 text-xs text-[var(--text-secondary)]">
              No saved contacts with an email yet, enter one below.
            </p>
          )}

          <div className="flex flex-col gap-2 border-t border-[var(--border-card)] pt-3">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Custom email</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
                placeholder="name@example.com"
                className={`${inputClass} !py-2 text-sm`}
              />
              <Button
                onClick={() => shareWith && customEmail.trim() && mailtoReport(shareWith, customEmail.trim())}
                disabled={!customEmail.trim()}
                size="sm"
              >
                <Send size={14} /> Send
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Multi-target share sheet (native share + Email / WhatsApp / Copy link). */}
      <ShareReportModal open={shareSheet !== null} onClose={() => setShareSheet(null)} data={shareSheet?.data ?? null} />
    </Card>
  )
}
