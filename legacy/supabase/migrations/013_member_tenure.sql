-- Discord member tenure & retention — answers "how long do people stay in our
-- Discord?". Fed by the discord-members-sync edge function, which pages through
-- GET /guilds/{id}/members (requires the Server Members privileged intent) and
-- reads each member's `joined_at`.
--
-- Honest model:
--   discord_member_tenure       → one row per member we have EVER seen. `joined_at`
--                                 gives tenure; `last_seen` is stamped on every sync
--                                 run, so a member whose last_seen stops advancing
--                                 has left the server. That is what makes REAL
--                                 retention possible over time (a single run can only
--                                 measure the tenure of survivors).
--   discord_membership_snapshots → one row per sync run (totals + joined + left), so
--                                 churn/retention can be charted going forward.
-- Run once in the CATCH project SQL editor.

create table if not exists public.discord_member_tenure (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  member_ref text not null,                        -- Discord user id (stable snowflake)
  joined_at timestamptz,                           -- join date to THIS guild (from the API)
  first_seen timestamptz not null default now(),   -- first sync run that saw this member
  last_seen timestamptz not null default now(),    -- most recent sync run that saw them
  unique(workspace_id, member_ref)
);
create index if not exists dmt_ws_joined_idx on public.discord_member_tenure(workspace_id, joined_at);

create table if not exists public.discord_membership_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  captured_at timestamptz not null default now(),
  total_members integer not null default 0,        -- non-bot members seen in this run
  new_members integer not null default 0,          -- never seen before this run
  left_members integer not null default 0          -- present at the previous run, absent now
);
create index if not exists dms_ws_time_idx on public.discord_membership_snapshots(workspace_id, captured_at desc);

alter table public.discord_member_tenure enable row level security;
drop policy if exists "Owner can read member tenure" on public.discord_member_tenure;
create policy "Owner can read member tenure" on public.discord_member_tenure
  for all using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

alter table public.discord_membership_snapshots enable row level security;
drop policy if exists "Owner can read membership snapshots" on public.discord_membership_snapshots;
create policy "Owner can read membership snapshots" on public.discord_membership_snapshots
  for all using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

-- This project's RLS setup also needs the explicit table grants, otherwise every
-- query fails with "permission denied for table ..." before RLS is even evaluated.
grant all privileges on public.discord_member_tenure to anon, authenticated, service_role;
grant all privileges on public.discord_membership_snapshots to anon, authenticated, service_role;
