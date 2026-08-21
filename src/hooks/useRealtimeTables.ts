import { useEffect, useRef } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { WorkspaceId } from '../types'

// Bursty writers (a cron sync inserting a few hundred rows) would otherwise fire
// one refetch per row. Coalesce everything that lands inside this window.
const BURST_WINDOW_MS = 500

/**
 * Fires `onChange` as soon as any row in `tables` changes for the given
 * workspace, so dashboards stop waiting on their polling interval.
 *
 * Deliberately best-effort: guests and unconfigured environments never open a
 * channel, and a failed subscription (table not yet in the `supabase_realtime`
 * publication, socket dropped, RLS refusal) is swallowed. Every caller keeps
 * its own interval as the floor, so the worst case is the pre-realtime latency
 * rather than a broken page.
 */
export function useRealtimeTables(
  workspaceId: WorkspaceId | null | undefined,
  tables: readonly string[],
  onChange: () => void,
) {
  // Guests have no session, so Realtime would only ever hand back RLS refusals.
  const { user } = useAuth()

  // Keep the callback out of the effect deps: callers pass inline closures that
  // change identity every render, which would tear the channel down each time.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Same reason for the table list — compare by value, not by array identity.
  const tablesKey = tables.join(',')

  useEffect(() => {
    if (!isSupabaseConfigured || !user || !workspaceId || tablesKey === '') return

    let timer: number | undefined
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        onChangeRef.current()
      }, BURST_WINDOW_MS)
    }

    // Channel name is workspace + table scoped so two components watching
    // different tables don't collide on the same topic.
    const channel = supabase.channel(`rt:${workspaceId}:${tablesKey}`)
    for (const table of tablesKey.split(',')) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `workspace_id=eq.${workspaceId}` },
        schedule,
      )
    }

    try {
      channel.subscribe()
    } catch {
      // Subscription setup failed outright — polling still covers us.
    }

    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      void supabase.removeChannel(channel).catch(() => undefined)
    }
  }, [user, workspaceId, tablesKey])
}
