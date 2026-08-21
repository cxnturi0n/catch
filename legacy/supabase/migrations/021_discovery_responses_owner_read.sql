-- ============================================================================
-- 021 · Founder read access to discovery responses
-- ----------------------------------------------------------------------------
-- The public form (migration 017) lets anyone INSERT a response but nobody
-- SELECT them — only service_role (SQL editor) could read. This adds a single,
-- tightly-scoped SELECT policy so the FOUNDER (one email) can read every
-- response from inside the app's owner-only admin page. No one else gains read.
--
-- The `grant select ... to authenticated` already exists from 017; RLS is what
-- gates the rows, so without this policy an authenticated user still gets 0 rows.
--
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

drop policy if exists "discovery_responses_owner_read" on discovery_responses;
create policy "discovery_responses_owner_read" on discovery_responses
  for select
  to authenticated
  using ( lower(auth.jwt() ->> 'email') = 'cinicololuca@gmail.com' );

-- Verify (run as the founder in the app, or "Run as authenticated" with that JWT):
--   select count(*) from discovery_responses;   -- founder: real count; anyone else: 0
