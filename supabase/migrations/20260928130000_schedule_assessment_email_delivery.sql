-- Schedule resident-assessment-notifier `deliver_due` every 15 minutes.
-- It sends 24-hour reminder emails to Staff and retries initial emails that
-- failed. The shared secret lives only in Supabase Vault: the cron job sends
-- it and the Edge Function checks it through resident_reminder_secret_matches,
-- so nobody has to copy it anywhere.

create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'resident_reminder_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'resident_reminder_cron_secret',
      'x-reminder-secret for resident-assessment-notifier deliver_due'
    );
  end if;
end;
$$;

create or replace function public.resident_reminder_secret_matches(p_secret text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.decrypted_secret = p_secret
     from vault.decrypted_secrets s
     where s.name = 'resident_reminder_cron_secret'
     limit 1),
    false
  );
$$;
revoke all on function public.resident_reminder_secret_matches(text) from public, anon, authenticated;
grant execute on function public.resident_reminder_secret_matches(text) to service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job
  where jobname = 'resident-assessment-email-delivery'
  order by jobid desc limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;
$$;

select cron.schedule(
  'resident-assessment-email-delivery',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url := 'https://dyiiivcyoatgmkmvgcnt.supabase.co/functions/v1/resident-assessment-notifier',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reminder-secret', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'resident_reminder_cron_secret' limit 1
        )
      ),
      body := '{"action":"deliver_due"}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);
