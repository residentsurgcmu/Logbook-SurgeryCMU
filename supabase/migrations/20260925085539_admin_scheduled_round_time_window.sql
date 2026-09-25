-- Let Admin schedule MM & Grand Round attendance for any date, with an
-- explicit start and end time for QR scanning, instead of the previous
-- fixed rule (open only "today", scanning always cuts off at 11:00
-- Bangkok time). The system now opens and closes scanning automatically
-- based on each session's own starts_at/ends_at window.

alter table public.resident_round_sessions
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz;

-- Backfill existing rows so the columns can become NOT NULL: assume the
-- old fixed window (opened_at .. that day's 11:00 Bangkok cutoff), widened
-- if needed so ends_at is always after starts_at.
update public.resident_round_sessions
set starts_at = coalesce(starts_at, opened_at),
    ends_at = coalesce(ends_at, greatest(
      (meeting_date::text || ' 11:00+07:00')::timestamptz,
      opened_at + interval '1 minute'
    ))
where starts_at is null or ends_at is null;

alter table public.resident_round_sessions
  alter column starts_at set not null,
  alter column ends_at set not null;

alter table public.resident_round_sessions
  drop constraint if exists resident_round_sessions_window_check;
alter table public.resident_round_sessions
  add constraint resident_round_sessions_window_check check (ends_at > starts_at);

-- Replace the old no-argument open with an explicit schedule call.
drop function if exists public.open_resident_round();

create or replace function public.open_resident_round(
  p_meeting_date date,
  p_start_time time,
  p_end_time time
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_id uuid;
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  if p_meeting_date is null or p_start_time is null or p_end_time is null then
    raise exception 'Meeting date, start time, and end time are required';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'End time must be after start time';
  end if;
  v_starts_at := (p_meeting_date::text || ' ' || p_start_time::text || '+07:00')::timestamptz;
  v_ends_at := (p_meeting_date::text || ' ' || p_end_time::text || '+07:00')::timestamptz;
  insert into public.resident_round_sessions(meeting_date, starts_at, ends_at, opened_at, opened_by)
  values (p_meeting_date, v_starts_at, v_ends_at, clock_timestamp(), auth.uid())
  on conflict (meeting_date) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'A session for this date already exists. Edit the existing session instead.';
  end if;
  return v_id;
end;
$$;
revoke all on function public.open_resident_round(date, time, time) from public, anon;
grant execute on function public.open_resident_round(date, time, time) to authenticated;

-- New: let Admin edit the date/time window of a session that hasn't closed.
create or replace function public.update_resident_round_session(
  p_session_id uuid,
  p_meeting_date date,
  p_start_time time,
  p_end_time time
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  if p_session_id is null or p_meeting_date is null or p_start_time is null or p_end_time is null then
    raise exception 'Session, meeting date, start time, and end time are required';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'End time must be after start time';
  end if;
  if not exists (
    select 1 from public.resident_round_sessions where id = p_session_id and closed_at is null
  ) then
    raise exception 'Only a session that has not closed yet can be edited';
  end if;
  v_starts_at := (p_meeting_date::text || ' ' || p_start_time::text || '+07:00')::timestamptz;
  v_ends_at := (p_meeting_date::text || ' ' || p_end_time::text || '+07:00')::timestamptz;
  update public.resident_round_sessions
  set meeting_date = p_meeting_date, starts_at = v_starts_at, ends_at = v_ends_at
  where id = p_session_id;
exception
  when unique_violation then
    raise exception 'A session for this date already exists';
end;
$$;
revoke all on function public.update_resident_round_session(uuid, date, time, time) from public, anon;
grant execute on function public.update_resident_round_session(uuid, date, time, time) to authenticated;

-- Manual early close no longer requires the session to be "today's".
create or replace function public.close_resident_round(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  update public.resident_round_sessions set closed_at = clock_timestamp()
  where id = p_session_id and closed_at is null;
  if not found then raise exception 'Open session not found'; end if;
end;
$$;
revoke all on function public.close_resident_round(uuid) from public, anon;
grant execute on function public.close_resident_round(uuid) to authenticated;

-- QR issuance now follows each session's own starts_at/ends_at window
-- instead of a fixed day-of-week + 11:00 cutoff rule.
create or replace function public.current_resident_round_qr()
returns table(session_id uuid, token uuid, server_now timestamptz, valid_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_session_id uuid;
  v_ends_at timestamptz;
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  select s.id, s.ends_at into v_session_id, v_ends_at
  from public.resident_round_sessions s
  where s.closed_at is null and v_now >= s.starts_at and v_now <= s.ends_at
  order by s.starts_at desc
  limit 1;
  if v_session_id is null then return; end if;
  perform private.claim_resident_round_qr_token(v_session_id, v_minute);
  return query select v_session_id, q.token, v_now, least(v_minute + interval '1 minute', v_ends_at)
  from public.resident_round_qr_tokens q
  where q.session_id = v_session_id and q.minute_start = v_minute;
end;
$$;
revoke all on function public.current_resident_round_qr() from public, anon;
grant execute on function public.current_resident_round_qr() to authenticated;

create or replace function public.check_in_resident_round(p_token uuid)
returns table(session_id uuid, checked_in_at timestamptz, already_checked_in boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session_id uuid;
  v_checked_at timestamptz;
  v_already boolean;
  v_role public.resident_system_role;
begin
  select r.role into v_role from public.resident_user_roles r
    join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = auth.uid() and r.active and p.active and r.role in ('resident', 'staff');
  if v_role is null then raise exception 'Active Resident or Staff account required'; end if;
  select q.session_id into v_session_id
  from public.resident_round_qr_tokens q
  join public.resident_round_sessions s on s.id = q.session_id
  where q.token = p_token
    and private.resident_round_token_is_current(q.minute_start, v_now)
    and s.closed_at is null
    and v_now >= s.starts_at and v_now <= s.ends_at;
  if v_session_id is null then raise exception 'QR has expired or is invalid. Scan the current QR again'; end if;
  select o_checked_in_at, o_already_checked_in
  into v_checked_at, v_already
  from private.record_resident_round_check_in(v_session_id, auth.uid(), v_role, v_now);
  return query select v_session_id, v_checked_at, v_already;
end;
$$;
revoke all on function public.check_in_resident_round(uuid) from public, anon;
grant execute on function public.check_in_resident_round(uuid) to authenticated;

-- The old fixed-cutoff rule is no longer called from anywhere.
drop function if exists private.resident_round_is_open(timestamptz);
