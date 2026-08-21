-- Onboarding profile — lightweight "who is using Catch" signal captured during
-- the 3-step onboarding. Stored on the profile so each field belongs to the
-- authenticated user and is covered by the existing profiles RLS policies.
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists manages_multiple boolean;
alter table public.profiles add column if not exists community_size text;
alter table public.profiles add column if not exists primary_platforms text[] default '{}';
alter table public.profiles add column if not exists onboarded_at timestamptz;
