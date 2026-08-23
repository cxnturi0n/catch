import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Maximize2, Plus, X } from 'lucide-react'
import { CatchMark } from './brand/CatchMark'
import { CRUMB } from './layout/TopBar'
import { useWorkspace } from '../context/WorkspaceContext'
import { useCatchChat } from '../hooks/useCatchChat'
import { renderContent } from './chat/ChatMarkdown'


/** The section you're standing in, so the bar can address it by name. */
function sectionName(pathname: string): string | null {
  const key = Object.keys(CRUMB).find((k) => pathname === k || pathname.startsWith(k + '/'))
  return key ? CRUMB[key].sub : null
}

/**
 * Catch Intelligence as a small widget in the bottom-right corner: a launcher
 * button that opens a fixed-size card with the thread and an input. The thread
 * is shared with the full Catch page (sidebar), which "expand" navigates to.
 */
export function CatchBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { activeWorkspaceId } = useWorkspace()
  const { messages, busy, ask, newChat } = useCatchChat(activeWorkspaceId)
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const section = sectionName(pathname)
  // The full Catch section already is the assistant, no widget on top of itself.
  const onCatchSection = pathname.startsWith('/dashboard/catch')

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      inputRef.current?.focus()
    }
  }, [open, messages])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function submit() {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    ask(q)
  }

  if (onCatchSection) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 print:hidden sm:bottom-5 sm:right-5">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto flex h-[min(540px,calc(100vh-7rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[color:rgba(230,184,77,0.28)] bg-[var(--bg-card)] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]"
            role="dialog"
            aria-label="Catch Intelligence"
          >
            <div className="flex items-center gap-2.5 border-b border-[var(--border-card)] px-3.5 py-2.5">
              <CatchMark size={20} variant="gold" play={false} />
              <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[color:rgba(230,184,77,0.75)]">Catch Intelligence</span>
              <div className="ml-auto flex items-center gap-1">
                {messages.length > 0 && (
                  <button type="button" onClick={newChat} title="New chat" className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-white">
                    <Plus size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    navigate('/dashboard/catch')
                  }}
                  title="Continue in the Catch page (history there)"
                  className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-[color:rgba(243,214,148,0.95)]"
                >
                  <Maximize2 size={14} />
                </button>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-white">
                  <X size={14} />
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
              {messages.length === 0 && (
                <div className="px-1 py-2 text-[12.5px] text-[var(--text-muted)]">
                  Ask about {section ? `${section} or ` : ''}your community data, growth, engagement, moderators, incidents, or how Catch works.
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[88%]">
                    <div
                      className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                        m.role === 'user' ? 'bg-gradient-to-br from-[#3F7BFF] to-[#2050E6] text-white' : 'border border-[var(--border-card)] bg-white/[0.03] text-[var(--text-secondary)]'
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
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {m.actions.map((a) => (
                          <button
                            key={a.to + a.label}
                            type="button"
                            onClick={() => {
                              navigate(a.to)
                              setOpen(false)
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

            <form
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
              className="flex items-end gap-2 border-t border-[var(--border-card)] px-3 py-2.5"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submit()
                  }
                }}
                rows={1}
                placeholder={section ? `Ask about ${section}…` : 'Ask anything…'}
                className="max-h-24 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!input.trim() || busy}
                className="rounded-xl bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                Send
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close Catch Intelligence' : 'Open Catch Intelligence'}
        className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-[color:rgba(230,184,77,0.35)] bg-[var(--bg-card)] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)] transition-transform hover:scale-105"
      >
        {open ? <X size={18} className="text-[color:rgba(243,214,148,0.95)]" /> : <CatchMark size={26} variant="gold" play={false} />}
        {!open && busy && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-[color:rgba(230,184,77,0.95)]" />}
      </button>
    </div>
  )
}
