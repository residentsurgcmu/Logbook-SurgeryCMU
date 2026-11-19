-- Use only after the verified runtime drain in the runbook. 'Uncertain' means
-- outcome unknown; changing a ledger row does not terminate an invocation.
begin;
select id from public.resident_notification_mail_control where id for update;
do $$ begin
  if not exists (select 1 from public.resident_notification_mail_control
                   where id and paused and clock_timestamp() >= paused_at + interval '10 minutes') then
    raise exception 'DRAIN REFUSED: pause and wait for the runbook drain first';
  end if;
end $$;
-- Lock delivery rows before their attempts (same order as finish).
select id from public.resident_assessment_email_deliveries where status = 'sending' order by id for update;
update public.resident_assessment_email_attempts
   set status = 'uncertain', finished_at = clock_timestamp(), error_message = 'abandoned during release drain'
 where status = 'authorized' and authorized_at <= clock_timestamp() - interval '10 minutes';
update public.resident_assessment_email_deliveries d
   set status = case when reservation_v3 and not exists (
                        select 1 from public.resident_assessment_email_attempts a
                         where a.delivery_id = d.id and a.status = 'uncertain') then 'failed' else 'uncertain' end,
       error_message = case when reservation_v3 and not exists (
                        select 1 from public.resident_assessment_email_attempts a
                         where a.delivery_id = d.id and a.status = 'uncertain') then 'reservation released by pause before authorization'
                        else 'abandoned during release drain' end
 where status = 'sending' and attempted_at <= clock_timestamp() - interval '10 minutes'
   and not exists (select 1 from public.resident_assessment_email_attempts a where a.delivery_id = d.id and a.status = 'authorized');
select (select count(*) from public.resident_assessment_email_deliveries where status = 'sending') as open_reservations,
       (select count(*) from public.resident_assessment_email_attempts where status = 'authorized') as open_attempts;
commit;
