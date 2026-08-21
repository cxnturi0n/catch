-- 023_moderator_country.sql
-- Adds an optional country/geography field to moderators, surfaced as a column
-- and header filter in the Directory table. Nullable so existing rows are valid.

alter table public.moderators
  add column if not exists country text;
