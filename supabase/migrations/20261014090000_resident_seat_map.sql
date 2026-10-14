-- Seat map for the MM & Grand Round meeting (release piece S1-DB). Additive only: nothing existing is changed.
--   * resident_room_layouts / resident_room_seats: the room as DATA (zone, row, column). Seed = the 37-seat Friday room.
--   * resident_round_seat_config: turns the seat map on for ONE session (layout + the "on time" clock time).
--     A session without a row has no seat map and behaves exactly as before. Room opens at the session's starts_at,
--     seats are released at its ends_at (or earlier if an Admin closes the round).
--   * resident_seat_assignments / holds / status / requests / events: who sits where, 60 s holds, reserve area,
--     urgent-duty + correction requests, and an append-only log keyed to the PERSON (the seat is recorded as it was then).
--   * Every write goes through a SECURITY DEFINER function below; no table can be written directly.
--   * Attendance evidence is the existing QR check-in (resident_round_attendance); this file never touches it.
-- Safe to run again.

create table if not exists public.resident_room_layouts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.resident_room_seats (
  layout_id uuid not null references public.resident_room_layouts(id) on delete cascade,
  seat_code text not null check (seat_code ~ '^[MLCR][0-9]{1,2}$'),
  zone text not null check (zone in ('M', 'L', 'C', 'R')),
  row_no smallint not null check (row_no between 1 and 20),
  col_no smallint not null check (col_no between 1 and 20),
  primary key (layout_id, seat_code),
  check (left(seat_code, 1) = zone)
);

insert into public.resident_room_layouts(name) values ('ห้องประชุมวันศุกร์ (37 ที่)') on conflict (name) do nothing;

-- Front of the room is the top; left/right as seen from the back of the room. Central table: odd codes left, even codes right.
insert into public.resident_room_seats(layout_id, seat_code, zone, row_no, col_no)
select l.id, v.seat_code, v.zone, v.row_no, v.col_no
from public.resident_room_layouts l,
lateral (
  select 'M1'::text as seat_code, 'M'::text as zone, 1 as row_no, 1 as col_no
  union all select 'L' || n, 'L', ((n - 1) / 3) + 1, ((n - 1) % 3) + 1 from generate_series(1, 12) n
  union all select 'C' || n, 'C', (n + 1) / 2, case when n % 2 = 1 then 1 else 2 end from generate_series(1, 12) n
  union all select 'R' || n, 'R', ((n - 1) / 3) + 1, ((n - 1) % 3) + 1 from generate_series(1, 12) n
) v
where l.name = 'ห้องประชุมวันศุกร์ (37 ที่)'
on conflict (layout_id, seat_code) do nothing;

create table if not exists public.resident_round_seat_config (
  session_id uuid primary key references public.resident_round_sessions(id) on delete cascade,
  layout_id uuid not null references public.resident_room_layouts(id),
  on_time_at timestamptz not null,
  created_by uuid not null references public.resident_profiles(user_id),
  created_at timestamptz not null default now()
);

create table if not exists public.resident_seat_assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.resident_round_sessions(id) on delete cascade,
  user_id uuid not null references public.resident_profiles(user_id),
  seat_code text not null check (seat_code ~ '^[MLCR][0-9]{1,2}$'),
  seated_at timestamptz not null,
  released_at timestamptz,
  release_reason text check (release_reason in ('self', 'moved', 'staff', 'reserve', 'urgent')),
  assigned_by uuid not null references public.resident_profiles(user_id),
  check ((released_at is null) = (release_reason is null))
);
-- One seat per person and one person per seat, enforced by the database whatever the functions do.
create unique index if not exists resident_seat_assignments_one_seat_per_user
  on public.resident_seat_assignments (session_id, user_id) where released_at is null;
create unique index if not exists resident_seat_assignments_one_user_per_seat
  on public.resident_seat_assignments (session_id, seat_code) where released_at is null;

