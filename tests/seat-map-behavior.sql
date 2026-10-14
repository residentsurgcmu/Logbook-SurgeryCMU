-- Behaviour tests for the seat map (migration 20261014090000).
-- Run ONLY on a throwaway local database that has all migrations applied (it refuses if any Resident data exists).
-- Everything happens inside one transaction that is rolled back at the end, so nothing is left behind.
--   psql -v ON_ERROR_STOP=1 -f tests/seat-map-behavior.sql
begin;
do $$ begin
  if exists (select 1 from public.resident_profiles) then
    raise exception 'Refusing to run: this database already has Resident data (use an empty throwaway database)';
  end if;
end $$;

create schema t;
create table t.users (name text primary key, id uuid not null default gen_random_uuid());
create table t.sess (name text primary key, id uuid not null);
create function t.uid(p_name text) returns uuid language sql as $$ select id from t.users where name = p_name $$;
create function t.sid(p_name text) returns uuid language sql as $$ select id from t.sess where name = p_name $$;
create function t.as_user(p_name text) returns void language sql as $$ select set_config('request.jwt.claim.sub', t.uid(p_name)::text, true) $$;
create function t.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin execute p_sql; exception when others then get stacked diagnostics v_msg = message_text; end;
  if v_msg is null then raise exception 'FAIL % : expected an error matching "%" but the call succeeded', p_label, p_pattern; end if;
  if v_msg !~* p_pattern then raise exception 'FAIL % : expected "%" but got "%"', p_label, p_pattern, v_msg; end if;
  raise notice 'PASS %', p_label;
end $$;
create function t.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'FAIL %', p_label; end if; raise notice 'PASS %', p_label; end $$;
create function t.expect_denied_as(p_role text, p_sql text, p_label text) returns void language plpgsql as $$
declare v_denied boolean := false;
begin
  execute format('set local role %I', p_role);
  begin execute p_sql; exception when insufficient_privilege then v_denied := true; end;
  execute 'reset role';
  if not v_denied then raise exception 'FAIL % : expected "permission denied" for role %', p_label, p_role; end if;
  raise notice 'PASS %', p_label;
end $$;

-- people: 5 residents, 2 staff, 1 admin
insert into t.users(name) values ('r1'),('r2'),('r3'),('r4'),('r5'),('s1'),('s2'),('adm');
insert into auth.users(id, email) select id, name || '@example.test' from t.users;
insert into public.resident_profiles(user_id, full_name, email, pgy, active)
  select id, 'Test ' || name, name || '@example.test', case when name like 'r%' then 2 end, true from t.users;
insert into public.resident_user_roles(user_id, role, active)
  select id, case when name like 'r%' then 'resident'::public.resident_system_role when name like 's%' then 'staff' else 'admin' end, true from t.users;

-- sessions that never overlap: live (-10 min .. +2 h), ended (-5 h .. -3 h), future (+5 h .. +7 h), no-config (+10 h .. +11 h)
create function t.mk_session(p_name text, p_start interval, p_end interval, p_on_time interval, p_config boolean default true) returns void language plpgsql as $$
declare v_id uuid; v_start timestamptz := clock_timestamp() + p_start; v_end timestamptz := clock_timestamp() + p_end;
begin
  insert into public.resident_round_sessions(meeting_date, starts_at, ends_at, opened_at, opened_by)
  values ((v_start at time zone 'Asia/Bangkok')::date, v_start, v_end, clock_timestamp(), t.uid('adm')) returning id into v_id;
  if p_config then
    insert into public.resident_round_seat_config(session_id, layout_id, on_time_at, created_by)
    values (v_id, (select id from public.resident_room_layouts where name = 'ห้องประชุมวันศุกร์ (37 ที่)'), v_start + p_on_time, t.uid('adm'));
  end if;
  insert into t.sess(name, id) values (p_name, v_id);
end $$;
select t.mk_session('live', interval '-10 minutes', interval '2 hours', interval '30 minutes');
select t.mk_session('ended', interval '-5 hours', interval '-3 hours', interval '15 minutes');
select t.mk_session('future', interval '5 hours', interval '7 hours', interval '15 minutes');
select t.mk_session('noconfig', interval '10 hours', interval '11 hours', interval '15 minutes', false);

