-- MM & Grand Round does not follow a fixed weekly schedule. An active Admin
-- decides whether to open attendance on the meeting day; the existing unique
-- meeting_date constraint still limits the system to one session per day.
alter table public.resident_round_sessions
  drop constraint if exists resident_round_friday;

create or replace function private.resident_round_is_open(p_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select (p_at at time zone 'Asia/Bangkok')::time < time '11:00:00';
$$;
revoke all on function private.resident_round_is_open(timestamptz) from public, anon, authenticated;

create or replace function public.open_resident_round()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_date date := (v_now at time zone 'Asia/Bangkok')::date;
  v_id uuid;
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  if not private.resident_round_is_open(v_now) then raise exception 'Attendance can be opened by Admin before 11:00 Bangkok time'; end if;
  insert into public.resident_round_sessions(meeting_date, opened_at, opened_by)
  values (v_date, v_now, auth.uid())
  on conflict (meeting_date) do nothing;
  select id into v_id from public.resident_round_sessions where meeting_date = v_date;
  if exists (select 1 from public.resident_round_sessions where id = v_id and closed_at is not null) then
    raise exception 'This session is already closed';
  end if;
  return v_id;
end;
$$;
revoke all on function public.open_resident_round() from public, anon;
grant execute on function public.open_resident_round() to authenticated;
