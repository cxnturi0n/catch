-- Community activity heatmap (hour × weekday). Counts messages per UTC HOUR
-- bucket per platform, so the community manager can see WHEN the community is
-- active and staff moderator shifts accordingly.
--
-- Feeds:
--   • Telegram — the telegram-webhook function bumps the bucket of every new
--     group message. No history is possible; counts accrue from activation.
--   • Discord  — the discord-messages-sync function polls channel messages via
--     REST and bumps buckets. It fills FORWARD from activation (the first run
--     only takes the most recent 100 messages per channel as a starting point).
--
-- Run once in the CATCH project SQL editor.

create table if not exists public.message_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  platform text not null,                 -- 'telegram' | 'discord'
  bucket_start timestamptz not null,      -- truncated to the hour, UTC
  message_count integer not null default 0,
  updated_at timestamptz default now(),
  unique(workspace_id, platform, bucket_start)
);
create index if not exists message_activity_ws_bucket_idx
  on public.message_activity (workspace_id, bucket_start desc);

alter table public.message_activity enable row level security;
drop policy if exists "Owner can read message_activity" on public.message_activity;
create policy "Owner can read message_activity" on public.message_activity
  for all using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

grant all privileges on public.message_activity to anon, authenticated, service_role;

-- Per-channel polling cursors so a Discord sync run resumes exactly where the
-- previous one stopped (last_message_id is passed as ?after= on the next fetch).
create table if not exists public.discord_channel_cursors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  channel_id text not null,
  last_message_id text,
  updated_at timestamptz default now(),
  unique(workspace_id, channel_id)
);
create index if not exists discord_channel_cursors_ws_idx
  on public.discord_channel_cursors (workspace_id);

alter table public.discord_channel_cursors enable row level security;
drop policy if exists "Owner can read discord_channel_cursors" on public.discord_channel_cursors;
create policy "Owner can read discord_channel_cursors" on public.discord_channel_cursors
  for all using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

grant all privileges on public.discord_channel_cursors to anon, authenticated, service_role;

-- Atomic bucket increment. Callers pass an already-truncated hour bucket and a
-- delta (1 for a single Telegram message, N for a batch of Discord messages
-- that landed in the same hour). Inside `on conflict do update` the target table
-- must be referenced UNQUALIFIED (message_activity.*, never public.message_activity.*).
create or replace function public.bump_message_activity(
  p_workspace uuid,
  p_platform text,
  p_bucket timestamptz,
  p_delta integer
) returns void
language sql
as $$
  insert into public.message_activity (workspace_id, platform, bucket_start, message_count, updated_at)
  values (p_workspace, p_platform, date_trunc('hour', p_bucket at time zone 'UTC') at time zone 'UTC', greatest(p_delta, 0), now())
  on conflict (workspace_id, platform, bucket_start)
  do update set
    message_count = message_activity.message_count + greatest(excluded.message_count, 0),
    updated_at = now();
$$;

grant execute on function public.bump_message_activity(uuid, text, timestamptz, integer) to anon, authenticated, service_role;
