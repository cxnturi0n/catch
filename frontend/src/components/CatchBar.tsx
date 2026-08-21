import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Maximize2, X } from 'lucide-react'
import { CatchMark } from './brand/CatchMark'
import { CRUMB } from './layout/TopBar'
import { respond, type ChatAction } from '../lib/chatEngine'

interface Msg {
  id: number
  role: 'user' | 'assistant'
  content: string
  actions?: ChatAction[]
}

let nextId = 1

/** Renders the engine's light markup: **bold** and newlines. */
function renderContent(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-[var(--text-primary)]">{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

/** The section you're standing in, so the bar can address it by name. */
function sectionName(pathname: string): string | null {
  const key = Object.keys(CRUMB).find((k) => pathname === k || pathname.startsWith(k + '/'))
  return key ? CRUMB[key].sub : null
}

/**
 * Catch Intelligence as a layer, not a feature.
 *
 * A bar pinned to the bottom of every section: it starts where the sidebar ends
 * and runs to the edge of the page, so it belongs to the shell rather than to
 * any section's card layout. Because it reads `--sidebar-w` (and `--rail-w` for
 * future right rails like the calendar), it re-flows automatically with whatever
 * width the user gives those panels.
 *
 * Answers open in an opaque panel directly above the bar, which can be expanded
 * into the full Catch section.
 */
export function CatchBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const section = sectionName(pathname)
  // The full Catch section already is the assistant — no bar on top of itself.
  const onCatchSection = pathname.startsWith('/dashboard/catch')

  useEffect(() => {
    if (panelOpen) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [panelOpen, messages])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function ask(text: string) {
    const q = text.trim()
    if (!q) return
    const reply = respond(q)
    setMessages((m) => [
      ...m,
      { id: nextId++, role: 'user', content: q },
      { id: nextId++, role: 'assistant', content: reply.content, actions: reply.actions },
    ])
    setInput('')
    setPanelOpen(true)
  }

  function expand() {
    setPanelOpen(false)
    navigate('/dashboard/catch')
  }

  if (onCatchSection) return null

  return (
    // Span is CSS-driven (.catch-bar) so it can be responsive: full width on
    // mobile, offset by the sidebar from lg up.
    <div className="catch-bar pointer-events-none fixed bottom-0 z-40 print:hidden">
      <div className="pointer-events-auto px-4 pb-4 sm:px-6">
        {/* Answer panel — opaque, sits above the bar */}
        <AnimatePresence>
          {panelOpen && messages.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="mb-2 flex max-h-[52vh] flex-col overflow-hidden rounded-2xl border border-[color:rgba(230,184,77,0.28)] bg-[var(--bg-card)] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]"
            >
              <div className="flex items-center gap-2.5 border-b border-[var(--border-card)] px-4 py-2.5">
                <CatchMark size={22} variant="gold" play={false} />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[color:rgba(230,184,77,0.75)]">
                  Catch Intelligence
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={expand}
                    aria-label="Expand to full section"
                    title="Expand"
                    className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-[color:rgba(243,214,148,0.95)]"
                  >
                    <Maximize2 size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelOpen(false)}
                    aria-label="Close"
                    className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[80%]">
                      <div
                        className={`whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                          m.role === 'user'
                            ? 'bg-gradient-to-br from-[#3F7BFF] to-[#2050E6] text-white'
                            : 'border border-[var(--border-card)] bg-white/[0.03] text-[var(--text-secondary)]'
                        }`}
                      >
                        {renderContent(m.content)}
                      </div>
                      {m.actions && m.actions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {m.actions.map((a) => (
                            <button
                              key={a.to + a.label}
                              type="button"
                              onClick={() => {
                                navigate(a.to)
                                setPanelOpen(false)
                              }}
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
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The bar itself */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
          className="flex items-center gap-3 rounded-2xl border border-[color:rgba(230,184,77,0.28)] bg-[var(--bg-card)] px-3.5 py-2.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.8)]"
        >
          <button
            type="button"
            onClick={() => {
              if (messages.length > 0) setPanelOpen((v) => !v)
              inputRef.current?.focus()
            }}
            aria-label="Catch Intelligence"
            className="shrink-0"
          >
            <CatchMark size={24} variant="gold" play={false} />
          </button>

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
            rows={1}
            placeholder={section ? `Ask anything about ${section}…` : 'Ask anything about your communities…'}
            className="min-h-[24px] w-full flex-1 resize-none bg-transparent py-1 text-[13.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />

          <span className="hidden shrink-0 font-mono text-[10px] text-[var(--text-muted)] xl:inline">⌘⏎</span>
          <button
            type="submit"
            disabled={!input.trim()}
            className="shrink-0 rounded-xl bg-gradient-to-r from-[#3F7BFF] to-[#2050E6] px-4 py-1.5 text-[12.5px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
