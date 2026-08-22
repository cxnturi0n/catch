import { useEffect, useState, type ComponentType } from 'react'
import { BarChart3, Loader2, Trophy, Users, Wallet } from 'lucide-react'
import type { Moderator, Warning } from '../../types'
import { getModerators as getSeedModerators } from '../../data/moderatorsData'
import { addModerator, addModeratorWarning, fetchModerators, removeModerator, seedModerators, updateModerator } from '../../lib/db'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { SplitPane } from '../ui/SplitPane'
import { RosterTab } from './moderators/RosterTab'
import { ScheduleTab } from './moderators/ScheduleTab'
import { PerformanceTab } from './moderators/PerformanceTab'
import { CompensationTab } from './moderators/CompensationTab'
import { AddModeratorModal } from './moderators/AddModeratorModal'
import { AddWarningModal } from './moderators/AddWarningModal'
import { Payments } from './Payments'
import { Leaderboard } from './Leaderboard'
import { formatRelativeTime } from '../../lib/format'
import { QuotaBanner } from '../QuotaBanner'
import { UpgradeModal } from '../UpgradeModal'
import { useCurrentPlan } from '../../hooks/useCurrentPlan'
import { computeQuota } from '../../lib/plan'

// Reports tab removed for now (redundant) — to be repurposed elsewhere later.
type Tab = 'directory' | 'analytics' | 'payments' | 'leaderboard'

const TABS: { id: Tab; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'directory', label: 'Directory', icon: Users },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
]

function applyWarningPenalty(rating: number, severity: Warning['severity']): number {
  const delta = severity === 'High' ? 1 : severity === 'Medium' ? 0.25 : 0
  return Math.max(0, Math.round((rating - delta) * 100) / 100)
}

// The moderators table has no performance-stat columns, so those numbers
// only ever live in this session's state — carry them across a persisted
// write instead of letting the DB round-trip reset them to defaults.
function performanceStatsOf(m: Moderator) {
  return {
    messagesThisMonth: m.messagesThisMonth,
    bansExecuted: m.bansExecuted,
    timeoutsGiven: m.timeoutsGiven,
    avgResponseTime: m.avgResponseTime,
    lastActiveDate: m.lastActiveDate,
    shiftsCompleted: m.shiftsCompleted,
    shiftsAssigned: m.shiftsAssigned,
    rating: m.rating,
  }
}

