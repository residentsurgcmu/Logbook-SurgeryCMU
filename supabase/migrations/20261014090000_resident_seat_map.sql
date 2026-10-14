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
