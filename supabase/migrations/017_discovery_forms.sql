-- ============================================================================
-- 017 · Public discovery form (lead-gen + product research)
-- ----------------------------------------------------------------------------
-- Powers /discovery and /discovery/:slug. Fully public:
--   • anon may READ active form rows (to personalize the greeting)
--   • anon may INSERT responses (submit the form)
--   • anon may NOT read responses — only the owner (service_role / SQL editor,
--     which bypasses RLS) can. Verify with the anon SELECT test at the bottom.
--
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists discovery_forms (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  contact_name text,
  contact_email text,
  source       text,
  created_at   timestamptz not null default now(),
  is_active    boolean not null default true
);

create table if not exists discovery_responses (
  id               uuid primary key default gen_random_uuid(),
  form_id          uuid references discovery_forms(id) on delete cascade,
  slug_snapshot    text,
  respondent_name  text,
  respondent_email text,
  respondent_role  text,
  answers          jsonb not null,
  submitted_at     timestamptz not null default now(),
  user_agent       text,
  completion_ms    integer
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
create unique index if not exists idx_discovery_forms_slug on discovery_forms (slug);
create index if not exists idx_discovery_responses_form on discovery_responses (form_id);
create index if not exists idx_discovery_responses_submitted on discovery_responses (submitted_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table discovery_forms enable row level security;
alter table discovery_responses enable row level security;

-- forms: public may SELECT active rows only. No insert/update/delete policy
-- exists for anon/authenticated, so writes are denied by default.
drop policy if exists "discovery_forms_public_read" on discovery_forms;
create policy "discovery_forms_public_read" on discovery_forms
  for select
  to anon, authenticated
  using (is_active = true);

-- responses: public may INSERT. There is deliberately NO select policy, so RLS
-- filters every row out for anon → a SELECT returns 0 rows. service_role (the
-- SQL editor) bypasses RLS and can read everything.
drop policy if exists "discovery_responses_public_insert" on discovery_responses;
create policy "discovery_responses_public_insert" on discovery_responses
  for insert
  to anon, authenticated
  with check (true);

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Table-level privileges. We grant SELECT on responses to anon on purpose so
-- the verification query returns "0 rows" (RLS-filtered) rather than a
-- permission-denied error — the data itself stays protected by the missing
-- select policy above.
grant select          on discovery_forms     to anon, authenticated;
grant insert          on discovery_responses to anon, authenticated;
grant select          on discovery_responses to anon, authenticated;
grant all             on discovery_forms     to service_role;
grant all             on discovery_responses to service_role;

-- Lock down everything the public should never do.
revoke insert, update, delete on discovery_forms     from anon, authenticated;
revoke update, delete         on discovery_responses from anon, authenticated;

-- ── Seed ────────────────────────────────────────────────────────────────────
insert into discovery_forms (slug, contact_name, contact_email, source, is_active)
values
  ('generic', null,             null,                  null,        true),
  ('heather', 'Heather Bartha', 'hbartha225@gmail.com', 'linkedin', true)
on conflict (slug) do nothing;

-- ── Verification (run these AFTER the above, as the anon role) ───────────────
-- In the SQL editor, "Run as: anon" (role switcher) then:
--   select count(*) from discovery_responses;   -- expect: 0 rows / 0 count
--   select * from discovery_forms;              -- expect: only is_active rows
-- As the default (service_role) editor, both tables are fully readable.