export function Moderators() {
  const { activeWorkspaceId, getWorkspaceIntegrations } = useWorkspace()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [moderators, setModerators] = useState<Moderator[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('directory')
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Moderator | null>(null)
  const [warningTarget, setWarningTarget] = useState<Moderator | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Moderator | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const { tier } = useCurrentPlan()
  const modQuota = computeQuota('moderators', moderators.length, tier)

  // Workspace switched — reload this workspace's own moderator roster,
  // seeding it from mock data the first time a workspace is opened.
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setTab('directory')

      if (!user) {
        // Guest mode — never touch the API.
        if (!cancelled) setModerators(getSeedModerators(activeWorkspaceId))
        if (!cancelled) setLoading(false)
        return
      }

      try {
        const rows = await fetchModerators(activeWorkspaceId)
        if (cancelled) return
        if (rows.length > 0) {
          setModerators(rows)
          return
        }
        const seedRows = getSeedModerators(activeWorkspaceId)
        if (seedRows.length === 0) {
          setModerators([])
          return
        }
        const seeded = await seedModerators(activeWorkspaceId, seedRows)
        if (cancelled) return
        const seedByName = new Map(seedRows.map((m) => [m.fullName, m]))
        setModerators(seeded.map((m) => ({ ...m, ...(seedByName.get(m.fullName) ? performanceStatsOf(seedByName.get(m.fullName)!) : {}) })))
      } catch {
        if (!cancelled) setModerators([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, user])

  const integrations = getWorkspaceIntegrations(activeWorkspaceId)
  const isAutoSynced = integrations.discord.status === 'Connected' || integrations.telegram.status === 'Connected'
  const lastSyncTimestamps = [integrations.discord.lastSync, integrations.telegram.lastSync].filter((v): v is string => v !== null)
  const lastSyncLabel = lastSyncTimestamps.length > 0 ? formatRelativeTime(lastSyncTimestamps.sort().reverse()[0]) : null

  function openAdd() {
    // Block creation past the plan cap — surface the upgrade modal instead
    // of the add form so the user sees exactly why they can't proceed.
    if (modQuota.status === 'reached') {
      setUpgradeOpen(true)
      return
    }
    setEditing(null)
    setAddOpen(true)
  }

  function openEdit(m: Moderator) {
    setEditing(m)
    setAddOpen(true)
  }

  function closeAddModal() {
    setAddOpen(false)
    setEditing(null)
  }

  async function handleSubmitModerator(m: Moderator) {
    const wasEditing = editing !== null

    if (!user) {
      // Guest mode — keep the moderator in memory only, no API write.
      const local: Moderator = wasEditing ? m : { ...m, id: `local-${Date.now()}` }
      setModerators((prev) => (prev.some((x) => x.id === local.id) ? prev.map((x) => (x.id === local.id ? local : x)) : [local, ...prev]))
      closeAddModal()
      showToast(wasEditing ? 'Moderator updated' : 'Moderator added')
      return
    }

    try {
      const { id: _id, avatarInitials: _avatarInitials, ...data } = m
      const persisted = wasEditing ? await updateModerator(m.id, activeWorkspaceId, data) : await addModerator(activeWorkspaceId, data)
      const final: Moderator = { ...persisted, ...performanceStatsOf(m) }
      setModerators((prev) => (prev.some((x) => x.id === final.id) ? prev.map((x) => (x.id === final.id ? final : x)) : [final, ...prev]))
      closeAddModal()
      showToast(wasEditing ? 'Moderator updated' : 'Moderator added')
    } catch {
      showToast(wasEditing ? 'Failed to update moderator' : 'Failed to add moderator')
    }
  }

  async function handleAddWarningSubmit(warning: Warning) {
    if (!warningTarget) return
    const target = warningTarget
    const newWarnings = [...target.warnings, warning]

    if (!user) {
      // Guest mode — update in-memory state only, no API write.
      setModerators((prev) =>
        prev.map((m) => (m.id === target.id ? { ...m, warnings: newWarnings, rating: applyWarningPenalty(m.rating, warning.severity) } : m)),
      )
      setWarningTarget(null)
      showToast('Warning issued')
      return
    }

    try {
      await addModeratorWarning(activeWorkspaceId, target.id, newWarnings)
      setModerators((prev) =>
        prev.map((m) => (m.id === target.id ? { ...m, warnings: newWarnings, rating: applyWarningPenalty(m.rating, warning.severity) } : m)),
      )
      setWarningTarget(null)
      showToast('Warning issued')
    } catch {
      showToast('Failed to issue warning')
    }
  }

  async function handleRemoveConfirm() {
    if (!removeTarget) return
    const targetId = removeTarget.id

    if (!user) {
      // Guest mode — remove from in-memory state only, no API write.
      setModerators((prev) => prev.filter((m) => m.id !== targetId))
      setRemoveTarget(null)
      showToast('Moderator removed')
      return
    }

    try {
      await removeModerator(activeWorkspaceId, targetId)
      setModerators((prev) => prev.filter((m) => m.id !== targetId))
      setRemoveTarget(null)
      showToast('Moderator removed')
    } catch {
      showToast('Failed to remove moderator')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === id ? 'gradient-bar text-white' : 'text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

      </div>

      {tab === 'directory' && <QuotaBanner resource="moderators" used={moderators.length} />}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border-card)] py-16 text-sm text-[var(--text-secondary)]">
          <Loader2 size={20} className="animate-spin" />
          Loading moderators…
        </div>
      ) : (
        <>
          {tab === 'directory' && (
            <SplitPane
              storageKey="catch:moderators:directorySplit"
              initialLeftPct={27}
              minLeftPct={18}
              maxLeftPct={55}
              className="items-start"
              leftClassName="min-w-0"
              rightClassName="min-w-0"
              left={
                <div className="flex flex-col gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Weekly schedule</h3>
                    <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">Shift coverage — drag the divider to resize.</p>
                  </div>
                  <ScheduleTab moderators={moderators} />
                </div>
              }
              right={
                <RosterTab
                  moderators={moderators}
                  isAutoSynced={isAutoSynced}
                  lastSyncLabel={lastSyncLabel}
                  onEdit={openEdit}
                  onAddWarning={setWarningTarget}
                  onRemove={setRemoveTarget}
                  onInvite={openAdd}
                  onViewActivity={() => setTab('analytics')}
                />
              }
            />
          )}
          {tab === 'analytics' && (
            <div className="flex flex-col gap-6">
              <PerformanceTab moderators={moderators} isAutoSynced={isAutoSynced} />
            </div>
          )}
          {tab === 'payments' && (
            <div className="flex flex-col gap-6">
              <CompensationTab moderators={moderators} />
              <Payments />
            </div>
          )}
          {tab === 'leaderboard' && <Leaderboard />}
        </>
      )}

      <AddModeratorModal open={addOpen} onClose={closeAddModal} onSubmit={handleSubmitModerator} editing={editing} />

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        resource="moderators"
        used={moderators.length}
      />

      <AddWarningModal
        open={warningTarget !== null}
        onClose={() => setWarningTarget(null)}
        moderatorName={warningTarget?.fullName ?? ''}
        onSubmit={handleAddWarningSubmit}
      />

      <Modal open={removeTarget !== null} onClose={() => setRemoveTarget(null)} title="Remove moderator">
        <p className="text-sm text-[var(--text-secondary)]">
          Are you sure you want to remove {removeTarget?.fullName}? This can&apos;t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleRemoveConfirm}>
            Remove
          </Button>
        </div>
      </Modal>
    </div>
  )
}
