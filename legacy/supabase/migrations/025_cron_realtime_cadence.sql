-- Real-time ingestion cadence (#4 follow-up): move the cron-sync worker from
-- hourly to EVERY MINUTE, and give it the little bit of state it needs to stay
-- polite towards the third-party APIs it polls.
--
-- The per-minute tick is only the *upper bound* of how often we may call an API:
-- cron-sync itself enforces a per-platform minimum interval (Discord/Telegram 60s,
-- Galxe/Zealy 300s) and a deterministic per-workspace jitter, so a minute tick does
-- NOT mean every platform of every workspace is hit every minute.
--
-- PREREQUISITES (do these first, in order):
--   1. Redeploy the function WITHOUT JWT verification (it self-gates on CRON_SECRET):
--        npx supabase functions deploy cron-sync --no-verify-jwt
--   2. The function secrets from 009 must already be set (CRON_SECRET,
--      SUPABASE_SERVICE_ROLE_KEY). Nothing new is required here.
--   3. Replace <CRON_SECRET> below with the SAME value used in 009, then run this
--      in the SQL editor of the CATCH project (ref mklxvnusaqcmzbnrklgs).
--
-- ROW VOLUME / RETENTION — read before running:
--   platform_metric_snapshots used to grow by 24 rows/day per connected platform.
--   With this cadence the *ceiling* is 1440 rows/day for Discord and Telegram and
--   288 rows/day for Galxe and Zealy — i.e. at most ~3456 rows/day for a workspace
--   with all four platforms connected (~1.3M rows/year). In practice it is far less:
--   cron-sync only writes a snapshot when the metric payload actually CHANGED since
--   the previous one (plus a 30-minute heartbeat row so a flat metric still leaves a
--   trace in the "last hour" window). A quiet community therefore costs ~48 rows/day
--   per platform, and only busy hours approach the ceiling.
--   Enable the retention job at the bottom of this file if you want automatic pruning.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Sync state ────────────────────────────────────────────────────────────────
-- One row per (workspace, platform) holding when we last hit that API and what we
-- last stored. It exists because the throttle can no longer be derived from
-- platform_metric_snapshots: snapshots are now written only on change, so their
-- timestamp no longer answers "when did we last call this API?".
--
-- `platform` also holds pseudo-platforms for sub-jobs that have their own budget,
-- currently 'discord:activity' (the message heatmap poll).
create table if not exists public.integration_sync_state (
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  platform text not null,
  -- Attempt, not success: a rate-limited or failing call still consumed API budget,
  -- so it must push the next try out by the full interval.
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_snapshot_at timestamptz,
  -- Last metric payload written to platform_metric_snapshots, used for change detection.
  last_metrics jsonb,
  primary key (workspace_id, platform)
);

alter table public.integration_sync_state enable row level security;
drop policy if exists "Owner can read sync state" on public.integration_sync_state;
create policy "Owner can read sync state" on public.integration_sync_state
  for all using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

grant all privileges on public.integration_sync_state to anon, authenticated, service_role;

-- ── Schedule ──────────────────────────────────────────────────────────────────
-- Remove BOTH the old hourly job and any previous run of this file, so re-running
-- can never leave two schedules pointing at the same function.
select cron.unschedule('catch-hourly-sync')
where exists (select 1 from cron.job where jobname = 'catch-hourly-sync');

select cron.unschedule('catch-realtime-sync')
where exists (select 1 from cron.job where jobname = 'catch-realtime-sync');

-- Every minute. The function decides per platform whether it is actually due.
select cron.schedule(
  'catch-realtime-sync',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://mklxvnusaqcmzbnrklgs.supabase.co/functions/v1/cron-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);

-- Inspect / manage later:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select * from public.integration_sync_state order by last_attempt_at desc;
--   select cron.unschedule('catch-realtime-sync');
--
-- Optional retention (keep 30 days) — recommended now that snapshots are minute-grained:
--   select cron.schedule('catch-snapshot-retention', '30 3 * * *',
--     $$ delete from public.platform_metric_snapshots where captured_at < now() - interval '30 days'; $$);
--
-- Rollback to the hourly cadence:
--   select cron.unschedule('catch-realtime-sync');
--   -- then re-run 009_cron_sync.sql
