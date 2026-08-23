import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowUp,
  BarChart3,
  FileText,
  History,
  Plus,
  Trash2,
  Plug,
  RotateCcw,
  Sparkles,
  Users,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { CatchMark } from '../brand/CatchMark'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'
import { useCatchChat } from '../../hooks/useCatchChat'
import { renderContent } from '../chat/ChatMarkdown'
import {
  hasSeenLayoutPromptLocally,
  hasSeenLayoutPromptRemotely,
  rememberLayoutPromptSeen,
} from '../../lib/layoutPrompt'


// ── What you can ask, grouped like a short manual ────────────────────────────

interface Capability {
  title: string
  body: string
  prompts: string[]
}
interface Category {
  id: string
  label: string
  icon: LucideIcon
  cards: Capability[]
}

const SETUP_EXAMPLE =
  'This project is for Acme Protocol. I run the community on Discord and Telegram, plus X. I work with 1 other community manager and 5 moderators.'

const CATEGORIES: Category[] = [
  {
    id: 'setup',
    label: 'Set up',
    icon: Wand2,
    cards: [
      {
        title: 'Build your layout',
        body: 'Describe the project in your own words, who it’s for, which platforms you run, how big the team is. I shape the workspace around it.',
        prompts: [SETUP_EXAMPLE],
      },
      {
        title: 'Connect a platform',
        body: 'Bot tokens, server IDs, API keys, I tell you exactly what each integration needs.',
        prompts: ['How do I connect Discord?', 'How do I connect Telegram?'],
      },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    cards: [
      {
        title: 'What each platform tracks',
        body: 'Straight answers on what is really measured, and what isn’t, so you never report a number that doesn’t exist.',
        prompts: ['What does Discord track?', 'What does Telegram track?', 'What about Galxe and Zealy?'],
      },
      {
        title: 'Go to a dashboard',
        body: 'Jump straight to the overview or a single platform.',
        prompts: ['Open the overview', 'Show me Discord'],
      },
    ],
  },
  {
    id: 'team',
    label: 'Team & pay',
    icon: Users,
    cards: [
      {
        title: 'Moderators & shifts',
        body: 'Roster, coverage across time zones, punctuality and activity per moderator.',
        prompts: ['Open moderators', 'How do shifts and coverage work?'],
      },
      {
        title: 'Points & payouts',
        body: 'Turn activity into pay: points per metric, a points-to-currency rate, and a salary log.',
        prompts: ['How does compensation work?', 'Take me to payments'],
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileText,
    cards: [
      {
        title: 'Client reporting',
        body: 'Branded one-pagers on any date range, with scheduled email delivery.',
        prompts: ['How do reports work?', 'Open reports'],
      },
      {
        title: 'Resources & SOPs',
        body: 'The knowledge drive where playbooks, SOPs and brand assets live.',
        prompts: ['What goes in Resources?'],
      },
    ],
  },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export function CatchAI() {
  const navigate = useNavigate()
  const { activeWorkspaceId, workspaces } = useWorkspace()
  const { user } = useAuth()
  const { messages, busy, aiReady, conversationId, history, ask: send, newChat, openConversation, removeConversation } = useCatchChat(activeWorkspaceId)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [input, setInput] = useState('')
  const [category, setCategory] = useState('setup')
  const [introOpen, setIntroOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const workspaceName = workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? 'this workspace'

  // One-shot first run: the invitation to describe the project is shown the very
  // first time only. If it has ever been seen, on this device or on any other, // it never comes back, on any workspace.
  useEffect(() => {
    if (hasSeenLayoutPromptLocally()) return
    let cancelled = false
    async function decide() {
      const seenRemotely = user ? await hasSeenLayoutPromptRemotely(user.id) : false
      if (cancelled) return
      if (seenRemotely) {
        // Another device already showed it, record it here so we stop asking.
        rememberLayoutPromptSeen(null)
        return
      }
      setIntroOpen(true)
    }
    void decide()
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (messages.length > 0) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  function dismissIntro(startNow: boolean) {
    setIntroOpen(false)
    // Either way it counts as seen, dismissing is still having received it.
    rememberLayoutPromptSeen(user?.id ?? null)
    if (startNow) {
      setInput(SETUP_EXAMPLE)
      window.setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 60)
    }
  }

  function ask(text: string) {
    const q = text.trim()
    if (!q || busy) return
    send(q)
    setInput('')
  }

  const active = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0]
  const started = messages.length > 0

  return (
    <div className="relative mx-auto flex w-full max-w-[820px] flex-col items-center">
      {/* History: stored conversations for this workspace (server-side, 30 days). */}
      {aiReady && (
        <div className="absolute right-0 top-0 z-10 flex items-center gap-1">
          <button
            type="button"
            onClick={newChat}
            className="focus-ring flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            <Plus size={13} /> New chat
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            className={`focus-ring flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${historyOpen ? 'border-[color:rgba(230,184,77,0.45)] bg-[color:rgba(230,184,77,0.10)] text-[color:rgba(243,214,148,0.98)]' : 'border-[var(--border-card)] text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-white'}`}
          >
            <History size={13} /> History{history.length ? ` (${history.length})` : ''}
          </button>
          {historyOpen && (
            <div className="absolute right-0 top-10 w-80 overflow-hidden rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]">
              {history.length === 0 ? (
                <div className="px-3 py-3 text-[12.5px] text-[var(--text-muted)]">No conversations yet.</div>
              ) : (
                <ul className="max-h-80 divide-y divide-[var(--border-card)] overflow-y-auto">
                  {history.map((c) => (
                    <li key={c.id} className={`flex items-center gap-2 px-3 py-2 ${c.id === conversationId ? 'bg-white/[0.04]' : ''}`}>
                      <button
                        type="button"
                        onClick={() => {
                          void openConversation(c.id)
                          setHistoryOpen(false)
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-[13px] text-[var(--text-primary)]">{c.title || 'Untitled'}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">{new Date(c.updatedAt).toLocaleString()}</div>
                      </button>
                      <button type="button" onClick={() => void removeConversation(c.id)} aria-label="Delete conversation" className="rounded-md p-1 text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-red-300">
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {/* Hero, gold mark, question, motto */}
      <div className={`flex flex-col items-center text-center ${started ? 'pt-2' : 'pt-10'}`}>
        <CatchMark size={started ? 40 : 60} variant="gold" play={!started} />
        {!started && (
          <>
            <h1 className="mt-5 text-2xl font-bold text-[var(--text-primary)] sm:text-[28px]">
              What do you want to do today?
            </h1>
            <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.18em] text-[color:rgba(230,184,77,0.85)]">
              you throw, I catch
            </p>
          </>
        )}
      </div>

      {/* Conversation */}
      {started && (
        <div className="mt-6 flex w-full flex-col gap-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[88%]">
                <div
                  className={`whitespace-pre-line rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-gradient-to-br from-[#3F7BFF] to-[#2050E6] text-white'
                      : 'border border-[var(--border-card)] bg-white/[0.03] text-[var(--text-secondary)]'
                  }`}
                >
                  {m.pending ? (
                    <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:rgba(230,184,77,0.9)]" /> {m.pending}
                    </span>
                  ) : (
                    renderContent(m.content)
                  )}
                </div>
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.actions.map((a) => (
                      <button
                        key={a.to + a.label}
                        type="button"
                        onClick={() => navigate(a.to)}
                        className="rounded-lg border border-[color:rgba(230,184,77,0.35)] bg-[color:rgba(230,184,77,0.10)] px-2.5 py-1 text-[12px] font-medium text-[color:rgba(240,205,130,0.95)] transition-colors hover:bg-[color:rgba(230,184,77,0.18)]"
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
        className="mt-6 w-full"
      >
        <div className="glass sf-card rounded-2xl p-3 transition-colors focus-within:border-[color:rgba(230,184,77,0.45)]">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ask(input)
              }
            }}
            rows={2}
            placeholder="Ask, plan, or describe your project…"
            className="w-full resize-none bg-transparent px-1.5 py-1 text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="pl-1.5 font-mono text-[10.5px] text-[var(--text-muted)]">
              {workspaceName} · {aiReady ? 'answers from your workspace data' : 'local assistant'}
            </span>
            <div className="flex items-center gap-1.5">
              {started && (
                <button
                  type="button"
                  onClick={newChat}
                  aria-label="New chat"
                  className="focus-ring rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <RotateCcw size={15} />
                </button>
              )}
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#F2CE7A] to-[#D9A63C] text-[#3a2a05] transition hover:brightness-110 disabled:opacity-40"
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Category chips */}
      <div className="mt-5 flex w-full flex-wrap items-center justify-center gap-2">
        {CATEGORIES.map((c) => {
          const Icon = c.icon
          const on = c.id === category
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              aria-pressed={on}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                on
                  ? 'border-[color:rgba(230,184,77,0.45)] bg-[color:rgba(230,184,77,0.12)] text-[color:rgba(240,205,130,0.95)]'
                  : 'border-[var(--border-card)] text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <Icon size={13} /> {c.label}
            </button>
          )
        })}
      </div>

      {/* What you can ask */}
      <div className="mt-4 grid w-full grid-cols-1 gap-3 md:grid-cols-2">
        {active.cards.map((card) => (
          <div key={card.title} className="glass sf-card flex flex-col gap-2.5 p-4">
            <div>
              <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)]">{card.title}</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{card.body}</p>
            </div>
            <div className="mt-auto flex flex-col gap-1.5">
              {card.prompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => ask(p)}
                  className="flex items-start gap-2 rounded-lg border border-[var(--border-card)] bg-white/[0.02] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[color:rgba(230,184,77,0.4)] hover:text-white"
                >
                  <Sparkles size={12} className="mt-0.5 shrink-0 text-[color:rgba(230,184,77,0.8)]" />
                  <span className="line-clamp-2">{p}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* First-run: build your layout */}
      <Modal open={introOpen} onClose={() => dismissIntro(false)} title="Build your layout with Catch">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <CatchMark size={38} variant="gold" play={false} />
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(230,184,77,0.85)]">
              you throw, I catch
            </p>
          </div>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Tell me about this project in one message, who it’s for, which platforms you run the community on, and how big
            your team is. I’ll shape <span className="text-[var(--text-primary)]">{workspaceName}</span> around it and hand
            you the exact setup steps.
          </p>
          <div className="rounded-xl border border-[var(--border-card)] bg-white/[0.03] p-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">For example</div>
            <p className="text-[12.5px] italic leading-relaxed text-[var(--text-secondary)]">“{SETUP_EXAMPLE}”</p>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => dismissIntro(false)}>
              I’ll explore first
            </Button>
            <Button onClick={() => dismissIntro(true)}>
              <Plug size={15} /> Start building
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
