-- 027_realtime_publication.sql
-- Puts the dashboard-facing tables on the `supabase_realtime` publication so
-- the frontend gets a postgres_changes event the moment a cron sync writes,
-- instead of waiting out its 5-minute polling interval.
--
-- `alter publication ... add table` errors if the table is already a member, so
-- each add is guarded by a pg_publication_tables lookup — re-running this file
-- (or running it after Supabase Studio already enabled one of the tables) is a
-- no-op. The frontend keeps its polling fallback, so nothing breaks if this
-- migration hasn't been applied yet.

do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_metrics',
    'platform_metric_snapshots',
    'message_activity',
    'member_messages',
    'integrations',
    'moderator_shift_events',
    'tasks',
    'payments'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- REPLICA IDENTITY FULL is what makes DELETE/UPDATE events carry the old row,
-- which is how the client-side `workspace_id=eq.…` filter can match a delete at
-- all. Without it those events arrive unfiltered-out and the workspace scoping
-- silently drops them.
alter table public.platform_metrics replica identity full;
alter table public.platform_metric_snapshots replica identity full;
alter table public.message_activity replica identity full;
alter table public.member_messages replica identity full;
alter table public.integrations replica identity full;
alter table public.moderator_shift_events replica identity full;
alter table public.tasks replica identity full;
alter table public.payments replica identity full;