create table if not exists public.resident_seat_holds (
  session_id uuid not null references public.resident_round_sessions(id) on delete cascade,
  seat_code text not null check (seat_code ~ '^[MLCR][0-9]{1,2}$'),
  user_id uuid not null references public.resident_profiles(user_id),
  expires_at timestamptz not null,
  primary key (session_id, seat_code),
  unique (session_id, user_id)
);

create table if not exists public.resident_seat_status (
  session_id uuid not null references public.resident_round_sessions(id) on delete cascade,
  user_id uuid not null references public.resident_profiles(user_id),
  status text not null check (status in ('reserve')),
  since timestamptz not null default clock_timestamp(),
  primary key (session_id, user_id)
);

create table if not exists public.resident_seat_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.resident_round_sessions(id) on delete cascade,
  user_id uuid not null references public.resident_profiles(user_id),
  kind text not null check (kind in ('urgent', 'correction')),
  reason text,
  note text,
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid references public.resident_profiles(user_id),
  reviewed_at timestamptz,
  check (
    (kind = 'urgent' and reason in ('ผ่าตัด', 'ผู้ป่วยฉุกเฉิน', 'อยู่เวร', 'อื่น ๆ') and (note is null or char_length(note) <= 160))
    or (kind = 'correction' and reason is null and note is not null and char_length(note) between 1 and 200)
  ),
  check ((state = 'pending') = (reviewed_by is null and reviewed_at is null))
);
create unique index if not exists resident_seat_requests_one_pending_urgent
  on public.resident_seat_requests (session_id, user_id) where kind = 'urgent' and state = 'pending';
create unique index if not exists resident_seat_requests_one_pending_correction
  on public.resident_seat_requests (session_id, user_id) where kind = 'correction' and state = 'pending';

