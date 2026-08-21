-- Moderator compensation engine (#3) + Payments (#8)
-- Self-contained: run once in the Supabase SQL editor.
--
-- Adds four workspace-scoped tables:
--   points_config       — the metrics catalog (metric → points value), CM-editable
--   conversion_config   — one row per workspace: points→currency rate + currency
--   moderator_metrics   — per (moderator, metric, period) manually-entered counts
--   payments            — salary / payment history log
--
-- RLS is owner-based, matching every existing table. Table GRANTs are included
-- because this project needs them explicitly or queries fail with
-- "permission denied for table ..." (RLS still protects the rows).

-- POINTS CONFIG (metrics catalog)
create table if not exists public.points_config (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  metric_key text not null,
  label text not null,
  points numeric not null default 0,
  created_at timestamptz default now(),
  unique(workspace_id, metric_key)
);
alter table public.points_config enable row level security;
create policy "Owner can manage points_config" on public.points_config
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- CONVERSION CONFIG (points -> currency)
create table if not exists public.conversion_config (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null unique,
  rate numeric not null default 0.01,
  currency text not null default 'USD',
  updated_at timestamptz default now()
);
alter table public.conversion_config enable row level security;
create policy "Owner can manage conversion_config" on public.conversion_config
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- MODERATOR METRICS (manually-entered counts per moderator per metric)
create table if not exists public.moderator_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  moderator_id uuid references public.moderators(id) on delete cascade not null,
  metric_key text not null,
  value numeric not null default 0,
  period text not null default 'current',
  updated_at timestamptz default now(),
  unique(workspace_id, moderator_id, metric_key, period)
);
alter table public.moderator_metrics enable row level security;
create policy "Owner can manage moderator_metrics" on public.moderator_metrics
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- PAYMENTS (salary / payment history log)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  moderator_id uuid references public.moderators(id) on delete cascade not null,
  amount numeric not null default 0,
  currency text not null default 'USD',
  period text,
  note text,
  paid_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.payments enable row level security;
create policy "Owner can manage payments" on public.payments
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- GRANTS — required by this project (RLS still enforces row ownership).
grant all privileges on public.points_config to anon, authenticated, service_role;
grant all privileges on public.conversion_config to anon, authenticated, service_role;
grant all privileges on public.moderator_metrics to anon, authenticated, service_role;
grant all privileges on public.payments to anon, authenticated, service_role;
