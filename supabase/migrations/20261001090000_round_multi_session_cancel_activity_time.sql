begin;

-- MM & Grand Round, 29-9-69 / 30-9-69 bug notes:
--  1) Admin could not cancel a scheduled session, and a date could hold only
--     one session for ever (meeting_date was UNIQUE and "close" is permanent).
--  2) Reports did not say what time the activity ran.
-- Several sessions per date are now allowed as long as their scan windows do
-- not overlap, a session can be cancelled (kept for history, frees its time),
-- and Admin can record the activity time (e.g. 09:00-12:00) separately from
-- the scan window.

alter table public.resident_round_sessions
  add column if not exists activity_start_time time,
  add column if not exists activity_end_time time,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.resident_profiles(user_id);

alter table public.resident_round_sessions
  drop constraint if exists resident_round_sessions_activity_time_check;
alter table public.resident_round_sessions
  add constraint resident_round_sessions_activity_time_check check (
    (activity_start_time is null) = (activity_end_time is null)
    and (activity_start_time is null or activity_end_time > activity_start_time)
  );

-- One session per date is no longer a rule. (Default name of the inline UNIQUE.)
alter table public.resident_round_sessions
  drop constraint if exists resident_round_sessions_meeting_date_key;
-- Fail loudly (and roll the whole migration back) if the constraint had a
-- different name and a unique rule on meeting_date is still in place.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.resident_round_sessions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(meeting_date)%'
  ) then
    raise exception 'A unique constraint on meeting_date still exists; drop it by its real name and re-run';
  end if;
end;
$$;
create index if not exists resident_round_sessions_meeting_date_idx
  on public.resident_round_sessions(meeting_date, starts_at);

-- Two live sessions with overlapping windows would hide one QR
-- (current_resident_round_qr returns a single session), so reject overlap.
-- Closed and cancelled sessions no longer accept scans and are ignored.
create or replace function private.prevent_overlapping_resident_round_sessions()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.cancelled_at is not null or new.closed_at is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('resident_round_sessions_overlap'));
  if exists (
    select 1 from public.resident_round_sessions o
    where o.id <> new.id
      and o.cancelled_at is null and o.closed_at is null
      and o.starts_at < new.ends_at and o.ends_at > new.starts_at
  ) then
    raise exception 'Another scan window overlaps this time. Choose a different time or cancel the other session';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_overlapping_resident_round_sessions() from public, anon, authenticated;

drop trigger if exists resident_round_sessions_prevent_overlap on public.resident_round_sessions;
create trigger resident_round_sessions_prevent_overlap
  before insert or update of starts_at, ends_at, closed_at, cancelled_at on public.resident_round_sessions
  for each row execute function private.prevent_overlapping_resident_round_sessions();

-- Replace the schedule RPCs; drop the old signatures so PostgREST sees one.
drop function if exists public.open_resident_round(date, time, time);
drop function if exists public.update_resident_round_session(uuid, date, time, time);

create or replace function public.open_resident_round(
  p_meeting_date date,
  p_start_time time,
  p_end_time time,
  p_activity_start time default null,
  p_activity_end time default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  if p_meeting_date is null or p_start_time is null or p_end_time is null then
    raise exception 'Meeting date, start time, and end time are required';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'End time must be after start time';
  end if;
  if (p_activity_start is null) <> (p_activity_end is null) then
    raise exception 'Activity start and end time must be given together';
  end if;
  if p_activity_start is not null and p_activity_end <= p_activity_start then
    raise exception 'Activity end time must be after start time';
  end if;
  insert into public.resident_round_sessions(
    meeting_date, starts_at, ends_at, activity_start_time, activity_end_time, opened_at, opened_by
  ) values (
    p_meeting_date,
    (p_meeting_date::text || ' ' || p_start_time::text || '+07:00')::timestamptz,
    (p_meeting_date::text || ' ' || p_end_time::text || '+07:00')::timestamptz,
    p_activity_start, p_activity_end, clock_timestamp(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.open_resident_round(date, time, time, time, time) from public, anon;
grant execute on function public.open_resident_round(date, time, time, time, time) to authenticated;

create or replace function public.update_resident_round_session(
  p_session_id uuid,
  p_meeting_date date,
  p_start_time time,
  p_end_time time,
  p_activity_start time default null,
  p_activity_end time default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  if p_session_id is null or p_meeting_date is null or p_start_time is null or p_end_time is null then
    raise exception 'Session, meeting date, start time, and end time are required';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'End time must be after start time';
  end if;
  if (p_activity_start is null) <> (p_activity_end is null) then
    raise exception 'Activity start and end time must be given together';
  end if;
  if p_activity_start is not null and p_activity_end <= p_activity_start then
    raise exception 'Activity end time must be after start time';
  end if;
  update public.resident_round_sessions
  set meeting_date = p_meeting_date,
      starts_at = (p_meeting_date::text || ' ' || p_start_time::text || '+07:00')::timestamptz,
      ends_at = (p_meeting_date::text || ' ' || p_end_time::text || '+07:00')::timestamptz,
      activity_start_time = p_activity_start,
      activity_end_time = p_activity_end
  where id = p_session_id and closed_at is null and cancelled_at is null;
  if not found then
    raise exception 'Only a session that has not closed yet can be edited';
  end if;
end;
$$;
revoke all on function public.update_resident_round_session(uuid, date, time, time, time, time) from public, anon;
grant execute on function public.update_resident_round_session(uuid, date, time, time, time, time) to authenticated;

-- Cancel a session that nobody has checked in to (test runs, wrong date).
-- It is kept for history, stops scanning at once and no longer holds its time.
create or replace function public.cancel_resident_round_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  if exists (select 1 from public.resident_round_attendance a where a.session_id = p_session_id) then
    raise exception 'Cannot cancel a session that already has attendance. Close it instead';
  end if;
  update public.resident_round_sessions
  set cancelled_at = clock_timestamp(),
      cancelled_by = auth.uid(),
      closed_at = coalesce(closed_at, clock_timestamp())
  where id = p_session_id and cancelled_at is null;
  if not found then raise exception 'Session not found or already cancelled'; end if;
end;
$$;
revoke all on function public.cancel_resident_round_session(uuid) from public, anon;
grant execute on function public.cancel_resident_round_session(uuid) to authenticated;

commit;
