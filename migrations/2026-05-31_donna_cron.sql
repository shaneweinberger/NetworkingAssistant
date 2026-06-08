-- Donna cron schedule
-- Run this AFTER enabling pg_cron + pg_net in the Supabase dashboard.
-- Run this AFTER deploying the Edge Functions.
--
-- This is parameterised on two values you must set in vault:
--   1. supabase_url   e.g. https://aebhhantiqfvnmukqjeu.supabase.co
--   2. service_role_key  (Project Settings -> API -> service_role secret)
--
-- We store them in Supabase Vault (or just inline them below) so the cron job
-- can call the Edge Function with the right auth header.

-- ---------------------------------------------------------------------------
-- One-time setup: put the URL + service key into Postgres settings so we can
-- reference them from the cron jobs. EDIT THESE TWO LINES BEFORE RUNNING.
-- ---------------------------------------------------------------------------
-- alter database postgres set "app.settings.supabase_url" = 'https://aebhhantiqfvnmukqjeu.supabase.co';
-- alter database postgres set "app.settings.service_role_key" = 'YOUR_SERVICE_ROLE_KEY_HERE';

-- ---------------------------------------------------------------------------
-- Unschedule prior versions of these jobs so this script is re-runnable.
-- ---------------------------------------------------------------------------
do $$
declare j record;
begin
  for j in select jobname from cron.job where jobname in ('donna_sync', 'donna_digest') loop
    perform cron.unschedule(j.jobname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5-min sync
-- ---------------------------------------------------------------------------
select cron.schedule(
  'donna_sync',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/sync-and-extract',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);

-- ---------------------------------------------------------------------------
-- 8am Pacific daily digest (= 15:00 UTC standard, 16:00 UTC PDT).
-- We use 15:00 UTC for consistency; the function itself respects the user's
-- timezone preference when deciding whether to send.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'donna_digest',
  '0 15 * * *',
  $cron$
    select net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/send-digest-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- select jobname, schedule, active from cron.job where jobname like 'donna_%';
