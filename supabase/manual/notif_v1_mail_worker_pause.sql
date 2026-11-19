-- After migration: close cron AND browser admission. Before migration only use
-- the cron stop statement documented in the release runbook, not this file.
begin;
select id from public.resident_notification_mail_control where id for update;
update public.resident_notification_mail_control
   set paused = true, paused_at = clock_timestamp(), reason = 'paused by owner',
       worker_version = null, worker_seen_at = null
 where id;
do $$ begin
  if (select count(*) from cron.job where jobname = 'resident-assessment-email-delivery') <> 1 then
    raise exception 'PAUSE REFUSED: expected exactly one e-mail cron job';
  end if;
end $$;
select cron.alter_job((select jobid from cron.job where jobname = 'resident-assessment-email-delivery'), active := false);
commit;
select (select active from cron.job where jobname = 'resident-assessment-email-delivery') as cron_job_active,
       paused as mail_paused, paused_at,
       (select count(*) from public.resident_assessment_email_deliveries where status = 'sending') as open_reservations,
       (select count(*) from public.resident_assessment_email_attempts where status = 'authorized') as open_attempts
from public.resident_notification_mail_control where id;
