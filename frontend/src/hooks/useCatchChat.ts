import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { respond, type ChatAction } from '../lib/chatEngine'
import { deleteChatConversation, fetchAiQuota, fetchChatConversation, fetchChatConversations, sendChatMessage, type ChatConversation } from '../lib/api/misc'

// One chat thread per workspace, shared by the floating widget and the full
// Catch page: both read the same store, so "expand" simply navigates.
// Navigation / setup prompts are answered locally and instantly; everything
// else goes to the server assistant (data tools + docs) when available.

export interface ChatMsg {
  id: number
  role: 'user' | 'assistant'
  content: string
  actions?: ChatAction[]
  /** Progress text while the server assistant is working. */
  pending?: string
  source?: 'local' | 'ai'
}

interface Thread {
  messages: ChatMsg[]
  conversationId: string | null
  busy: boolean
  /** Latest stored conversation loaded from the server (once per workspace). */
  hydrated: boolean
  /** Stored conversations for this workspace, newest first. */
  history: ChatConversation[]
}

const EMPTY: Thread = { messages: [], conversationId: null, busy: false, hydrated: false, history: [] }
const threads = new Map<string, Thread>()
const listeners = new Set<() => void>()
let nextId = 1

function get(ws: string): Thread {
  return threads.get(ws) ?? EMPTY
}
function set(ws: string, patch: Partial<Thread>) {
  threads.set(ws, { ...get(ws), ...patch })
  for (const l of listeners) l()
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

let aiReadyCache: { ws: string; ready: boolean } | null = null

export function useCatchChat(workspaceId: string) {
  const thread = useSyncExternalStore(subscribe, () => get(workspaceId), () => EMPTY)
  const [aiReady, setAiReady] = useState(aiReadyCache?.ws === workspaceId ? aiReadyCache.ready : false)

  useEffect(() => {
    if (!workspaceId || workspaceId.startsWith('local-')) {
      setAiReady(false)
      return
    }
    if (aiReadyCache?.ws === workspaceId) {
      setAiReady(aiReadyCache.ready)
      return
    }
    let cancelled = false
    fetchAiQuota(workspaceId)
      .then((q) => {
        aiReadyCache = { ws: workspaceId, ready: q.configured }
        if (!cancelled) setAiReady(q.configured)
      })
      .catch(() => !cancelled && setAiReady(false))
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  // Resume the most recent stored conversation so the thread survives reloads
  // (the server keeps 30 days).
  useEffect(() => {
    if (!workspaceId || workspaceId.startsWith('local-') || get(workspaceId).hydrated) return
    set(workspaceId, { hydrated: true })
    let cancelled = false
    fetchChatConversations(workspaceId)
      .then(async (list) => {
        if (cancelled) return
        set(workspaceId, { history: list })
        const latest = list[0]
        if (!latest) return
        const c = await fetchChatConversation(workspaceId, latest.id)
        if (cancelled || get(workspaceId).messages.length > 0) return
        set(workspaceId, { conversationId: c.id, messages: c.messages.map((m) => ({ id: nextId++, role: m.role, content: m.content, source: 'ai' as const })) })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const ask = useCallback(
    (text: string) => {
      const q = text.trim()
      const t = get(workspaceId)
      if (!q || t.busy) return
      const local = respond(q)
      // Canned answers (navigation, setup, platform explainers, suggestion chips)
      // cost no tokens; only open questions go to the model.
      if (!aiReady || local.kind === 'nav' || local.kind === 'setup' || local.kind === 'kb') {
        set(workspaceId, { messages: [...t.messages, { id: nextId++, role: 'user', content: q }, { id: nextId++, role: 'assistant', content: local.content, actions: local.actions, source: 'local' }] })
        return
      }
      const pendingId = nextId++
      set(workspaceId, { busy: true, messages: [...t.messages, { id: nextId++, role: 'user', content: q }, { id: pendingId, role: 'assistant', content: '', pending: 'Thinking…', source: 'ai' }] })
      const patch = (p: Partial<ChatMsg>) => set(workspaceId, { messages: get(workspaceId).messages.map((x) => (x.id === pendingId ? { ...x, ...p } : x)) })
      sendChatMessage(workspaceId, { conversationId: t.conversationId, message: q }, (e) => {
        if (e.type === 'status') patch({ pending: e.text + '…' })
      })
        .then((done) => {
          set(workspaceId, { conversationId: done.conversationId })
          patch({ content: done.content, pending: undefined })
          // Keep the history list in sync (title = first message).
          const h = get(workspaceId).history
          const now = new Date().toISOString()
          set(workspaceId, { history: h.some((c) => c.id === done.conversationId) ? h.map((c) => (c.id === done.conversationId ? { ...c, updatedAt: now } : c)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [{ id: done.conversationId, title: q.slice(0, 80), updatedAt: now }, ...h] })
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'The assistant is unavailable.'
          patch({ content: `${msg}\n\n${local.content}`, actions: local.actions, pending: undefined, source: 'local' })
        })
        .finally(() => set(workspaceId, { busy: false }))
    },
    [workspaceId, aiReady],
  )

  /** Start a new conversation; the previous one stays in history. */
  const newChat = useCallback(() => set(workspaceId, { messages: [], conversationId: null }), [workspaceId])

  /** Open a stored conversation. */
  const openConversation = useCallback(
    async (id: string) => {
      if (get(workspaceId).busy) return
      const c = await fetchChatConversation(workspaceId, id)
      set(workspaceId, { conversationId: c.id, messages: c.messages.map((m) => ({ id: nextId++, role: m.role, content: m.content, source: 'ai' as const })) })
    },
    [workspaceId],
  )

  /** Delete a stored conversation (and leave it if it is the open one). */
  const removeConversation = useCallback(
    async (id: string) => {
      const t = get(workspaceId)
      set(workspaceId, { history: t.history.filter((c) => c.id !== id), ...(t.conversationId === id ? { messages: [], conversationId: null } : {}) })
      await deleteChatConversation(workspaceId, id).catch(() => undefined)
    },
    [workspaceId],
  )

  return { messages: thread.messages, busy: thread.busy, aiReady, conversationId: thread.conversationId, history: thread.history, ask, newChat, openConversation, removeConversation }
}
