begin;

-- 1) Cancel a pending assessment request.
--    Nothing could set status = 'cancelled', so a request sent to a Staff who
--    was later deactivated blocked that template for the Resident forever
--    ("already has a pending request") and the email worker retried it on every
--    run. The Resident who sent it, or an Admin, may now cancel it. A pending
--    request is always the Resident's latest attempt, so cancelling it leaves
--    no gap in attempt numbers.
create or replace function public.cancel_resident_assessment_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.resident_assessment_requests%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select * into v_request
  from public.resident_assessment_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Assessment request was not found';
  end if;
  if v_request.resident_id <> (select auth.uid())
     and not (select private.resident_role_is('admin')) then
    raise exception 'Only the Resident who sent this request or an Admin can cancel it';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a pending request can be cancelled';
  end if;

  update public.resident_assessment_requests
  set status = 'cancelled'
  where id = p_request_id;

  -- Staff must not be asked to open a request that no longer exists.
  delete from public.resident_notifications
  where request_id = p_request_id
    and notification_type in ('assessment_requested', 'assessment_reminder');
end;
$$;
revoke all on function public.cancel_resident_assessment_request(uuid) from public, anon;
grant execute on function public.cancel_resident_assessment_request(uuid) to authenticated;

-- 2) Claim an email delivery atomically before sending.
--    The worker used to upsert status = 'sending' unconditionally, so the
--    browser's deliver_initial and the cron deliver_due could both send, and a
--    row left in 'sending' (worker killed, or the 'sent' update failed) was
--    re-sent every 15 minutes. A row can now be claimed only when it is new,
--    failed, or stuck in 'sending' for more than 10 minutes. Returns the
--    delivery id, or null when another run owns it or it was already sent.
create or replace function public.claim_resident_assessment_email_delivery(
  p_request_id uuid,
  p_delivery_type text,
  p_recipient_email text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.resident_assessment_email_deliveries as delivery
    (request_id, delivery_type, recipient_email, status, attempted_at, error_message)
  values
    (p_request_id, p_delivery_type, lower(p_recipient_email), 'sending', clock_timestamp(), null)
  on conflict (request_id, delivery_type) do update
    set recipient_email = excluded.recipient_email,
        status = 'sending',
        attempted_at = excluded.attempted_at,
        error_message = null
    where delivery.status = 'failed'
       or (delivery.status = 'sending'
           and delivery.attempted_at < clock_timestamp() - interval '10 minutes')
  returning delivery.id into v_id;
  return v_id;
end;
$$;
revoke all on function public.claim_resident_assessment_email_delivery(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_resident_assessment_email_delivery(uuid, text, text) to service_role;

commit;
