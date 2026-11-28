alter table public.resident_round_sessions
  add column conference_name text check (
    conference_name is null or char_length(btrim(conference_name)) between 1 and 120
  );

-- Reuse the existing date, timing and overlap checks. A round, its name and
-- its layout are committed together. No new layout or QR token format.
create function public.admin_save_named_round_conference(
  p_session_id uuid, p_conference_name text, p_room_key text,
  p_meeting_date date, p_start_time time, p_end_time time,
  p_activity_start time, p_activity_end time
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid := p_session_id;
  v_name text := btrim(p_conference_name);
  v_layout uuid;
  v_cutoff timestamptz;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 120 then
    raise exception 'Conference name must be 1 to 120 characters';
  end if;
  if p_room_key is distinct from 'opportunity-order' then raise exception 'Layout not found'; end if;
  select id into v_layout from public.resident_room_layouts
    where active and name = 'ห้องประชุมจริง · 64 ที่ (2569-10)';
  if not found then raise exception 'Layout not found'; end if;

  if v_session is null then
    v_session := public.schedule_resident_round(
      p_meeting_date, p_start_time, p_end_time, p_activity_start, p_activity_end, false
    );
    v_cutoff := greatest(
      (p_meeting_date + p_start_time) at time zone 'Asia/Bangkok',
      least((p_meeting_date + coalesce(p_activity_start, p_start_time)) at time zone 'Asia/Bangkok',
            (p_meeting_date + p_end_time) at time zone 'Asia/Bangkok')
    );
    perform public.admin_configure_seat_session(v_session, v_layout, v_cutoff);
  else
    perform 1 from public.resident_round_sessions
      where id = v_session and conference_name is not null
      for update;
    if not found then raise exception 'Named conference not found'; end if;
    perform public.reschedule_resident_round(
      v_session, p_meeting_date, p_start_time, p_end_time, p_activity_start, p_activity_end, true
    );
  end if;
  update public.resident_round_sessions set conference_name = v_name where id = v_session;
  return v_session;
end;
$$;
revoke all on function public.admin_save_named_round_conference(uuid,text,text,date,time,time,time,time) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_named_round_conference(uuid,text,text,date,time,time,time,time) to authenticated;
