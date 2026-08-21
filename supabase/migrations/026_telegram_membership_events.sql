-- Exact Telegram joins & leaves (#26). Until now membership was only observable
-- as a NET delta: cron-sync polls getChatMemberCount hourly, so 60 joins and 20
-- leaves in the same hour collapse into a single "+40" and the churn is invisible.
--
-- Telegram's `chat_member` update carries the real transition (old status → new
-- status) for every member, in real time. This table records one row per actual
-- join or leave so gross joins, gross leaves and churn become exact instead of
-- inferred. Fed by the telegram-webhook function.
--
-- HONESTY NOTE: there is NO backfill. Telegram never replays past membership
-- changes, so these counts accrue strictly from the moment the webhook is
-- registered WITH `chat_member` in allowed_updates — exactly like the message
-- ingestion in 010. Anything before activation is unknown, not zero.
--
-- Run once in the CATCH project SQL editor.

create table if not exists public.telegram_membership_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  chat_id text not null,             -- Telegram chat the event happened in
  user_ref text not null,            -- Telegram user id (stable)
  display_name text,                 -- @username or first name (may change)
  event_type text not null check (event_type in ('join', 'leave')),
  old_status text,                   -- raw Telegram statuses, kept for auditing
  new_status text,                   -- (e.g. 'left' → 'member', 'member' → 'kicked')
  occurred_at timestamptz not null default now(),
  created_at timestamptz default now(),
  -- Telegram retries a delivery until it gets a 200, and the same update can
  -- arrive twice. `date` is second-resolution and identical across retries, so
  -- this key makes re-delivery a no-op instead of a double count.
  unique(workspace_id, chat_id, user_ref, event_type, occurred_at)
);
create index if not exists telegram_membership_events_ws_time_idx
  on public.telegram_membership_events (workspace_id, occurred_at desc);
create index if not exists telegram_membership_events_ws_type_idx
  on public.telegram_membership_events (workspace_id, event_type, occurred_at desc);

alter table public.telegram_membership_events enable row level security;
drop policy if exists "Owner can read telegram_membership_events" on public.telegram_membership_events;
create policy "Owner can read telegram_membership_events" on public.telegram_membership_events
  for all using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

grant all privileges on public.telegram_membership_events to anon, authenticated, service_role;

-- Single insertion point for the webhook, mirroring bump_member_message in 010:
-- the edge function calls an RPC rather than writing the table directly, so the
-- dedup rule lives in one place and the function needs no table-level knowledge.
-- Returns void; a duplicate delivery is silently dropped.
create or replace function public.record_telegram_membership_event(
  p_workspace uuid,
  p_chat_id text,
  p_user_ref text,
  p_display_name text,
  p_event_type text,
  p_old_status text,
  p_new_status text,
  p_occurred_at timestamptz
) returns void
language sql
as $$
  insert into public.telegram_membership_events (
    workspace_id, chat_id, user_ref, display_name,
    event_type, old_status, new_status, occurred_at
  )
  values (
    p_workspace, p_chat_id, p_user_ref, p_display_name,
    p_event_type, p_old_status, p_new_status, coalesce(p_occurred_at, now())
  )
  on conflict (workspace_id, chat_id, user_ref, event_type, occurred_at)
  do nothing;
$$;

grant execute on function public.record_telegram_membership_event(uuid, text, text, text, text, text, text, timestamptz) to anon, authenticated, service_role;
