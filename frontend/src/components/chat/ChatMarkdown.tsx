import type { ReactNode } from 'react'

// Restricted markdown for assistant replies: no HTML, no images, no links.
// Anything not recognised renders as plain text.
/** Inline markup: **bold** and `code`. Everything else is plain text (no HTML, no links). */
export function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-[var(--text-primary)]">{part.slice(2, -2)}</strong>
    ) : part.startsWith('`') && part.endsWith('`') ? (
      <code key={i} className="rounded bg-white/[0.06] px-1 font-mono text-[12px]">{part.slice(1, -1)}</code>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

/** Block markup the assistant is allowed to use: paragraphs, bullets, numbered lists, ### headings. */
export function renderContent(text: string) {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const items = list.items.map((it, i) => <li key={i}>{renderInline(it)}</li>)
    out.push(list.ordered ? <ol key={out.length} className="my-1 list-decimal space-y-0.5 pl-5">{items}</ol> : <ul key={out.length} className="my-1 list-disc space-y-0.5 pl-5">{items}</ul>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || num) {
      const ordered = !!num
      if (!list || list.ordered !== ordered) {
        flush()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ?? num)![1]!)
      continue
    }
    flush()
    if (!line.trim()) continue
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    if (h) out.push(<div key={out.length} className="mt-1.5 font-semibold text-[var(--text-primary)]">{renderInline(h[1]!)}</div>)
    else out.push(<div key={out.length}>{renderInline(line)}</div>)
  }
  flush()
  return out
}

