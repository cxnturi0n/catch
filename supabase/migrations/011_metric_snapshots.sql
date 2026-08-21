-- Hourly metric snapshots (#4 granularity) — enables "last hour / last 5 hours /
-- 24h" windows on top of the existing daily rollup. The cron-sync worker inserts
-- one timestamped row per connected platform on every hourly run, so we keep the
-- history instead of overwriting a single daily row. History accrues from the
-- moment snapshots start (no backfill). Run once in the CATCH project SQL editor.

create table if not exists public.platform_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  platform text not null,
  captured_at timestamptz not null default now(),
  metrics jsonb not null default '{}'::jsonb
);
create index if not exists pms_ws_platform_time_idx
  on public.platform_metric_snapshots (workspace_id, platform, captured_at desc);

alter table public.platform_metric_snapshots enable row level security;
drop policy if exists "Owner can read metric snapshots" on public.platform_metric_snapshots;
create policy "Owner can read metric snapshots" on public.platform_metric_snapshots
  for all using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

grant all privileges on public.platform_metric_snapshots to anon, authenticated, service_role;

-- Optional retention (keep 30 days). Enable with pg_cron if you want automatic pruning:
--   select cron.schedule('catch-snapshot-retention', '30 3 * * *',
--     $$ delete from public.platform_metric_snapshots where captured_at < now() - interval '30 days'; $$);
