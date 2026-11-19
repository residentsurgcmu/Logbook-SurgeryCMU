-- RC-NOTIF-V1 (v2, I01): retry web notifications whose decision could not be made (platform-only: pg_cron).
-- Every 15 minutes, like the existing reminder job. Re-applying does not create a duplicate job.
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'resident-notification-web-retry' order by jobid desc limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;
$$;

select cron.schedule(
  'resident-notification-web-retry',
  '*/15 * * * *',
  $cron$ select public.rc_notif_retry_pending_web(200); $cron$
);
