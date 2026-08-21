-- Report email automation (#6). One schedule row per workspace: the CM picks a
-- cadence (off / daily / weekly on a weekday), a local time + timezone, a report
-- type and a recipient. The `send-report` edge function is polled hourly by
-- pg_cron and dispatches whichever schedules are "due" that hour.
--
-- RLS is owner-based, matching every existing table. Table GRANTs are included
-- because this project needs them explicitly or queries fail with
-- "permission denied for table ..." (RLS still protects the rows).
--
-- Run once in the SQL editor of the CATCH project (ref mklxvnusaqcmzbnrklgs).

create table if not exists public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null unique,
  report_type text not null default 'general',   -- 'community' | 'general'
  cadence text not null default 'off',            -- 'off' | 'daily' | 'weekly'
  weekday int,                                    -- 0 (Sun) .. 6 (Sat); weekly only
  time text not null default '21:00',             -- 'HH:MM', local to `timezone`
  timezone text not null default 'UTC',           -- IANA tz, e.g. 'Europe/Rome'
  email text,
  enabled boolean not null default false,
  last_sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists report_schedules_enabled_idx
  on public.report_schedules (enabled) where enabled = true;

alter table public.report_schedules enable row level security;
drop policy if exists "Owner can manage report_schedules" on public.report_schedules;
create policy "Owner can manage report_schedules" on public.report_schedules
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- GRANTs — required by this project (RLS still enforces row ownership).
grant all privileges on public.report_schedules to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- HOURLY DISPATCH (pg_cron) — mirrors migrations/009_cron_sync.sql.
--
-- PREREQUISITES (do these first, in order):
--   1. Deploy the function WITHOUT JWT verification (it self-gates on CRON_SECRET):
--        npx supabase functions deploy send-report --no-verify-jwt
--   2. Set the function secrets:
--        npx supabase secrets set CRON_SECRET=<your-random-secret>
--        npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
--        npx supabase secrets set RESEND_API_KEY=<resend-api-key>
--        npx supabase secrets set REPORT_FROM_EMAIL='Catch <reports@your-verified-domain>'
--   3. Replace <CRON_SECRET> below with the SAME value, then run this file.
--
-- Cron granularity is HOURLY, so schedule times are matched to the hour (the
-- minutes component of `time` is informational). send-report itself uses
-- `last_sent_at` to guarantee at-most-once-per-day delivery.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('catch-report-dispatch')
where exists (select 1 from cron.job where jobname = 'catch-report-dispatch');

-- Every hour, on the hour.
select cron.schedule(
  'catch-report-dispatch',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://mklxvnusaqcmzbnrklgs.supabase.co/functions/v1/send-report',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);

-- Inspect / manage later:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select cron.unschedule('catch-report-dispatch');
