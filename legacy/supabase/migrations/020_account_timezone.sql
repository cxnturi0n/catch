-- 020_account_timezone.sql
-- Per-account display timezone. Stored as an IANA zone id (e.g. "Europe/Rome").
-- Null means "not set" → the app falls back to the browser's detected zone.
-- This is a DISPLAY preference only: all time data stays stored in UTC; the
-- account timezone just controls how times/dates are rendered across the app.

alter table public.profiles
  add column if not exists timezone text;

comment on column public.profiles.timezone is
  'IANA timezone id used to render all times for this account (display-only; data stays UTC).';
