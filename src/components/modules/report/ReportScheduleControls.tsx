import { useEffect, useState } from 'react'
import { Clock, Mail, Send } from 'lucide-react'
import { Button } from '../../ui/Button'
import { inputClass } from '../../ui/FormControls'
import { useToast } from '../../../context/ToastContext'
import {
  defaultSchedule,
  fetchReportSchedule,
  upsertReportSchedule,
  WEEKDAYS,
  type ReportCadence,
  type ReportSchedule,
} from '../../../lib/reportSchedules'
import { type ReportType } from '../../../lib/reportModel'

const CADENCES: { id: ReportCadence; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
]

/**
 * Email-automation cadence UI (#6). Sits to the RIGHT of the date-range selector.
 * Guest-safe: when `canPersist` is false (no signed-in user / local workspace)
 * the controls stay interactive but saving is disabled with an inline hint,
 * since schedules live in Supabase. Saving here only stores the schedule — the
 * `send-report` edge function + RESEND_API_KEY are what actually dispatch it.
 */
export function ReportScheduleControls({
  workspaceId,
  canPersist,
  defaultEmail,
  currentReportType,
}: {
  workspaceId: string
  canPersist: boolean
  defaultEmail: string
  currentReportType: ReportType
}) {
  const { showToast } = useToast()
  const [schedule, setSchedule] = useState<ReportSchedule>(() => ({ ...defaultSchedule(defaultEmail), reportType: currentReportType }))
  const [loading, setLoading] = useState(canPersist)
  const [saving, setSaving] = useState(false)

  // Load the persisted schedule for this workspace (signed-in only).
  useEffect(() => {
    if (!canPersist) {
      setSchedule({ ...defaultSchedule(defaultEmail), reportType: currentReportType })
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchReportSchedule(workspaceId)
      .then((row) => {
        if (cancelled) return
        if (row) setSchedule({ ...row, email: row.email || defaultEmail })
        else setSchedule({ ...defaultSchedule(defaultEmail), reportType: currentReportType })
      })
      .catch(() => {
        if (!cancelled) setSchedule({ ...defaultSchedule(defaultEmail), reportType: currentReportType })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, canPersist])

  function patch(next: Partial<ReportSchedule>) {
    setSchedule((s) => ({ ...s, ...next }))
  }

  async function handleSave() {
    if (!canPersist) {
      showToast('Sign in to save an email schedule', 'error')
      return
    }
    if (schedule.cadence !== 'off' && !schedule.email.trim()) {
      showToast('Add a recipient email first', 'error')
      return
    }
    setSaving(true)
    try {
      const enabled = schedule.cadence !== 'off'
      // Report type always follows the left-hand selector (no duplicate control here).
      await upsertReportSchedule(workspaceId, { ...schedule, reportType: currentReportType, enabled })
      setSchedule((s) => ({ ...s, reportType: currentReportType, enabled }))
      showToast(schedule.cadence === 'off' ? 'Automation turned off' : 'Email schedule saved')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save schedule', 'error')
    } finally {
      setSaving(false)
    }
  }

  const isOff = schedule.cadence === 'off'

  return (
    <div className="rounded-xl border border-[var(--border-card)] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Mail size={15} className="text-[var(--accent-emerald)]" />
        <h4 className="text-sm font-semibold text-white">Email automation</h4>
        {schedule.enabled && !isOff && (
          <span className="ml-auto rounded-full bg-[var(--accent-emerald)]/[0.12] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent-emerald-bright)]">
            On
          </span>
        )}
      </div>

      {/* Cadence segmented control */}
      <div className="grid grid-cols-3 gap-1.5">
        {CADENCES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => patch({ cadence: c.id })}
            className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
              schedule.cadence === c.id
                ? 'border-[var(--accent-emerald)]/60 bg-[var(--accent-emerald)]/[0.14] text-white'
                : 'border-[var(--border-card)] text-slate-300 hover:bg-white/[0.04]'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {!isOff && (
        <div className="mt-3 flex flex-col gap-3">
          {/* Report type is chosen on the left — not repeated here. */}
          <div className={`grid gap-2 ${schedule.cadence === 'weekly' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--text-secondary)]">Time</span>
              <div className="relative">
                <Clock size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="time"
                  value={schedule.time}
                  onChange={(e) => patch({ time: e.target.value })}
                  className="focus-ring w-full rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] py-2 pl-8 pr-2 text-xs text-white outline-none [color-scheme:dark]"
                />
              </div>
            </label>
            {schedule.cadence === 'weekly' && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--text-secondary)]">Day of week</span>
                <select
                  value={schedule.weekday}
                  onChange={(e) => patch({ weekday: Number(e.target.value) })}
                  className="focus-ring appearance-none rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-2 text-xs text-white outline-none"
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--text-secondary)]">Recipient email</span>
            <input
              type="email"
              value={schedule.email}
              onChange={(e) => patch({ email: e.target.value })}
              placeholder="you@example.com"
              className={`${inputClass} !py-2 text-xs`}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--text-secondary)]">Timezone</span>
            <input
              type="text"
              value={schedule.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
              placeholder="UTC"
              className={`${inputClass} !py-2 text-xs`}
            />
          </label>

          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            {schedule.cadence === 'weekly'
              ? `Sends every ${WEEKDAYS[schedule.weekday]} at ${schedule.time} (${schedule.timezone}).`
              : `Sends daily at ${schedule.time} (${schedule.timezone}).`}
          </p>

          {/* Optional extra delivery targets — dispatched server-side (edge function). */}
          <div className="mt-1 flex flex-col gap-3 border-t border-[var(--border-card)] pt-3">
            <div className="flex items-center gap-2">
              <Send size={14} className="text-[var(--accent-emerald)]" />
              <span className="text-xs font-semibold text-white">Extra delivery (optional)</span>
            </div>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--text-secondary)]">Slack webhook URL</span>
              <input
                type="url"
                value={schedule.slackWebhookUrl}
                onChange={(e) => patch({ slackWebhookUrl: e.target.value })}
                placeholder="https://hooks.slack.com/services/..."
                className={`${inputClass} !py-2 text-xs`}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--text-secondary)]">Notion token</span>
                <input
                  type="password"
                  value={schedule.notionToken}
                  onChange={(e) => patch({ notionToken: e.target.value })}
                  placeholder="secret_..."
                  className={`${inputClass} !py-2 text-xs`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--text-secondary)]">Notion page id</span>
                <input
                  type="text"
                  value={schedule.notionPageId}
                  onChange={(e) => patch({ notionPageId: e.target.value })}
                  placeholder="page id"
                  className={`${inputClass} !py-2 text-xs`}
                />
              </label>
            </div>

            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              Slack/Notion: incolla webhook/token — inviati via server (edge function). Salvati protetti da RLS.
            </p>
          </div>
        </div>
      )}

      <Button
        onClick={handleSave}
        loading={saving || loading}
        variant="secondary"
        size="sm"
        className="mt-3 w-full"
        disabled={!canPersist}
      >
        {isOff ? 'Save (automation off)' : 'Save schedule'}
      </Button>

      {!canPersist && (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">Sign in to save an email schedule for this workspace.</p>
      )}
    </div>
  )
}
