-- Report delivery targets — Slack + Notion (in addition to email).
--
-- Founder-discovery data shows Slack + Notion are the tools teams actually use,
-- so a schedule can now also push its report to a Slack incoming webhook and/or
-- append it to a Notion page. Slack/Notion cannot be called from the browser
-- (CORS + the secret would leak), so delivery runs server-side in the
-- `send-report-webhook` edge function.
--
-- Additive + idempotent: three new nullable columns on the existing
-- report_schedules table. No new RLS needed — the "Owner can manage
-- report_schedules" policy from migration 014 already scopes every row to its
-- workspace owner, so these delivery secrets are only readable/writable by that
-- owner. NOTE: these values are stored UNENCRYPTED. That is acceptable for v1
-- because they are RLS-gated (owner-only) and low-blast-radius (a per-workspace
-- Slack webhook / Notion integration token); revisit with Vault/pgsodium if the
-- threat model tightens.
--
-- Run once in the SQL editor of the CATCH project (ref mklxvnusaqcmzbnrklgs).

alter table public.report_schedules add column if not exists slack_webhook_url text;
alter table public.report_schedules add column if not exists notion_token text;
alter table public.report_schedules add column if not exists notion_page_id text;

comment on column public.report_schedules.slack_webhook_url is
  'Per-schedule Slack incoming-webhook URL; report POSTed here by send-report-webhook. Stored unencrypted, RLS-gated (owner-only) — acceptable v1.';
comment on column public.report_schedules.notion_token is
  'Per-schedule Notion integration token; used by send-report-webhook to append a block. Stored unencrypted, RLS-gated (owner-only) — acceptable v1.';
comment on column public.report_schedules.notion_page_id is
  'Per-schedule Notion page id the report block is appended to. Paired with notion_token. RLS-gated (owner-only).';
