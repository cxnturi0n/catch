// Curated product documentation for the chat. Markdown files in backend/help
// are loaded into help_docs at boot and searched with Postgres full-text
// search. No embeddings, no external service: the corpus is small and
// reviewed in the repository.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { db } from '../../../db/client.js'
import { helpDocs } from '../../../db/schema/index.js'
import { logger } from '../../../logger.js'

const HELP_DIR = process.env.HELP_DIR ?? join(process.cwd(), 'help')

export async function loadHelpDocs(): Promise<number> {
  let files: string[]
  try {
    files = (await readdir(HELP_DIR)).filter((f) => f.endsWith('.md'))
  } catch {
    logger.warn({ HELP_DIR }, 'help directory not found; search_help will be empty')
    return 0
  }
  for (const f of files) {
    const body = await readFile(join(HELP_DIR, f), 'utf8')
    const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.replace(/\.md$/, '')
    const slug = f.replace(/\.md$/, '')
    await db
      .insert(helpDocs)
      .values({ slug, title, body })
      .onConflictDoUpdate({ target: helpDocs.slug, set: { title, body, updatedAt: new Date() } })
  }
  return files.length
}

export interface HelpHit {
  slug: string
  title: string
  snippet: string
}

/** Top chunks for a free-text query; each snippet capped so tool results stay small. */
export async function searchHelp(query: string, limit = 3): Promise<HelpHit[]> {
  const q = query.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().slice(0, 200)
  if (!q) return []
  const rows = await db.execute<{ slug: string; title: string; snippet: string }>(sql`
    select slug, title,
      ts_headline('english', body, websearch_to_tsquery('english', ${q}), 'MaxFragments=2, MaxWords=60, MinWords=20, FragmentDelimiter=" … "') as snippet
    from ${helpDocs}
    where tsv @@ websearch_to_tsquery('english', ${q})
    order by ts_rank(tsv, websearch_to_tsquery('english', ${q})) desc
    limit ${limit}`)
  return rows.rows.map((r) => ({ slug: r.slug, title: r.title, snippet: r.snippet.replace(/<\/?b>/g, '').slice(0, 600) }))
}
