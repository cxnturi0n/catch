import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { respond, type ChatAction } from '../lib/chatEngine'
import { fetchAiQuota, sendChatMessage } from '../lib/api/misc'

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
}

const EMPTY: Thread = { messages: [], conversationId: null, busy: false }
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

  const ask = useCallback(
    (text: string) => {
      const q = text.trim()
      const t = get(workspaceId)
      if (!q || t.busy) return
      const local = respond(q)
      if (!aiReady || local.kind === 'nav' || local.kind === 'setup') {
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
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'The assistant is unavailable.'
          patch({ content: `${msg}\n\n${local.content}`, actions: local.actions, pending: undefined, source: 'local' })
        })
        .finally(() => set(workspaceId, { busy: false }))
    },
    [workspaceId, aiReady],
  )

  const clear = useCallback(() => set(workspaceId, { messages: [], conversationId: null }), [workspaceId])

  return { messages: thread.messages, busy: thread.busy, aiReady, ask, clear }
}
