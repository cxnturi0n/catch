// Data layer for the public discovery form. Uses the anon Supabase client
// (no auth). RLS lets anon read active form rows and insert responses, but
// never read responses back.

import { supabase, isSupabaseConfigured } from './supabase'

export interface DiscoveryFormRow {
  id: string
  slug: string
  contact_name: string | null
  contact_email: string | null
  source: string | null
  is_active: boolean
}

/** Slugs are lowercase alphanumeric + hyphens only. Anything else is invalid. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && slug.length > 0 && slug.length <= 100
}

export type FetchFormResult =
  | { status: 'ok'; form: DiscoveryFormRow }
  | { status: 'not_found' }
  | { status: 'unconfigured' }
  | { status: 'error'; error: string }

/**
 * Loads a form row by slug. Only active rows are visible to anon (RLS), so a
 * missing/inactive form both resolve to `not_found`. An invalid slug never
 * hits the network.
 */
export async function fetchDiscoveryForm(slug: string): Promise<FetchFormResult> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' }
  if (!isValidSlug(slug)) return { status: 'not_found' }
  try {
    const { data, error } = await supabase
      .from('discovery_forms')
      .select('id, slug, contact_name, contact_email, source, is_active')
      .eq('slug', slug)
      .maybeSingle()
    if (error) return { status: 'error', error: error.message }
    if (!data) return { status: 'not_found' }
    return { status: 'ok', form: data as DiscoveryFormRow }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export interface DiscoveryResponseRow {
  id: string
  form_id: string | null
  slug_snapshot: string | null
  respondent_name: string | null
  respondent_email: string | null
  respondent_role: string | null
  answers: Record<string, string>
  submitted_at: string
  completion_ms: number | null
}

export type FetchResponsesResult =
  | { status: 'ok'; rows: DiscoveryResponseRow[] }
  | { status: 'unconfigured' }
  | { status: 'error'; error: string }

/**
 * Reads every discovery response, newest first. RLS restricts this to the
 * founder account (migration 021); any other session simply gets 0 rows. The
 * caller (owner-only admin page) also gates on email before rendering.
 */
export async function fetchAllDiscoveryResponses(): Promise<FetchResponsesResult> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' }
  try {
    const { data, error } = await supabase
      .from('discovery_responses')
      .select('id, form_id, slug_snapshot, respondent_name, respondent_email, respondent_role, answers, submitted_at, completion_ms')
      .order('submitted_at', { ascending: false })
    if (error) return { status: 'error', error: error.message }
    return { status: 'ok', rows: (data ?? []) as DiscoveryResponseRow[] }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export interface SubmitResponseInput {
  formId: string | null
  slugSnapshot: string
  respondentName: string | null
  respondentEmail: string | null
  respondentRole: string | null
  answers: Record<string, string>
  userAgent: string | null
  completionMs: number | null
}

/**
 * Inserts a response, retrying once on failure for network resilience. Returns
 * `ok: false` with the error message instead of throwing so the caller can keep
 * the user's data and let them retry.
 */
export async function submitDiscoveryResponse(input: SubmitResponseInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Submissions are not available on this deployment.' }

  const row = {
    form_id: input.formId,
    slug_snapshot: input.slugSnapshot,
    respondent_name: input.respondentName,
    respondent_email: input.respondentEmail,
    respondent_role: input.respondentRole,
    answers: input.answers,
    user_agent: input.userAgent,
    completion_ms: input.completionMs,
  }

  const attempt = async () => {
    const { error } = await supabase.from('discovery_responses').insert(row)
    return error?.message ?? null
  }

  // First try, then one automatic retry after a short backoff.
  let err = await attempt()
  if (err) {
    console.error('[discovery] insert failed, retrying once:', err, { slug: input.slugSnapshot })
    await new Promise((r) => setTimeout(r, 800))
    err = await attempt()
  }
  if (err) {
    console.error('[discovery] insert failed after retry:', err, { slug: input.slugSnapshot })
    return { ok: false, error: err }
  }
  return { ok: true }
}
