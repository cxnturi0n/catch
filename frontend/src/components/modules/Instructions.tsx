import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronRight, Download, Sparkles } from 'lucide-react'
import { INSTRUCTION_SECTIONS, PLATFORM_SETUP, type InstructionSection, type PlatformSetup } from '../../data/instructionsData'
import { Modal } from '../ui/Modal'

// Matches bare or fully-qualified web addresses (discord.com/developers,
// analytics.twitter.com, zealy.io/cw/...) while ignoring things like
// "arbitrum.eth", "@BotFather" or "123456:ABC" that are not clickable URLs.
const URL_RE = /((?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|io|org|net|app|dev|gg|xyz)(?:\/[^\s)<]*)?)/gi

/** Turn every URL inside a plain instruction string into a real sapphire link. */
function linkify(text: string): ReactNode {
  const parts: ReactNode[] = []
  let lastIndex = 0
  const re = new RegExp(URL_RE)
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const raw = match[0]
    // Keep trailing punctuation (period, comma…) out of the href and as text.
    const trimmed = raw.replace(/[.,;:!?]+$/, '')
    const trailing = raw.slice(trimmed.length)
    const start = match.index
    if (start > lastIndex) parts.push(text.slice(lastIndex, start))
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    parts.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-[var(--accent-emerald)] underline decoration-[var(--accent-emerald)]/40 underline-offset-2 transition-colors hover:text-[var(--accent-emerald-bright)] hover:decoration-[var(--accent-emerald)]"
      >
        {trimmed}
      </a>,
    )
    if (trailing) parts.push(trailing)
    lastIndex = start + raw.length
  }
  if (lastIndex === 0) return text
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function PlatformGrid() {
  const [active, setActive] = useState<PlatformSetup | null>(null)
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Setup guide — pick a platform</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PLATFORM_SETUP.map((p) => {
          const Icon = p.icon
          return (
            <button
              key={p.key}
              onClick={() => setActive(p)}
              className="group flex flex-col items-start gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4 text-left transition-all hover:border-[var(--accent-emerald)]/50 hover:bg-white/[0.03]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05] text-white">
                <Icon size={18} />
              </div>
              <div className="text-sm font-semibold text-white">{p.name}</div>
              <div className="text-xs text-[var(--text-secondary)]">{p.tagline}</div>
              <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-emerald)] transition-all group-hover:gap-2">
                Open guide <ChevronRight size={13} />
              </span>
            </button>
          )
        })}
      </div>

      <Modal open={active !== null} onClose={() => setActive(null)} title={active ? `${active.name} — step-by-step setup` : ''}>
        {active && (
          <div className="flex flex-col gap-4">
            {active.paste && (
              <p className="rounded-lg border border-[var(--border-card)] bg-white/[0.03] px-3 py-2 text-xs text-[var(--text-secondary)]">{linkify(active.paste)}</p>
            )}
            <ol className="flex flex-col gap-3">
              {active.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm text-slate-300">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-xs font-bold text-blue-400">{i + 1}</span>
                  <span className="pt-0.5 leading-relaxed">{linkify(s)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Modal>
    </div>
  )
}

/** Mono, letter-spaced, muted eyebrow used above each block in the article panel. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
      {children}
    </div>
  )
}

function SectionContent({ section }: { section: InstructionSection }) {
  const Icon = section.icon

  return (
    <div className="glass rounded-2xl p-[26px]">
      {/* Header: sapphire tile + title */}
      <div className="flex items-center gap-3.5">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
          style={{
            background: 'linear-gradient(140deg, #3F7BFF, #2050E6)',
            boxShadow: '0 6px 18px -6px rgba(47,107,255,.55)',
          }}
        >
          <Icon size={21} />
        </div>
        <h2 className="text-[22px] font-bold leading-tight text-white">{section.navLabel}</h2>
      </div>

      {/* Intro */}
      <p className="mt-5 max-w-[760px] text-[14.5px] leading-[1.75] text-[var(--text-secondary)]">
        {linkify(section.intro)}
      </p>

      {/* How to use it — numbered steps */}
      <div className="mt-8">
        <Eyebrow>{section.howToUseTitle}</Eyebrow>
        <ol className="mt-3.5 flex flex-col gap-3">
          {section.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span
                className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                style={{ background: 'rgba(91,140,255,.16)', color: '#A9C4FF' }}
              >
                {i + 1}
              </span>
              <span className="pt-0.5 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{linkify(step)}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Metrics */}
      {section.metrics && (
        <div className="mt-8">
          <Eyebrow>{section.metricsTitle}</Eyebrow>
          <div className="mt-3.5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {section.metrics.map((m) => (
              <div
                key={m.name}
                className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4"
              >
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{m.name}</h4>
                <dl className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed text-[var(--text-muted)]">
                  <div>
                    <dt className="inline font-medium text-[var(--text-secondary)]">What it measures: </dt>
                    <dd className="inline">{linkify(m.what)}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-[var(--text-secondary)]">How it&apos;s calculated: </dt>
                    <dd className="inline">{linkify(m.how)}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-[var(--text-secondary)]">Why it matters: </dt>
                    <dd className="inline">{linkify(m.why)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}

      {section.key === 'integrations' && (
        <div className="mt-8">
          <PlatformGrid />
        </div>
      )}

      {/* Explained items */}
      {section.explainedItems && section.key !== 'integrations' && (
        <div className="mt-8">
          <Eyebrow>{section.explainedTitle}</Eyebrow>
          <div className="mt-3.5 flex flex-col gap-2.5">
            {section.explainedItems.map((item) => (
              <div
                key={item.name}
                className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4"
              >
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{item.name}</h4>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{linkify(item.description)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pro tips */}
      <div
        className="mt-8 rounded-2xl p-5"
        style={{
          background: 'linear-gradient(150deg, rgba(47,107,255,.16), rgba(88,60,232,.09))',
          border: '1px solid rgba(120,160,255,.2)',
        }}
      >
        <div className="flex items-center gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#A9C4FF]">
          <Sparkles size={13} /> Pro tips
        </div>
        <ul className="mt-3.5 flex flex-col gap-2.5">
          {section.proTips.map((tip, i) => (
            <li key={i} className="flex items-start gap-3 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
              <span
                className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full"
                style={{ background: '#5B8CFF', boxShadow: '0 0 8px 1px rgba(91,140,255,.7)' }}
              />
              {linkify(tip)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function PrintableInstructions() {
  return (
    <div className="hidden print:block print:bg-white print:text-black">
      <div className="mb-6 flex items-center gap-3 border-b-2 border-black pb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black text-lg font-extrabold text-white">C</div>
        <div>
          <div className="text-xl font-bold">Catch — Instructions Guide</div>
          <div className="text-sm">Everything you need to run Catch like a pro.</div>
        </div>
      </div>

      {INSTRUCTION_SECTIONS.map((section) => {
        const Icon = section.icon
        return (
          <section key={section.key} className="break-after-page pb-6">
            <div className="mb-3 flex items-center gap-2 border-b border-black/20 pb-2">
              <Icon size={18} />
              <h2 className="text-lg font-bold">{section.navLabel}</h2>
            </div>
            <p className="mb-3 text-sm leading-relaxed">{linkify(section.intro)}</p>

            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide">{section.howToUseTitle}</h3>
            <ol className="mb-3 list-decimal pl-5 text-sm leading-relaxed">
              {section.steps.map((step, i) => (
                <li key={i}>{linkify(step)}</li>
              ))}
            </ol>

            {section.metrics && (
              <>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wide">{section.metricsTitle}</h3>
                <div className="mb-3 flex flex-col gap-2 text-sm leading-relaxed">
                  {section.metrics.map((m) => (
                    <div key={m.name}>
                      <div className="font-semibold">{m.name}</div>
                      <div>What it measures: {linkify(m.what)}</div>
                      <div>How it&apos;s calculated: {linkify(m.how)}</div>
                      <div>Why it matters: {linkify(m.why)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {section.explainedItems && (
              <>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wide">{section.explainedTitle}</h3>
                <div className="mb-3 flex flex-col gap-1.5 text-sm leading-relaxed">
                  {section.explainedItems.map((item) => (
                    <div key={item.name}>
                      <span className="font-semibold">{item.name}:</span> {linkify(item.description)}
                    </div>
                  ))}
                </div>
              </>
            )}

            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide">Pro tips</h3>
            <ul className="list-disc pl-5 text-sm leading-relaxed">
              {section.proTips.map((tip, i) => (
                <li key={i}>{linkify(tip)}</li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

export function Instructions() {
  const [searchParams] = useSearchParams()
  const initialKey = INSTRUCTION_SECTIONS.find((s) => s.key === searchParams.get('section'))?.key ?? INSTRUCTION_SECTIONS[0].key
  const [activeKey, setActiveKey] = useState(initialKey)
  const active = INSTRUCTION_SECTIONS.find((s) => s.key === activeKey) ?? INSTRUCTION_SECTIONS[0]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-bold text-white">Instructions</h1>
          <p className="text-sm text-[var(--text-secondary)]">Everything you need to run Catch like a pro.</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--border-card)] px-4 py-2.5 text-sm font-medium text-white hover:bg-white/[0.04] transition-colors"
        >
          <Download size={15} /> Export as PDF
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 print:hidden lg:grid-cols-[260px_1fr]">
        <nav className="flex flex-col gap-2 lg:sticky lg:top-6 lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto lg:pr-1">
          {INSTRUCTION_SECTIONS.map((section) => {
            const isActive = section.key === activeKey
            return (
              <button
                key={section.key}
                onClick={() => setActiveKey(section.key)}
                className="w-full rounded-xl border px-4 py-3 text-left transition-all duration-200"
                style={
                  isActive
                    ? {
                        background: 'linear-gradient(120deg, rgba(47,107,255,.24), rgba(88,60,232,.10))',
                        borderColor: 'rgba(120,160,255,.34)',
                      }
                    : {
                        background: 'var(--bg-card)',
                        borderColor: 'var(--border-card)',
                      }
                }
              >
                <div className={`text-[13px] font-bold ${isActive ? 'text-white' : 'text-[var(--text-primary)]'}`}>
                  {section.navLabel}
                </div>
                <div
                  className={`mt-0.5 text-[11.5px] leading-snug ${isActive ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}
                >
                  {section.navDescription}
                </div>
              </button>
            )
          })}
        </nav>

        <div className="min-w-0">
          <SectionContent section={active} />
        </div>
      </div>

      <PrintableInstructions />
    </div>
  )
}
