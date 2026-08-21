import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AtSign, BookOpen, Cast, Gem, Loader2, MessageSquare, MonitorPlay, RefreshCw, Send, Trophy, Tv, Upload, Vote } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { IntegrationConnection, IntegrationKey } from '../../types'
import {
  discordConnect,
  discordSync,
  galxeConnect,
  galxeSync,
  telegramConnect,
  telegramSync,
  zealyConnect,
  zealySync,
  type ConnectResult,
  type SyncResult,
} from '../../lib/functions'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'
import { useRealtimeTables } from '../../hooks/useRealtimeTables'
import { useToast } from '../../context/ToastContext'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Modal } from '../ui/Modal'
import { FormField, inputClass } from '../ui/FormControls'
import { formatRelativeTime } from '../../lib/format'

interface FieldSpec {
  key: string
  label: string
  placeholder: string
}

interface IntegrationMeta {
  name: string
  icon: LucideIcon
  fields: FieldSpec[]
  live: boolean
  note?: string
}

const INTEGRATION_META: Record<IntegrationKey, IntegrationMeta> = {
  discord: {
    name: 'Discord',
    icon: MessageSquare,
    live: true,
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: 'Paste your bot token' },
      { key: 'serverId', label: 'Server ID', placeholder: 'e.g. 910284739201847' },
    ],
  },
  telegram: {
    name: 'Telegram',
    icon: Send,
    live: true,
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: 'Paste your bot token' },
      { key: 'chatId', label: 'Chat ID / Group ID', placeholder: 'e.g. -1001923847562' },
    ],
  },
  twitter: {
    name: 'Twitter / X',
    icon: AtSign,
    live: false,
    fields: [],
    note: 'X API costs $100/month minimum — available on Enterprise plan.',
  },
  zealy: {
    name: 'Zealy',
    icon: Trophy,
    live: true,
    fields: [
      { key: 'subdomain', label: 'Community Subdomain', placeholder: 'e.g. arbitrum' },
      { key: 'apiKey', label: 'API Key', placeholder: 'Paste your API key' },
    ],
  },
  galxe: {
    name: 'Galxe',
    icon: Gem,
    live: true,
    fields: [{ key: 'alias', label: 'Space Alias', placeholder: 'e.g. optimism' }],
  },
  snapshot: {
    name: 'Snapshot',
    icon: Vote,
    live: false,
    fields: [{ key: 'spaceEns', label: 'Space ENS', placeholder: 'e.g. arbitrum.eth' }],
    note: 'Live connection coming soon.',
  },
  twitch: {
    name: 'Twitch',
    icon: Tv,
    live: false,
    fields: [],
    note: 'Live streams, chat activity, followers and subs — coming soon.',
  },
  youtube: {
    name: 'YouTube Live',
    icon: MonitorPlay,
    live: false,
    fields: [],
    note: 'Live chat, super chats and stream analytics — coming soon.',
  },
  kick: {
    name: 'Kick',
    icon: Cast,
    live: false,
    fields: [],
    note: 'Channel followers, live sessions and chat — coming soon.',
  },
}

const INTEGRATION_ORDER: IntegrationKey[] = [
  'discord',
  'telegram',
  'twitter',
  'zealy',
  'galxe',
  'snapshot',
  'twitch',
  'youtube',
  'kick',
]
const SYNCABLE_PLATFORMS: IntegrationKey[] = ['discord', 'telegram', 'zealy', 'galxe']

// Dispatch to the right connect/sync edge-function for a given platform.
function runConnect(key: IntegrationKey, workspaceId: string, form: Record<string, string>): Promise<ConnectResult> {
  switch (key) {
    case 'discord':
      return discordConnect(workspaceId, form.botToken, form.serverId)
    case 'telegram':
      return telegramConnect(workspaceId, form.botToken, form.chatId)
    case 'zealy':
      return zealyConnect(workspaceId, form.subdomain, form.apiKey)
    case 'galxe':
      return galxeConnect(workspaceId, form.alias)
    default:
      throw new Error('This integration is not yet available.')
  }
}

function runSync(key: IntegrationKey, workspaceId: string): Promise<SyncResult> {
  switch (key) {
    case 'discord':
      return discordSync(workspaceId)
    case 'telegram':
      return telegramSync(workspaceId)
    case 'zealy':
      return zealySync(workspaceId)
    case 'galxe':
      return galxeSync(workspaceId)
    default:
      throw new Error('This integration is not yet available.')
  }
}
// Live metrics refresh hourly server-side (cron-sync); poll a little more often
// than that so a manual sync elsewhere / the cron shows up without a reload.
const AUTO_REFRESH_MS = 5 * 60 * 1000
const INTEGRATION_TABLES = ['integrations'] as const

