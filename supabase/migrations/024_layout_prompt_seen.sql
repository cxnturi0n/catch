-- 024_layout_prompt_seen.sql
-- One-shot gate for the "Build your layout with Catch" first-run prompt.
-- Stamped the first time the user sees it, so it never reappears — on any
-- workspace, on any device. Nullable: existing users simply haven't seen it yet.

alter table public.profiles
  add column if not exists layout_prompt_seen_at timestamptz;
