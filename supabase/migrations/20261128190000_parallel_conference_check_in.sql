-- The main rounds and the single named conference room have independent scan windows.
create or replace function private.prevent_overlapping_resident_round_sessions()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.cancelled_at is not null or new.closed_at is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('resident_round_sessions_overlap'));
  if exists (
    select 1 from public.resident_round_sessions o
    where o.id <> new.id
      and (o.conference_name is null) = (new.conference_name is null)
      and o.cancelled_at is null and o.closed_at is null
      and o.starts_at < new.ends_at and o.ends_at > new.starts_at
  ) then
    raise exception 'Another scan window overlaps this time. Choose a different time or cancel the other session';
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from public.resident_round_attendance here
    join public.resident_round_attendance other on other.user_id = here.user_id and other.session_id <> here.session_id
    join public.resident_round_sessions s on s.id = other.session_id and s.cancelled_at is null
    where here.session_id = new.id
      and greatest(new.starts_at, here.checked_in_at, s.starts_at, other.checked_in_at)
        < least(new.ends_at, s.ends_at, coalesce(s.closed_at, s.ends_at))
  ) then raise exception 'ROUND_ALREADY_IN_CONFERENCE'; end if;
  return new;
end;
$$;

-- Insert the named round already classified, so the overlap trigger uses the right schedule.
create or replace function public.admin_save_named_round_conference(
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
    if p_meeting_date is null or p_start_time is null or p_end_time is null then
      raise exception 'Meeting date, start time, and end time are required';
    end if;
    if p_end_time <= p_start_time then raise exception 'End time must be after start time'; end if;
    if (p_activity_start is null) <> (p_activity_end is null) then
      raise exception 'Activity start and end time must be given together';
    end if;
    if p_activity_start is not null and p_activity_end <= p_activity_start then
      raise exception 'Activity end time must be after start time';
    end if;
    insert into public.resident_round_sessions (
      conference_name, meeting_date, starts_at, ends_at, activity_start_time, activity_end_time, opened_at, opened_by
    ) values (
      v_name, p_meeting_date,
      (p_meeting_date + p_start_time) at time zone 'Asia/Bangkok',
      (p_meeting_date + p_end_time) at time zone 'Asia/Bangkok',
      p_activity_start, p_activity_end, clock_timestamp(), auth.uid()
    ) returning id into v_session;
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

-- The older single-QR endpoint remains available; the admin page can now show
-- each live session's independent token. The scan endpoint already resolves by token.
create function public.admin_list_current_resident_round_qrs()
returns table(session_id uuid, token uuid, server_now timestamptz, valid_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_session record;
begin
  if not (select private.resident_role_is('admin')) then raise exception 'Active Admin account required'; end if;
  for v_session in
    select s.id, s.ends_at from public.resident_round_sessions s
    where s.cancelled_at is null and s.closed_at is null and v_now >= s.starts_at and v_now < s.ends_at
    order by s.id
  loop
    perform private.claim_resident_round_qr_token(v_session.id, v_minute);
    return query select q.session_id, q.token, v_now, least(v_minute + interval '1 minute', v_session.ends_at)
    from public.resident_round_qr_tokens q
    where q.session_id = v_session.id and q.minute_start = v_minute;
  end loop;
end;
$$;
revoke all on function public.admin_list_current_resident_round_qrs() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_current_resident_round_qrs() to authenticated;

-- Serialize membership by account, including QR and Admin corrections.
create function private.guard_single_round_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_current public.resident_round_sessions%rowtype;
begin
  perform pg_advisory_xact_lock_shared(hashtext('resident_round_sessions_overlap'));
  perform pg_advisory_xact_lock(hashtextextended('round-membership:' || new.user_id::text, 0));
  select * into v_current from public.resident_round_sessions where id = new.session_id;
  if exists (
    select 1 from public.resident_round_attendance a
    join public.resident_round_sessions s on s.id = a.session_id
    where a.user_id = new.user_id and a.session_id <> new.session_id
      and s.cancelled_at is null
      and greatest(s.starts_at, a.checked_in_at, v_current.starts_at, new.checked_in_at)
        < least(s.ends_at, coalesce(s.closed_at, s.ends_at),
                v_current.ends_at, coalesce(v_current.closed_at, v_current.ends_at))
  ) then raise exception 'ROUND_ALREADY_IN_CONFERENCE'; end if;
  return new;
end;
$$;
revoke all on function private.guard_single_round_membership() from public, anon, authenticated, service_role;
create trigger resident_round_one_membership
  before insert on public.resident_round_attendance
  for each row execute function private.guard_single_round_membership();

create function public.my_current_resident_conference()
returns table(session_id uuid, conference_name text, effective_end timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, coalesce(s.conference_name, 'MM & Grand Round'), s.ends_at
  from public.resident_round_attendance a join public.resident_round_sessions s on s.id = a.session_id
  where a.user_id = (select auth.uid()) and (select private.resident_account_active())
    and s.cancelled_at is null and s.closed_at is null and s.starts_at <= now() and s.ends_at > now()
  order by a.checked_in_at desc limit 1;
$$;
revoke all on function public.my_current_resident_conference() from public, anon, authenticated, service_role;
grant execute on function public.my_current_resident_conference() to authenticated;