create table if not exists public.resident_seat_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.resident_round_sessions(id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references public.resident_profiles(user_id),
  subject_id uuid references public.resident_profiles(user_id),
  kind text not null check (kind in ('hold', 'confirm', 'release', 'move', 'reserve', 'urgent', 'correction', 'staff_set', 'staff_release', 'certify', 'review', 'configure')),
  seat_code text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists resident_seat_events_session_idx on public.resident_seat_events (session_id, at, id);

alter table public.resident_room_layouts enable row level security;
alter table public.resident_room_seats enable row level security;
alter table public.resident_round_seat_config enable row level security;
alter table public.resident_seat_assignments enable row level security;
alter table public.resident_seat_holds enable row level security;
alter table public.resident_seat_status enable row level security;
alter table public.resident_seat_requests enable row level security;
alter table public.resident_seat_events enable row level security;

revoke all on table public.resident_room_layouts, public.resident_room_seats, public.resident_round_seat_config,
  public.resident_seat_assignments, public.resident_seat_holds, public.resident_seat_status,
  public.resident_seat_requests, public.resident_seat_events from public, anon, authenticated;
grant select on table public.resident_room_layouts, public.resident_room_seats to authenticated;
drop policy if exists resident_room_layouts_select on public.resident_room_layouts;
create policy resident_room_layouts_select on public.resident_room_layouts for select to authenticated using (true);
drop policy if exists resident_room_seats_select on public.resident_room_seats;
create policy resident_room_seats_select on public.resident_room_seats for select to authenticated using (true);

-- ---------- internal helpers (callable only from the SECURITY DEFINER functions below) ----------

-- The caller, when an active account with an active profile.
create or replace function private.resident_seat_actor()
returns table (user_id uuid, role public.resident_system_role)
language sql stable security definer set search_path = public, auth as $$
  select r.user_id, r.role
  from public.resident_user_roles r
  join public.resident_profiles p on p.user_id = r.user_id
  where r.user_id = (select auth.uid()) and r.active and p.active
$$;
revoke all on function private.resident_seat_actor() from public, anon, authenticated;

-- False when the text hides a run of 6+ digits (Latin or Thai), even split by spaces, dots or hyphens: an HN-like number.
create or replace function private.resident_seat_text_ok(p_text text)
returns boolean language sql immutable set search_path = '' as $$
  select p_text is null or regexp_replace(p_text, '[[:space:].-]', '', 'g') !~ '[0-9๐-๙]{6,}'
$$;
revoke all on function private.resident_seat_text_ok(text) from public, anon, authenticated;

create or replace function private.resident_seat_session(p_session_id uuid)
returns table (session_id uuid, layout_id uuid, starts_at timestamptz, ends_at timestamptz,
               effective_end timestamptz, report_until timestamptz, on_time_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, c.layout_id, s.starts_at, s.ends_at,
         least(s.ends_at, coalesce(s.closed_at, s.ends_at)),
         s.ends_at + interval '48 hours', c.on_time_at
  from public.resident_round_sessions s
  join public.resident_round_seat_config c on c.session_id = s.id
  where s.id = p_session_id and s.cancelled_at is null
$$;
revoke all on function private.resident_seat_session(uuid) from public, anon, authenticated;

-- One entry point for every seat function: who is calling, which session, and is the phase open.
--   'live'   = from starts_at to the effective end (ends_at, or earlier if an Admin closed the round)
--   'report' = from starts_at to ends_at + 48 h (urgent-duty reports and correction requests)
--   'read'   = anyone from starts_at - 1 h to ends_at + 48 h; an Admin at any time
create or replace function private.resident_seat_context(p_session_id uuid, p_phase text)
returns table (user_id uuid, role public.resident_system_role, layout_id uuid, starts_at timestamptz, ends_at timestamptz,
               effective_end timestamptz, report_until timestamptz, on_time_at timestamptz, now_ts timestamptz)
language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  v_a record;
  v_s record;
  v_now timestamptz := clock_timestamp();
begin
  select a.user_id, a.role into v_a from private.resident_seat_actor() a;
  if v_a.user_id is null then raise exception 'Active account required'; end if;
  select * into v_s from private.resident_seat_session(p_session_id);
  if v_s.session_id is null then raise exception 'Seat map is not open for this session'; end if;
  if p_phase = 'live' and (v_now < v_s.starts_at or v_now > v_s.effective_end) then raise exception 'Seat map is closed'; end if;
  if p_phase = 'report' and (v_now < v_s.starts_at or v_now > v_s.report_until) then raise exception 'Seat map is closed'; end if;
  if p_phase = 'read' and v_a.role <> 'admin' and (v_now < v_s.starts_at - interval '1 hour' or v_now > v_s.report_until) then raise exception 'Seat map is closed'; end if;
  return query select v_a.user_id, v_a.role, v_s.layout_id, v_s.starts_at, v_s.ends_at, v_s.effective_end, v_s.report_until, v_s.on_time_at, v_now;
end;
$$;
revoke all on function private.resident_seat_context(uuid, text) from public, anon, authenticated;

create or replace function private.resident_seat_log(p_session_id uuid, p_actor uuid, p_subject uuid, p_kind text, p_seat text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.resident_seat_events(session_id, actor_id, subject_id, kind, seat_code, detail)
  values (p_session_id, p_actor, p_subject, p_kind, p_seat, coalesce(p_detail, '{}'::jsonb))
$$;
revoke all on function private.resident_seat_log(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- Named capabilities (notes section 10): move one of these to another role later without touching the functions.
create or replace function private.resident_can_manage_seat_map(p_session_id uuid)
returns boolean language sql stable security definer set search_path = public, private, auth as $$
  select exists (select 1 from private.resident_seat_actor() a where a.role = 'admin')
      or exists (
        select 1 from private.resident_seat_actor() a
        join public.resident_round_attendance t on t.user_id = a.user_id and t.session_id = p_session_id
        where a.role = 'staff')
$$;
revoke all on function private.resident_can_manage_seat_map(uuid) from public, anon;
grant execute on function private.resident_can_manage_seat_map(uuid) to authenticated;

create or replace function private.resident_can_configure_seat_map()
returns boolean language sql stable security definer set search_path = public, private, auth as $$
  select private.resident_role_is('admin')
$$;
revoke all on function private.resident_can_configure_seat_map() from public, anon;
grant execute on function private.resident_can_configure_seat_map() to authenticated;

create or replace function private.resident_can_view_seat_report()
returns boolean language sql stable security definer set search_path = public, private, auth as $$
  select private.resident_role_is('admin')
$$;
revoke all on function private.resident_can_view_seat_report() from public, anon;
grant execute on function private.resident_can_view_seat_report() to authenticated;

-- ---------- Resident functions ----------

-- Take a seat in two steps: hold it for 60 s, then confirm. Two people tapping the same seat cannot both succeed.
create or replace function public.hold_resident_seat(p_session_id uuid, p_seat_code text)
returns timestamptz language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_exp timestamptz;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if c.role <> 'resident' then raise exception 'Active Resident account required'; end if;
  if not exists (select 1 from public.resident_round_attendance a where a.session_id = p_session_id and a.user_id = c.user_id) then
    raise exception 'Scan the room QR before choosing a seat';
  end if;
  if not exists (select 1 from public.resident_room_seats s where s.layout_id = c.layout_id and s.seat_code = p_seat_code) then
    raise exception 'Seat does not exist';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_seat_code, 0));
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.expires_at <= c.now_ts;
  if exists (select 1 from public.resident_seat_assignments a where a.session_id = p_session_id and a.seat_code = p_seat_code and a.released_at is null)
     or exists (select 1 from public.resident_seat_holds h where h.session_id = p_session_id and h.seat_code = p_seat_code and h.user_id <> c.user_id) then
    raise exception 'Seat is not available';
  end if;
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.user_id = c.user_id;
  insert into public.resident_seat_holds(session_id, seat_code, user_id, expires_at)
  values (p_session_id, p_seat_code, c.user_id, c.now_ts + interval '60 seconds')
  returning expires_at into v_exp;
  perform private.resident_seat_log(p_session_id, c.user_id, c.user_id, 'hold', p_seat_code, '{}'::jsonb);
  return v_exp;
end;
$$;
revoke all on function public.hold_resident_seat(uuid, text) from public, anon;
grant execute on function public.hold_resident_seat(uuid, text) to authenticated;

create or replace function public.confirm_resident_seat(p_session_id uuid, p_seat_code text)
returns void language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_old text;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if c.role <> 'resident' then raise exception 'Active Resident account required'; end if;
  if not exists (select 1 from public.resident_round_attendance a where a.session_id = p_session_id and a.user_id = c.user_id) then
    raise exception 'Scan the room QR before choosing a seat';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_seat_code, 0));
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.expires_at <= c.now_ts;
  if not exists (select 1 from public.resident_seat_holds h where h.session_id = p_session_id and h.seat_code = p_seat_code and h.user_id = c.user_id) then
    raise exception 'Seat hold expired. Choose the seat again';
  end if;
  if exists (select 1 from public.resident_seat_assignments a where a.session_id = p_session_id and a.seat_code = p_seat_code and a.released_at is null) then
    raise exception 'Seat is not available';
  end if;
  begin
    update public.resident_seat_assignments a set released_at = c.now_ts, release_reason = 'moved'
    where a.session_id = p_session_id and a.user_id = c.user_id and a.released_at is null
    returning a.seat_code into v_old;
    insert into public.resident_seat_assignments(session_id, user_id, seat_code, seated_at, assigned_by)
    values (p_session_id, c.user_id, p_seat_code, c.now_ts, c.user_id);
  exception when unique_violation then
    raise exception 'Seat is not available';
  end;
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.user_id = c.user_id;
  delete from public.resident_seat_status s where s.session_id = p_session_id and s.user_id = c.user_id;
  perform private.resident_seat_log(p_session_id, c.user_id, c.user_id, case when v_old is null then 'confirm' else 'move' end, p_seat_code,
    case when v_old is null then '{}'::jsonb else jsonb_build_object('from', v_old) end);
