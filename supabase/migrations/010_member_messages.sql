-- Messages per member (#1). Telegram gives no message history, but a bot with
-- privacy mode OFF receives every new group message via webhook. This table
-- tallies messages per member per day, fed by the telegram-webhook function.
-- Run once in the CATCH project SQL editor.

create table if not exists public.member_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  platform text not null default 'telegram',
  member_ref text not null,          -- platform user id (stable)
  display_name text,                 -- @username or first name (may change)
  day date not null default current_date,
  message_count integer not null default 0,
  updated_at timestamptz default now(),
  unique(workspace_id, platform, member_ref, day)
);
create index if not exists member_messages_workspace_idx on public.member_messages(workspace_id, day);

alter table public.member_messages enable row level security;
drop policy if exists "Owner can read member_messages" on public.member_messages;
create policy "Owner can read member_messages" on public.member_messages
  for all using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

grant all privileges on public.member_messages to anon, authenticated, service_role;

-- Atomic per-message increment, called by the webhook (service role). Creates
-- the daily row on first message, then bumps the counter on every next one.
create or replace function public.bump_member_message(
  p_workspace uuid,
  p_platform text,
  p_member_ref text,
  p_display_name text
) returns void
language sql
as $$
  insert into public.member_messages (workspace_id, platform, member_ref, display_name, day, message_count, updated_at)
  values (p_workspace, p_platform, p_member_ref, p_display_name, current_date, 1, now())
  on conflict (workspace_id, platform, member_ref, day)
  do update set
    message_count = member_messages.message_count + 1,
    display_name = excluded.display_name,
    updated_at = now();
$$;

grant execute on function public.bump_member_message(uuid, text, text, text) to anon, authenticated, service_role;
