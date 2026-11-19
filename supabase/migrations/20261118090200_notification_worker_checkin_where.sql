-- Scope the worker check-in to the single control row for PostgREST safe updates.
-- This migration does not resume email or change the cron job.
create or replace function public.rc_notif_worker_checkin(p_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.resident_notification_mail_control%rowtype;
begin
  if p_version is null or char_length(p_version) > 40 then raise exception 'RC_NOTIF_INVALID_INPUT: version'; end if;
  update public.resident_notification_mail_control
    set worker_version = p_version, worker_seen_at = clock_timestamp()
    where id = true
    returning * into v;
  return jsonb_build_object('paused', v.paused, 'version', p_version);
end;
$$;
