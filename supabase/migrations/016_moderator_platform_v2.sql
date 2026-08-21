-- ============================================================================
-- 016 · Moderator profiles, resources drive, dedicated compensation,
--        content schedule, meetings, usage tracking
-- ----------------------------------------------------------------------------
-- Adds the schema required for the moderator lifecycle upgrade: profile page
-- with CV, timezone/shift allocation with punctuality tracking, response-rate
-- metrics, internal + external resource sharing with view logs, dedicated
-- compensation configuration (fixed/variable/both, with apply-to-all), content
-- calendar visible to moderators, meeting scheduling with calendar deep-links,
-- and a usage/consumption panel.
--
-- Run in Supabase SQL editor. Safe to re-run (idempotent guards).
-- ============================================================================

-- ── 1. Extend moderators with profile + shift columns ─────────────────────
alter table moderators
  add column if not exists bio text,
  add column if not exists skills text[] not null default array[]::text[],
  add column if not exists languages text[] not null default array[]::text[],
  add column if not exists platforms_known text[] not null default array[]::text[],
  add column if not exists external_source text,          -- 'X:@handle', 'linkedin.com/in/...', 'referral', 'internal'
  add column if not exists profile_photo_url text,
  add column if not exists cv_storage_path text,           -- path inside 'cvs' bucket
  add column if not exists cv_filename text,
  add column if not exists cv_extracted_text text,         -- raw text from pdf.js parse
  add column if not exists shift_start_utc int check (shift_start_utc between 0 and 23),
  add column if not exists shift_end_utc int check (shift_end_utc between 0 and 23),
  add column if not exists shift_days int[] not null default array[1,2,3,4,5]::int[]  -- 0=Sun..6=Sat, default weekdays
;

comment on column moderators.external_source is 'Where the moderator was recruited from — X handle, LinkedIn URL, "internal", "referral".';
comment on column moderators.shift_days is '0=Sun..6=Sat. Default weekdays [1-5].';

