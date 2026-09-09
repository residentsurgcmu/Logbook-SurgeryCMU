begin;

create extension if not exists pg_cron with schema pg_catalog;

-- Re-applying this migration must not create duplicate jobs.
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job
  where jobname = 'resident-assessment-web-reminders'
  order by jobid desc limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;
$$;

select cron.schedule(
  'resident-assessment-web-reminders',
  '*/15 * * * *',
  $cron$
    insert into public.resident_notifications (
      recipient_id, request_id, notification_type, title, message
    )
    select
      request.staff_id,
      request.id,
      'assessment_reminder',
      'แบบประเมินรอเกิน 24 ชั่วโมง',
      definition.template_code || ' ยังรอการประเมิน'
    from public.resident_assessment_requests request
    join public.resident_template_definitions definition on definition.id = request.template_id
    where request.status = 'pending'
      and request.submitted_at <= now() - interval '24 hours'
    on conflict (request_id, recipient_id, notification_type) do nothing;
  $cron$
);

commit;