const STATUS_TONE: Record<IntegrationConnection['status'], BadgeTone> = {
  Connected: 'emerald',
  'Not Connected': 'gray',
  'Coming Soon': 'yellow',
}

function formatMockValue(value: string | number): string {
  if (typeof value === 'number') return new Intl.NumberFormat('en-US').format(value)
  // ISO-looking timestamps get rendered as relative time; everything else as-is.
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatRelativeTime(value)
  return value
}

export function Integrations() {
  const { activeWorkspaceId, getWorkspaceIntegrations, integrationsLoading, refreshIntegrations, disconnectIntegration } = useWorkspace()
  const { user } = useAuth()
  const { showToast } = useToast()
  const integrations = getWorkspaceIntegrations(activeWorkspaceId)

  const [connectKey, setConnectKey] = useState<IntegrationKey | null>(null)
  const [disconnectKey, setDisconnectKey] = useState<IntegrationKey | null>(null)
  const [syncingKey, setSyncingKey] = useState<IntegrationKey | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const connectedPlatforms = useMemo(
    () => SYNCABLE_PLATFORMS.filter((key) => integrations[key].status === 'Connected'),
    [integrations.discord.status, integrations.telegram.status, integrations.zealy.status, integrations.galxe.status],
  )
  const hasConnected = connectedPlatforms.length > 0

  // Light auto-refresh: while a live platform is connected, re-pull the cached
  // integration metrics every few minutes so a background cron-sync (or a sync
  // from another tab) surfaces without a manual reload. Guest sessions never
  // connect a live platform, so this stays idle for them. Cleared on unmount
  // and whenever the workspace / connected set changes.
  useEffect(() => {
    if (!user || !activeWorkspaceId || !hasConnected) return
    const id = window.setInterval(() => {
      void refreshIntegrations(activeWorkspaceId)
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [user, activeWorkspaceId, hasConnected, refreshIntegrations])

  // Fast path on top of that interval: connect/disconnect/sync from another tab
  // (or a cron writing lastSync) flips the card status here without the wait.
  useRealtimeTables(activeWorkspaceId, INTEGRATION_TABLES, () => {
    void refreshIntegrations(activeWorkspaceId)
  })

  function openConnect(key: IntegrationKey) {
    setConnectKey(key)
    setForm({})
    setErrors({})
  }

  function closeConnect() {
    setConnectKey(null)
    setForm({})
    setErrors({})
    setSubmitting(false)
  }

  async function handleConnectSubmit(e: FormEvent) {
    e.preventDefault()
    if (!connectKey) return
    const meta = INTEGRATION_META[connectKey]
    const nextErrors: Record<string, string> = {}
    for (const field of meta.fields) {
      if (!form[field.key]?.trim()) nextErrors[field.key] = `${field.label} is required.`
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      const result = await runConnect(connectKey, activeWorkspaceId, form)
      if (!result.success) {
        setErrors({ form: result.error ?? 'Verification failed.' })
        return
      }
      await refreshIntegrations(activeWorkspaceId)
      showToast(`${meta.name} connected successfully`)
      closeConnect()
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Failed to connect.' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDisconnectConfirm() {
    if (!disconnectKey) return
    const meta = INTEGRATION_META[disconnectKey]
    setDisconnecting(true)
    try {
      await disconnectIntegration(activeWorkspaceId, disconnectKey)
      showToast(`${meta.name} disconnected`)
      setDisconnectKey(null)
    } catch {
      showToast(`Failed to disconnect ${meta.name}`)
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleSync(key: IntegrationKey) {
    setSyncingKey(key)
    try {
      const result = await runSync(key, activeWorkspaceId)
      if (!result.success) throw new Error(result.error ?? 'Sync failed.')
      await refreshIntegrations(activeWorkspaceId)
      showToast(`${INTEGRATION_META[key].name} synced`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sync failed.')
    } finally {
      setSyncingKey(null)
    }
  }

  async function handleSyncAll() {
    if (connectedPlatforms.length === 0) return
    setSyncingAll(true)
    try {
      const results = await Promise.all(
        connectedPlatforms.map(async (key) => {
          try {
            const r = await runSync(key, activeWorkspaceId)
            return r.success
          } catch {
            return false
          }
        }),
      )
      await refreshIntegrations(activeWorkspaceId)
      const ok = results.filter(Boolean).length
      if (ok === results.length) showToast(`Synced ${ok} platform${ok === 1 ? '' : 's'}`)
      else showToast(`Synced ${ok} of ${results.length} platforms`, 'error')
    } finally {
      setSyncingAll(false)
    }
  }

  const connectMeta = connectKey ? INTEGRATION_META[connectKey] : null

  return (
    <div className="flex flex-col gap-6">
      {hasConnected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-card)] bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <RefreshCw size={14} className={syncingAll ? 'animate-spin text-[var(--accent-emerald)]' : 'text-[var(--accent-emerald)]'} />
            <span>
              {connectedPlatforms.length} live platform{connectedPlatforms.length === 1 ? '' : 's'} connected · auto-syncs hourly
            </span>
          </div>
          <Button variant="secondary" onClick={handleSyncAll} disabled={syncingAll} className="!px-3 !py-1.5 text-xs">
            {syncingAll && <Loader2 size={12} className="animate-spin" />}
            Sync all
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {INTEGRATION_ORDER.map((key) => {
          const meta = INTEGRATION_META[key]
          const Icon = meta.icon
          const connection = integrations[key]
          const isConnected = connection.status === 'Connected'
          const isComingSoon = connection.status === 'Coming Soon' || !meta.live
          const isSyncing = syncingKey === key

          return (
            <Card
              key={key}
              className={`p-5 transition-all ${isConnected ? 'border-blue-500/40 shadow-[var(--glow-emerald)]' : ''} ${
                meta.live && !isConnected ? 'border-[var(--accent-emerald)]/45 shadow-[var(--glow-emerald)] hover:shadow-[var(--glow-emerald-strong)]' : ''
              } ${isComingSoon && !isConnected ? 'opacity-60' : ''}`}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05] text-white">
                    <Icon size={18} />
                  </div>
                  <h3 className="text-sm font-semibold text-white">{meta.name}</h3>
                </div>
                <Badge tone={STATUS_TONE[connection.status]}>{isConnected ? 'Connected' : connection.status}</Badge>
              </div>

              {!isConnected && isComingSoon && meta.note && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[var(--text-secondary)]">{meta.note}</p>
                  {key === 'twitter' && (
                    <Link
                      to="/dashboard/analytics"
                      className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-[var(--accent-emerald)] hover:underline"
                    >
                      <Upload size={12} /> In the meanwhile, import the data manually here →
                    </Link>
                  )}
                </div>
              )}

              {isConnected && (
                <div className="mb-4 flex flex-col gap-2">
                  {Object.entries(connection.mockData).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">{label}</span>
                      <span className="font-medium text-white">{formatMockValue(value)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} />
                    Last synced {connection.lastSync ? formatRelativeTime(connection.lastSync) : 'never'} · auto-syncs hourly
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {isConnected ? (
                  <>
                    <Button variant="secondary" onClick={() => handleSync(key)} disabled={isSyncing} className="!px-3 !py-1.5 text-xs">
                      {isSyncing && <Loader2 size={12} className="animate-spin" />}
                      Sync Now
                    </Button>
                    <Button variant="danger" onClick={() => setDisconnectKey(key)} className="!px-3 !py-1.5 text-xs">
                      Disconnect
                    </Button>
                  </>
                ) : (
                  meta.live && (
                    <Button onClick={() => openConnect(key)} disabled={integrationsLoading} className="!px-3 !py-1.5 text-xs">
                      Connect
                    </Button>
                  )
                )}
              </div>
            </Card>
          )
        })}
      </div>

      <Modal open={connectKey !== null} onClose={closeConnect} title={connectMeta ? `Connect ${connectMeta.name}` : 'Connect'}>
        {connectMeta && (
          <form onSubmit={handleConnectSubmit} className="flex flex-col gap-4">
            {errors.form && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">{errors.form}</div>
            )}
            {submitting && <p className="text-xs text-[var(--text-secondary)]">Verifying credentials…</p>}
            {connectMeta.fields.map((field) => (
              <FormField key={field.key} label={field.label}>
                <input
                  className={`${inputClass} ${errors[field.key] ? 'border-red-500' : ''}`}
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  // Hard-mask these credential fields (bot tokens / API keys) in
                  // Clarity recordings, independent of the dashboard masking mode.
                  // Passive attribute — read only by Clarity, no effect on value,
                  // onChange, submission or storage.
                  data-clarity-mask="true"
                />
                {errors[field.key] && <span className="text-xs text-red-400">{errors[field.key]}</span>}
              </FormField>
            ))}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <Link
                to="/dashboard/instructions?section=integrations"
                onClick={closeConnect}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-emerald)] hover:underline"
              >
                <BookOpen size={13} /> See instructions
              </Link>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" onClick={closeConnect}>
                  Cancel
                </Button>
                <Button type="submit" loading={submitting}>
                  Connect
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={disconnectKey !== null} onClose={() => setDisconnectKey(null)} title="Disconnect integration">
        <p className="text-sm text-[var(--text-secondary)]">
          Are you sure you want to disconnect {disconnectKey ? INTEGRATION_META[disconnectKey].name : ''}? Auto-synced fields will stop
          updating until you reconnect.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDisconnectKey(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDisconnectConfirm} loading={disconnecting}>
            Disconnect
          </Button>
        </div>
      </Modal>
    </div>
  )
}