-- ── 2. Response-rate + shift punctuality metrics ──────────────────────────
create table if not exists moderator_response_metrics (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references moderators(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null check (platform in ('discord','telegram','twitch','youtube','kick','x')),
  day date not null,
  responses_count int not null default 0,
  avg_response_seconds int,
  created_at timestamptz not null default now(),
  unique (moderator_id, platform, day)
);
create index if not exists idx_mod_response_metrics_mod_day on moderator_response_metrics (moderator_id, day desc);

create table if not exists moderator_shift_events (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references moderators(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  day date not null,
  expected_start_utc timestamptz not null,
  expected_end_utc timestamptz not null,
  first_activity_utc timestamptz,          -- null = no-show
  was_on_time boolean,                     -- true if activity within +/- 15min of expected_start
  created_at timestamptz not null default now(),
  unique (moderator_id, day)
);
create index if not exists idx_mod_shift_events_mod_day on moderator_shift_events (moderator_id, day desc);

-- ── 3. Dedicated compensation config (per moderator) ──────────────────────
create table if not exists compensation_configs (
  moderator_id uuid primary key references moderators(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null default 'variable' check (kind in ('fixed','variable','both')),
  fixed_amount numeric(12,2),
  fixed_currency text check (fixed_currency in ('USD','EUR','USDT')),
  fixed_period text check (fixed_period in ('monthly','weekly','hourly')),
  -- variable portion reuses the existing points engine (see mig 007) — stored
  -- as-is in each moderator's per-metric points; nothing new here except link.
  variable_notes text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_comp_configs_workspace on compensation_configs (workspace_id);

-- ── 4. Resources drive (internal storage + external Drive links) ──────────
create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('file','external_link')),
  title text not null,
  description text,
  storage_path text,           -- internal: path in 'resources' bucket. null for external
  external_url text,           -- external: Google Drive / Notion / etc. null for internal
  mime_type text,
  size_bytes bigint,
  visibility text not null default 'team' check (visibility in ('team','private')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'file' and storage_path is not null) or (kind = 'external_link' and external_url is not null))
);
create index if not exists idx_resources_workspace on resources (workspace_id, created_at desc);

create table if not exists resource_views (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references resources(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- who viewed: either a linked auth user (CM) or a moderator record
  viewer_user_id uuid references auth.users(id) on delete set null,
  viewer_moderator_id uuid references moderators(id) on delete set null,
  viewer_label text,           -- fallback for anonymous mod views (e.g. discord handle)
  viewed_at timestamptz not null default now()
);
create index if not exists idx_resource_views_resource on resource_views (resource_id, viewed_at desc);

-- ── 5. Content schedule (calendar, CM-owned, mod-visible) ────────────────
create table if not exists content_schedule (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  description text,
  platform text check (platform in ('discord','telegram','twitter','x','zealy','galxe','snapshot','twitch','youtube','kick','other')),
  scheduled_at timestamptz not null,
  published_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','published','cancelled')),
  owner_user_id uuid references auth.users(id) on delete set null,
  assigned_moderator_id uuid references moderators(id) on delete set null,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_content_schedule_workspace_time on content_schedule (workspace_id, scheduled_at);

-- ── 6. Meetings (calendar deep-link, no OAuth) ────────────────────────────
create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meet_link text,              -- optional manual link; deep-link path generates one via GCal
  attendee_emails text[] not null default array[]::text[],
  attendee_moderator_ids uuid[] not null default array[]::uuid[],
  provider text not null default 'google' check (provider in ('google','outlook','other')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_meetings_workspace_time on meetings (workspace_id, starts_at);

-- ── 7. Usage / consumption events ─────────────────────────────────────────
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  event_type text not null,     -- 'edge_function','ai_recap','ai_cv_parse','storage_bytes','email_report','cron_sync'
  platform text,                -- optional integration key
  quantity numeric not null default 1,
  unit text not null default 'call',   -- 'call','tokens','bytes','emails'
  cost_hint_usd numeric(10,6),         -- optional; informative for the CM
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists idx_usage_events_workspace_time on usage_events (workspace_id, occurred_at desc);
create index if not exists idx_usage_events_type on usage_events (workspace_id, event_type, occurred_at desc);

-- ── 8. RLS policies (mirror the existing workspace-scoped pattern) ────────
alter table moderator_response_metrics enable row level security;
alter table moderator_shift_events enable row level security;
alter table compensation_configs enable row level security;
alter table resources enable row level security;
alter table resource_views enable row level security;
alter table content_schedule enable row level security;
alter table meetings enable row level security;
alter table usage_events enable row level security;

do $$
declare
  t text;
  tables text[] := array[
    'moderator_response_metrics','moderator_shift_events','compensation_configs',
    'resources','resource_views','content_schedule','meetings','usage_events'
  ];
begin
  foreach t in array tables loop
    execute format($f$
      drop policy if exists "%1$s_owner_all" on %1$I;
      create policy "%1$s_owner_all" on %1$I
        for all
        using (
          workspace_id in (select id from workspaces where owner_id = auth.uid())
        )
        with check (
          workspace_id in (select id from workspaces where owner_id = auth.uid())
        );
    $f$, t);
  end loop;
end $$;

-- Grants (align with 005_grants pattern)
grant all on moderator_response_metrics, moderator_shift_events, compensation_configs,
             resources, resource_views, content_schedule, meetings, usage_events
      to anon, authenticated, service_role;

-- ── 9. Storage buckets ────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('resources', 'resources', false)
on conflict (id) do nothing;

-- Basic storage policies: authenticated users can manage objects in workspaces
-- they own. Path convention: <workspace_id>/<...>.
do $$
begin
  -- cvs
  begin
    drop policy if exists "cvs_owner_rw" on storage.objects;
  exception when others then null;
  end;
  create policy "cvs_owner_rw" on storage.objects
    for all
    to authenticated
    using (
      bucket_id = 'cvs'
      and (split_part(name, '/', 1))::uuid in (select id from workspaces where owner_id = auth.uid())
    )
    with check (
      bucket_id = 'cvs'
      and (split_part(name, '/', 1))::uuid in (select id from workspaces where owner_id = auth.uid())
    );

  -- resources
  begin
    drop policy if exists "resources_owner_rw" on storage.objects;
  exception when others then null;
  end;
  create policy "resources_owner_rw" on storage.objects
    for all
    to authenticated
    using (
      bucket_id = 'resources'
      and (split_part(name, '/', 1))::uuid in (select id from workspaces where owner_id = auth.uid())
    )
    with check (
      bucket_id = 'resources'
      and (split_part(name, '/', 1))::uuid in (select id from workspaces where owner_id = auth.uid())
    );
end $$;
