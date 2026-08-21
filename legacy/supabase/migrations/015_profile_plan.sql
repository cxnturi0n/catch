-- Adds the billing plan tier to profiles. Defaults to 'starter' for new and
-- existing rows. Sales manually sets 'pro' / 'agency' / 'enterprise' after
-- contract signing, since pricing is quote-based (no self-serve checkout).
alter table profiles
  add column if not exists plan text not null default 'starter'
  check (plan in ('starter', 'pro', 'agency', 'enterprise'));

comment on column profiles.plan is
  'Billing tier. Drives quota limits in the app (see src/lib/plan.ts).';
