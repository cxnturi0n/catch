-- Near-real-time ingestion (#4): schedule the cron-sync edge function to refresh
-- every connected workspace's Discord/Telegram metrics on a fixed cadence.
--
-- PREREQUISITES (do these first, in order):
--   1. Deploy the function WITHOUT JWT verification (it self-gates on CRON_SECRET):
--        npx supabase functions deploy cron-sync --no-verify-jwt
--   2. Set the function secrets (pick any long random CRON_SECRET):
--        npx supabase secrets set CRON_SECRET=<your-random-secret>
--        npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
--   3. Replace <CRON_SECRET> below with the SAME value, then run this in the
--      SQL editor of the CATCH project (ref mklxvnusaqcmzbnrklgs).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous schedule so re-running this file is safe.
select cron.unschedule('catch-hourly-sync')
where exists (select 1 from cron.job where jobname = 'catch-hourly-sync');

-- Every hour, on the hour. For a 5-hour cadence use '0 */5 * * *' instead.
select cron.schedule(
  'catch-hourly-sync',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://mklxvnusaqcmzbnrklgs.supabase.co/functions/v1/cron-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);

-- Inspect / manage later:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select cron.unschedule('catch-hourly-sync');