-- QR check-ins (the existing attendance table is the evidence): r1, r2, r3 and staff s1 scanned the live room; r4, r5, s2 did not
insert into public.resident_round_attendance(session_id, user_id, role_at_check_in, checked_in_at) values
  (t.sid('live'), t.uid('r1'), 'resident', clock_timestamp() - interval '8 minutes'),
  (t.sid('live'), t.uid('r2'), 'resident', clock_timestamp() - interval '7 minutes'),
  (t.sid('live'), t.uid('r3'), 'resident', clock_timestamp() - interval '6 minutes'),
  (t.sid('live'), t.uid('s1'), 'staff', clock_timestamp() - interval '9 minutes');

-- B1: layout seed
select t.ok((select count(*) from public.resident_room_seats s join public.resident_room_layouts l on l.id = s.layout_id where l.name = 'ห้องประชุมวันศุกร์ (37 ที่)') = 37, 'seed layout has 37 seats');
select t.ok((select count(*) from public.resident_room_seats where zone = 'L') = 12 and (select count(*) from public.resident_room_seats where zone = 'C') = 12
            and (select count(*) from public.resident_room_seats where zone = 'R') = 12 and (select count(*) from public.resident_room_seats where zone = 'M') = 1, 'zones: M1, 12 left, 12 centre, 12 right');
select t.ok((select row_no || ',' || col_no from public.resident_room_seats where seat_code = 'C1') = '1,1'
            and (select row_no || ',' || col_no from public.resident_room_seats where seat_code = 'C2') = '1,2'
            and (select row_no || ',' || col_no from public.resident_room_seats where seat_code = 'C11') = '6,1'
            and (select row_no || ',' || col_no from public.resident_room_seats where seat_code = 'C12') = '6,2', 'central table is 2 sides x 6 rows');
select t.ok((select row_no || ',' || col_no from public.resident_room_seats where seat_code = 'L12') = '4,3'
            and (select row_no || ',' || col_no from public.resident_room_seats where seat_code = 'R4') = '2,1', 'side zones are 4 rows x 3 columns');

-- B1: the HN guard
select t.ok(private.resident_seat_text_ok('ผ่าตัดห้อง 3') and private.resident_seat_text_ok(null) and private.resident_seat_text_ok('room 12, 3 cases'), 'ordinary notes pass the HN guard');
select t.ok(not private.resident_seat_text_ok('HN 123456') and not private.resident_seat_text_ok('HN 12 34 56') and not private.resident_seat_text_ok('12-34-56') and not private.resident_seat_text_ok('๑๒๓๔๕๖') and not private.resident_seat_text_ok('12.34.56.7'), 'digit runs of six or more are rejected whatever separates them');

-- B1: the context helper
select t.as_user('r1');
select t.ok((select user_id from private.resident_seat_context(t.sid('live'), 'live')) = t.uid('r1'), 'context returns the caller');
select t.expect_error($q$select * from private.resident_seat_context(t.sid('noconfig'), 'live')$q$, 'not open for this session', 'no config row = no seat map');
select t.expect_error($q$select * from private.resident_seat_context(t.sid('ended'), 'live')$q$, 'Seat map is closed', 'ended session is closed for live writes');
select t.ok((select user_id from private.resident_seat_context(t.sid('ended'), 'report')) = t.uid('r1'), 'report phase is open for 48 h after the end');
select t.expect_error($q$select * from private.resident_seat_context(t.sid('future'), 'live')$q$, 'Seat map is closed', 'future session is closed');
select t.as_user('adm');
select t.ok((select user_id from private.resident_seat_context(t.sid('future'), 'read')) = t.uid('adm'), 'Admin may read any configured session');
select t.as_user('r1');
select t.expect_error($q$select * from private.resident_seat_context(t.sid('future'), 'read')$q$, 'Seat map is closed', 'a Resident cannot read a session more than an hour before it starts');
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select t.expect_error($q$select * from private.resident_seat_context(t.sid('live'), 'live')$q$, 'Active account required', 'unknown user is refused');

-- <<< later tasks append their blocks above this line >>>
rollback;
