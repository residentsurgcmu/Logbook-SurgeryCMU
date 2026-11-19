-- RC-NOTIF-V1: RESUME e-mail. Refuses unless ALL hold (nothing changes otherwise):
--  a) the legacy claim is retired (old workers cannot send);
--  b) the v1 worker checked in AFTER the pause: call deliver_due once (it does nothing while paused) — e.g. wait
--     invoke and verify both live paths per runbook; SQL only checks the latest check-in;
--  c) drain is complete: no open reservation, no open attempt.
begin;
do $$
declare c public.resident_notification_mail_control%rowtype;
begin
  select * into c from public.resident_notification_mail_control where id for update;
  if c.paused is distinct from true or clock_timestamp() < c.paused_at + interval '10 minutes' then
    raise exception 'RESUME REFUSED: pause and wait for the runbook drain first'; end if;
  if (select count(*) from cron.job where jobname = 'resident-assessment-email-delivery' and not active) <> 1
     or (select count(*) from cron.job where jobname = 'resident-assessment-email-delivery') <> 1 then
    raise exception 'RESUME REFUSED: expected exactly one inactive e-mail cron job'; end if;
  if pg_get_functiondef('public.claim_resident_assessment_email_delivery(uuid,text,text)'::regprocedure) !~ 'RC_NOTIF_LEGACY_CLAIM_RETIRED' then
    raise exception 'RESUME REFUSED: the legacy claim is not retired'; end if;
  if c.worker_version is distinct from 'rc-notif-v1-impl-v3' or c.worker_seen_at is null or c.worker_seen_at < c.paused_at + interval '10 minutes'
     or c.worker_seen_at < clock_timestamp() - interval '5 minutes' then
    raise exception 'RESUME REFUSED: no check-in of worker rc-notif-v1-impl-v3 after the drain (last: %, at %)', c.worker_version, c.worker_seen_at; end if;
  if exists (select 1 from public.resident_assessment_email_deliveries where status = 'sending')
     or exists (select 1 from public.resident_assessment_email_attempts where status = 'authorized') then
    raise exception 'RESUME REFUSED: open reservations or attempts remain (drain first)'; end if;
  update public.resident_notification_mail_control set paused = false, reason = 'resumed by owner' where id;
end $$;
select cron.alter_job((select jobid from cron.job where jobname = 'resident-assessment-email-delivery'), active := true);
commit;
select (select active from cron.job where jobname = 'resident-assessment-email-delivery') as cron_job_active,
       (select paused from public.resident_notification_mail_control) as mail_paused;
