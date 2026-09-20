-- Friday MM & Grand Round attendance. Every decision about time and identity
-- is made in Postgres; the browser only displays a short-lived bearer QR.
create table public.resident_round_sessions (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null unique,
  opened_at timestamptz not null,
  opened_by uuid not null references public.resident_profiles(user_id),
  closed_at timestamptz,
  constraint resident_round_friday check (extract(isodow from meeting_date) = 5)
);

create table public.resident_round_qr_tokens (
  session_id uuid not null references public.resident_round_sessions(id) on delete cascade,
  minute_start timestamptz not null,
  token uuid not null default gen_random_uuid() unique,
  primary key (session_id, minute_start)
);

create table public.resident_round_attendance (
  session_id uuid not null references public.resident_round_sessions(id),
  user_id uuid not null references public.resident_profiles(user_id),
  role_at_check_in public.resident_system_role not null,
  checked_in_at timestamptz not null,
  primary key (session_id, user_id)
);
create index resident_round_attendance_user_idx on public.resident_round_attendance(user_id, checked_in_at desc);

alter table public.resident_round_sessions enable row level security;
alter table public.resident_round_qr_tokens enable row level security;
alter table public.resident_round_attendance enable row level security;

grant select on public.resident_round_sessions to authenticated;
grant select on public.resident_round_attendance to authenticated;
-- QR tokens have no table grants or policies. They are exposed only by an
-- Admin-only RPC for the current minute.
revoke all on public.resident_round_qr_tokens from public, anon, authenticated;

create policy resident_round_sessions_admin_select on public.resident_round_sessions
  for select to authenticated using ((select private.resident_role_is('admin')));
create policy resident_round_attendance_select on public.resident_round_attendance
  for select to authenticated using (
    user_id = (select auth.uid()) or (select private.resident_role_is('admin'))
  );

create or replace function private.resident_round_is_open(p_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select extract(isodow from p_at at time zone 'Asia/Bangkok') = 5
    and (p_at at time zone 'Asia/Bangkok')::time < time '11:00:00';
$$;
revoke all on function private.resident_round_is_open(timestamptz) from public, anon, authenticated;

create or replace function private.resident_round_token_is_current(p_minute timestamptz, p_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p_minute = date_trunc('minute', p_at);
$$;
revoke all on function private.resident_round_token_is_current(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.open_resident_round()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_date date := (v_now at time zone 'Asia/Bangkok')::date;
  v_id uuid;
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  if not private.resident_round_is_open(v_now) then raise exception 'Attendance opens on Friday before 11:00 Bangkok time'; end if;
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

create or replace function public.close_resident_round(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  update public.resident_round_sessions set closed_at = clock_timestamp()
  where id = p_session_id and meeting_date = (clock_timestamp() at time zone 'Asia/Bangkok')::date
    and closed_at is null;
  if not found then raise exception 'Current open session not found'; end if;
end;
$$;
revoke all on function public.close_resident_round(uuid) from public, anon;
grant execute on function public.close_resident_round(uuid) to authenticated;

create or replace function public.current_resident_round_qr()
returns table(session_id uuid, token uuid, server_now timestamptz, valid_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_session_id uuid;
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  if not private.resident_round_is_open(v_now) then return; end if;
  select s.id into v_session_id from public.resident_round_sessions s
  where s.meeting_date = (v_now at time zone 'Asia/Bangkok')::date and s.closed_at is null;
  if v_session_id is null then return; end if;
  insert into public.resident_round_qr_tokens(session_id, minute_start)
  values (v_session_id, v_minute) on conflict (session_id, minute_start) do nothing;
  return query select v_session_id, q.token, v_now, v_minute + interval '1 minute'
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
  v_inserted boolean;
  v_role public.resident_system_role;
begin
  select r.role into v_role from public.resident_user_roles r
    join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = auth.uid() and r.active and p.active and r.role in ('resident', 'staff');
  if v_role is null then raise exception 'Active Resident or Staff account required'; end if;
  if not private.resident_round_is_open(v_now) then raise exception 'Attendance is closed'; end if;
  select q.session_id into v_session_id
  from public.resident_round_qr_tokens q
  join public.resident_round_sessions s on s.id = q.session_id
  where q.token = p_token
    and private.resident_round_token_is_current(q.minute_start, v_now)
    and s.meeting_date = (v_now at time zone 'Asia/Bangkok')::date
    and s.closed_at is null;
  if v_session_id is null then raise exception 'QR has expired or is invalid. Scan the current QR again'; end if;
  insert into public.resident_round_attendance(session_id, user_id, role_at_check_in, checked_in_at)
  values (v_session_id, auth.uid(), v_role, v_now)
  on conflict (session_id, user_id) do nothing
  returning public.resident_round_attendance.checked_in_at into v_checked_at;
  v_inserted := found;
  if not v_inserted then
    select a.checked_in_at into v_checked_at from public.resident_round_attendance a
    where a.session_id = v_session_id and a.user_id = auth.uid();
  end if;
  return query select v_session_id, v_checked_at, not v_inserted;
end;
$$;
revoke all on function public.check_in_resident_round(uuid) from public, anon;
grant execute on function public.check_in_resident_round(uuid) to authenticated;