end;
$$;
revoke all on function public.confirm_resident_seat(uuid, text) from public, anon;
grant execute on function public.confirm_resident_seat(uuid, text) to authenticated;

create or replace function public.release_resident_seat(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_seat text;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if c.role <> 'resident' then raise exception 'Active Resident account required'; end if;
  update public.resident_seat_assignments a set released_at = c.now_ts, release_reason = 'self'
  where a.session_id = p_session_id and a.user_id = c.user_id and a.released_at is null
  returning a.seat_code into v_seat;
  if v_seat is null then raise exception 'You do not have a seat'; end if;
  perform private.resident_seat_log(p_session_id, c.user_id, c.user_id, 'release', v_seat, '{}'::jsonb);
end;
$$;
revoke all on function public.release_resident_seat(uuid) from public, anon;
grant execute on function public.release_resident_seat(uuid) to authenticated;

-- The extra seating area: still in the room, no numbered seat. The entry time is unchanged (it is the QR check-in).
create or replace function public.use_reserve_area(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_seat text;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if c.role <> 'resident' then raise exception 'Active Resident account required'; end if;
  if not exists (select 1 from public.resident_round_attendance a where a.session_id = p_session_id and a.user_id = c.user_id) then
    raise exception 'Scan the room QR before choosing a seat';
  end if;
  if exists (select 1 from public.resident_seat_status s where s.session_id = p_session_id and s.user_id = c.user_id) then
    raise exception 'Already in the reserve area';
  end if;
  update public.resident_seat_assignments a set released_at = c.now_ts, release_reason = 'reserve'
  where a.session_id = p_session_id and a.user_id = c.user_id and a.released_at is null
  returning a.seat_code into v_seat;
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.user_id = c.user_id;
  insert into public.resident_seat_status(session_id, user_id, status) values (p_session_id, c.user_id, 'reserve');
  perform private.resident_seat_log(p_session_id, c.user_id, c.user_id, 'reserve', v_seat,
    case when v_seat is null then '{}'::jsonb else jsonb_build_object('from', v_seat) end);
end;
$$;
revoke all on function public.use_reserve_area(uuid) from public, anon;
grant execute on function public.use_reserve_area(uuid) to authenticated;

-- Urgent duty (surgery, emergency, on call): no patient data, no QR scan needed, reportable until 48 h after the session.
create or replace function public.report_urgent_duty(p_session_id uuid, p_reason text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_seat text;
  v_id uuid;
begin
  select * into c from private.resident_seat_context(p_session_id, 'report');
  if c.role <> 'resident' then raise exception 'Active Resident account required'; end if;
  if p_reason is null or p_reason not in ('ผ่าตัด', 'ผู้ป่วยฉุกเฉิน', 'อยู่เวร', 'อื่น ๆ') then raise exception 'Reason is not valid'; end if;
  if char_length(coalesce(v_note, '')) > 160 then raise exception 'Note is too long'; end if;
  if not private.resident_seat_text_ok(v_note) then raise exception 'Remove numbers that could identify a patient'; end if;
  begin
    insert into public.resident_seat_requests(session_id, user_id, kind, reason, note)
    values (p_session_id, c.user_id, 'urgent', p_reason, v_note) returning id into v_id;
  exception when unique_violation then
    raise exception 'You already reported urgent duty for this session';
  end;
  update public.resident_seat_assignments a set released_at = c.now_ts, release_reason = 'urgent'
  where a.session_id = p_session_id and a.user_id = c.user_id and a.released_at is null
  returning a.seat_code into v_seat;
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.user_id = c.user_id;
  delete from public.resident_seat_status s where s.session_id = p_session_id and s.user_id = c.user_id;
  perform private.resident_seat_log(p_session_id, c.user_id, c.user_id, 'urgent', v_seat, jsonb_build_object('request_id', v_id, 'reason', p_reason));
  return v_id;
end;
$$;
revoke all on function public.report_urgent_duty(uuid, text, text) from public, anon;
grant execute on function public.report_urgent_duty(uuid, text, text) to authenticated;

create or replace function public.request_seat_correction(p_session_id uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_note text := btrim(coalesce(p_note, ''));
  v_id uuid;
begin
  select * into c from private.resident_seat_context(p_session_id, 'report');
  if c.role not in ('resident', 'staff') then raise exception 'Active Resident or Staff account required'; end if;
  if v_note = '' then raise exception 'Describe what should be corrected'; end if;
  if char_length(v_note) > 200 then raise exception 'Note is too long'; end if;
  if not private.resident_seat_text_ok(v_note) then raise exception 'Remove numbers that could identify a patient'; end if;
  begin
    insert into public.resident_seat_requests(session_id, user_id, kind, note) values (p_session_id, c.user_id, 'correction', v_note) returning id into v_id;
  exception when unique_violation then
    raise exception 'You already have a correction request waiting';
  end;
  perform private.resident_seat_log(p_session_id, c.user_id, c.user_id, 'correction', null, jsonb_build_object('request_id', v_id));
  return v_id;
end;
$$;
revoke all on function public.request_seat_correction(uuid, text) from public, anon;
grant execute on function public.request_seat_correction(uuid, text) to authenticated;

-- ---------- Staff and Admin functions ----------

-- Staff who checked in (and Admin) seat or move a Resident who ALREADY scanned the room QR. No swaps: an occupied seat is refused.
create or replace function public.staff_set_resident_seat(p_session_id uuid, p_resident_id uuid, p_seat_code text)
returns void language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_old text;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if not (select private.resident_can_manage_seat_map(p_session_id)) then raise exception 'Staff who checked in, or Admin, required'; end if;
  if not exists (
    select 1 from public.resident_user_roles r join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = p_resident_id and r.role = 'resident' and r.active and p.active
  ) then raise exception 'Resident not found'; end if;
  if not exists (select 1 from public.resident_round_attendance a where a.session_id = p_session_id and a.user_id = p_resident_id) then
    raise exception 'This Resident has not scanned the room QR. Ask them to send a correction request';
  end if;
  if not exists (select 1 from public.resident_room_seats s where s.layout_id = c.layout_id and s.seat_code = p_seat_code) then
    raise exception 'Seat does not exist';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_seat_code, 0));
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.expires_at <= c.now_ts;
  if exists (select 1 from public.resident_seat_assignments a where a.session_id = p_session_id and a.seat_code = p_seat_code and a.released_at is null)
     or exists (select 1 from public.resident_seat_holds h where h.session_id = p_session_id and h.seat_code = p_seat_code and h.user_id <> p_resident_id) then
    raise exception 'Seat is not available';
  end if;
  begin
    update public.resident_seat_assignments a set released_at = c.now_ts, release_reason = 'staff'
    where a.session_id = p_session_id and a.user_id = p_resident_id and a.released_at is null
    returning a.seat_code into v_old;
    insert into public.resident_seat_assignments(session_id, user_id, seat_code, seated_at, assigned_by)
    values (p_session_id, p_resident_id, p_seat_code, c.now_ts, c.user_id);
  exception when unique_violation then
    raise exception 'Seat is not available';
  end;
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.user_id = p_resident_id;
  delete from public.resident_seat_status s where s.session_id = p_session_id and s.user_id = p_resident_id;
  perform private.resident_seat_log(p_session_id, c.user_id, p_resident_id, 'staff_set', p_seat_code,
    case when v_old is null then '{}'::jsonb else jsonb_build_object('from', v_old) end);
end;
$$;
revoke all on function public.staff_set_resident_seat(uuid, uuid, text) from public, anon;
grant execute on function public.staff_set_resident_seat(uuid, uuid, text) to authenticated;

create or replace function public.staff_release_resident_seat(p_session_id uuid, p_resident_id uuid)
returns void language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_seat text;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if not (select private.resident_can_manage_seat_map(p_session_id)) then raise exception 'Staff who checked in, or Admin, required'; end if;
  update public.resident_seat_assignments a set released_at = c.now_ts, release_reason = 'staff'
  where a.session_id = p_session_id and a.user_id = p_resident_id and a.released_at is null
  returning a.seat_code into v_seat;
  if v_seat is null then raise exception 'This Resident has no seat'; end if;
  perform private.resident_seat_log(p_session_id, c.user_id, p_resident_id, 'staff_release', v_seat, '{}'::jsonb);
end;
$$;
revoke all on function public.staff_release_resident_seat(uuid, uuid) from public, anon;
grant execute on function public.staff_release_resident_seat(uuid, uuid) to authenticated;

-- Optional: a Staff member in the room says "the map matches what I see now". It is NOT a statement that anyone stayed to the end.
create or replace function public.certify_seat_map(p_session_id uuid)
returns timestamptz language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_edits integer;
  v_seated integer;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if c.role <> 'staff' then raise exception 'Active Staff account required'; end if;
  if not exists (select 1 from public.resident_round_attendance a where a.session_id = p_session_id and a.user_id = c.user_id) then
    raise exception 'Check in with the room QR first';
  end if;
  select count(*)::int into v_edits from public.resident_seat_events e where e.session_id = p_session_id and e.kind in ('staff_set', 'staff_release');
  select count(*)::int into v_seated from public.resident_seat_assignments a where a.session_id = p_session_id and a.released_at is null;
  perform private.resident_seat_log(p_session_id, c.user_id, null, 'certify', null, jsonb_build_object('edits', v_edits, 'seated', v_seated));
  return c.now_ts;
end;
$$;
revoke all on function public.certify_seat_map(uuid) from public, anon;
grant execute on function public.certify_seat_map(uuid) to authenticated;

-- Turn the seat map on for one session. Defaults copy the layout and the on-time CLOCK time of the closest earlier configured
-- session (or starts_at + 15 minutes if that time falls outside this window). Re-running keeps the current layout and time unless given.
create or replace function public.admin_configure_seat_session(p_session_id uuid, p_layout_id uuid default null, p_on_time_at timestamptz default null)
returns table (session_id uuid, layout_id uuid, on_time_at timestamptz)
language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_s record;
  v_prev record;
  v_exist record;
  v_layout uuid;
  v_on timestamptz;
begin
  if not (select private.resident_can_configure_seat_map()) then raise exception 'Active Admin account required'; end if;
  select s.id, s.starts_at, s.ends_at into v_s
  from public.resident_round_sessions s where s.id = p_session_id and s.cancelled_at is null and s.closed_at is null;
  if v_s.id is null then raise exception 'Session not found, cancelled or closed'; end if;
  select cfg.layout_id, cfg.on_time_at into v_prev
  from public.resident_round_seat_config cfg join public.resident_round_sessions s2 on s2.id = cfg.session_id
  where cfg.session_id <> p_session_id and s2.starts_at < v_s.starts_at
  order by s2.starts_at desc limit 1;
  select cfg.layout_id, cfg.on_time_at into v_exist from public.resident_round_seat_config cfg where cfg.session_id = p_session_id;
  v_layout := coalesce(p_layout_id, v_exist.layout_id, v_prev.layout_id,
                       (select l.id from public.resident_room_layouts l where l.active order by l.name limit 1));
  if v_layout is null or not exists (select 1 from public.resident_room_layouts l where l.id = v_layout and l.active) then
    raise exception 'Layout not found';
  end if;
  if p_on_time_at is not null then
    if p_on_time_at < v_s.starts_at or p_on_time_at > v_s.ends_at then raise exception 'On-time must be inside the session window'; end if;
    v_on := p_on_time_at;
  elsif v_exist.on_time_at is not null then
    v_on := v_exist.on_time_at;
  else
    v_on := case when v_prev.on_time_at is null then null else
      ((v_s.starts_at at time zone 'Asia/Bangkok')::date + (v_prev.on_time_at at time zone 'Asia/Bangkok')::time) at time zone 'Asia/Bangkok' end;
    if v_on is null or v_on < v_s.starts_at or v_on > v_s.ends_at then v_on := least(v_s.starts_at + interval '15 minutes', v_s.ends_at); end if;
  end if;
  if v_exist.layout_id is not null then
    if v_exist.layout_id <> v_layout and (
         exists (select 1 from public.resident_seat_assignments a where a.session_id = p_session_id)
         or exists (select 1 from public.resident_seat_holds h where h.session_id = p_session_id)) then
      raise exception 'Layout cannot change after seating started';
    end if;
    update public.resident_round_seat_config cfg set layout_id = v_layout, on_time_at = v_on where cfg.session_id = p_session_id;
  else
    insert into public.resident_round_seat_config(session_id, layout_id, on_time_at, created_by) values (p_session_id, v_layout, v_on, v_uid);
  end if;
  perform private.resident_seat_log(p_session_id, v_uid, null, 'configure', null, jsonb_build_object('layout_id', v_layout, 'on_time_at', v_on));
  return query select p_session_id, v_layout, v_on;
end;
$$;
revoke all on function public.admin_configure_seat_session(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.admin_configure_seat_session(uuid, uuid, timestamptz) to authenticated;

-- Who decides urgent-duty reports and correction requests: an active Staff account, not Admin (decision D7, 2026-10-14).
-- A named capability, so it can move to another role later without rewriting the function.
create or replace function private.resident_can_review_seat_requests()
returns boolean language sql stable security definer set search_path = public, private, auth as $$
  select private.resident_role_is('staff')
$$;
revoke all on function private.resident_can_review_seat_requests() from public, anon;
grant execute on function private.resident_can_review_seat_requests() to authenticated;

create or replace function public.review_seat_request(p_request_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_r record;
  v_owner uuid;
begin
  if not (select private.resident_can_review_seat_requests()) then raise exception 'Active Staff account required'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then raise exception 'Decision must be approved or rejected'; end if;
  select r.user_id into v_owner from public.resident_seat_requests r where r.id = p_request_id and r.state = 'pending';
  if v_owner = v_uid then raise exception 'You cannot review your own request'; end if;
  update public.resident_seat_requests r set state = p_decision, reviewed_by = v_uid, reviewed_at = clock_timestamp()
  where r.id = p_request_id and r.state = 'pending'
  returning r.session_id, r.user_id, r.kind into v_r;
  if v_r.session_id is null then raise exception 'Request not found or already reviewed'; end if;
  perform private.resident_seat_log(v_r.session_id, v_uid, v_r.user_id, 'review', null,
    jsonb_build_object('request_id', p_request_id, 'decision', p_decision, 'kind', v_r.kind));
end;
$$;
revoke all on function public.review_seat_request(uuid, text) from public, anon;
grant execute on function public.review_seat_request(uuid, text) to authenticated;

create or replace function public.admin_list_seat_configs()
returns table (session_id uuid, layout_id uuid, layout_name text, on_time_at timestamptz, seated integer, pending_requests integer)
language plpgsql stable security definer set search_path = public, private, auth as $$
#variable_conflict use_column
begin
  if not (select private.resident_can_configure_seat_map()) then raise exception 'Active Admin account required'; end if;
  return query
  select cfg.session_id, cfg.layout_id, l.name, cfg.on_time_at,
         (select count(*)::int from public.resident_seat_assignments a where a.session_id = cfg.session_id and a.released_at is null),
         (select count(*)::int from public.resident_seat_requests q where q.session_id = cfg.session_id and q.state = 'pending')
  from public.resident_round_seat_config cfg
  join public.resident_room_layouts l on l.id = cfg.layout_id
  order by cfg.created_at desc, cfg.session_id;
end;
$$;
revoke all on function public.admin_list_seat_configs() from public, anon;
grant execute on function public.admin_list_seat_configs() to authenticated;
