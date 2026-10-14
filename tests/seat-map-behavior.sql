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

-- B2: hold and confirm
select t.as_user('r4');
select t.expect_error(format($q$select public.hold_resident_seat(%L, 'C1')$q$, t.sid('live')), 'Scan the room QR', 'a Resident who never scanned cannot hold a seat');
select t.as_user('r1');
select t.expect_error(format($q$select public.hold_resident_seat(%L, 'X9')$q$, t.sid('live')), 'Seat does not exist', 'unknown seat code is refused');
select t.ok((select public.hold_resident_seat(t.sid('live'), 'C1')) between clock_timestamp() + interval '55 seconds' and clock_timestamp() + interval '61 seconds', 'a hold lasts 60 seconds');
select t.as_user('r2');
select t.expect_error(format($q$select public.hold_resident_seat(%L, 'C1')$q$, t.sid('live')), 'Seat is not available', 'a seat someone else holds is refused');
select t.as_user('r1');
select public.hold_resident_seat(t.sid('live'), 'C2');
select t.ok((select count(*) from public.resident_seat_holds where user_id = t.uid('r1')) = 1 and exists (select 1 from public.resident_seat_holds where user_id = t.uid('r1') and seat_code = 'C2'), 'a new hold replaces my previous hold');
select t.as_user('r2');
select public.hold_resident_seat(t.sid('live'), 'C1');
select public.confirm_resident_seat(t.sid('live'), 'C1');
select t.ok(exists (select 1 from public.resident_seat_assignments where user_id = t.uid('r2') and seat_code = 'C1' and released_at is null)
            and not exists (select 1 from public.resident_seat_holds where user_id = t.uid('r2')), 'confirm assigns the seat and drops the hold');
select t.ok(exists (select 1 from public.resident_seat_events where subject_id = t.uid('r2') and kind = 'confirm' and seat_code = 'C1'), 'confirm is logged against the person');
select t.as_user('r1');
select t.expect_error(format($q$select public.confirm_resident_seat(%L, 'C1')$q$, t.sid('live')), 'hold expired', 'confirming a seat I never held is refused');
select t.expect_error(format($q$select public.hold_resident_seat(%L, 'C1')$q$, t.sid('live')), 'Seat is not available', 'an occupied seat cannot be held');
update public.resident_seat_holds set expires_at = clock_timestamp() - interval '1 second' where user_id = t.uid('r1');
select t.expect_error(format($q$select public.confirm_resident_seat(%L, 'C2')$q$, t.sid('live')), 'hold expired', 'an expired hold cannot be confirmed');
select t.ok(not exists (select 1 from public.resident_seat_assignments where user_id = t.uid('r1')), 'a failed confirm leaves no seat behind');

-- B2: move, release, reserve
select public.hold_resident_seat(t.sid('live'), 'C3');
select public.confirm_resident_seat(t.sid('live'), 'C3');
select public.hold_resident_seat(t.sid('live'), 'L1');
select public.confirm_resident_seat(t.sid('live'), 'L1');
select t.ok((select count(*) from public.resident_seat_assignments where user_id = t.uid('r1') and released_at is null) = 1
            and exists (select 1 from public.resident_seat_assignments where user_id = t.uid('r1') and seat_code = 'C3' and release_reason = 'moved')
            and exists (select 1 from public.resident_seat_events where subject_id = t.uid('r1') and kind = 'move' and seat_code = 'L1' and detail->>'from' = 'C3'), 'moving keeps exactly one seat and logs where from');
select public.release_resident_seat(t.sid('live'));
select t.ok(exists (select 1 from public.resident_seat_assignments where user_id = t.uid('r1') and seat_code = 'L1' and release_reason = 'self'), 'release records the reason');
select t.expect_error(format($q$select public.release_resident_seat(%L)$q$, t.sid('live')), 'do not have a seat', 'releasing with no seat is refused');
select public.use_reserve_area(t.sid('live'));
select t.ok(exists (select 1 from public.resident_seat_status where user_id = t.uid('r1') and status = 'reserve'), 'reserve area status is recorded');
select t.expect_error(format($q$select public.use_reserve_area(%L)$q$, t.sid('live')), 'Already in the reserve area', 'reserve area twice is refused');
select public.hold_resident_seat(t.sid('live'), 'L1');
select public.confirm_resident_seat(t.sid('live'), 'L1');
select t.ok(not exists (select 1 from public.resident_seat_status where user_id = t.uid('r1')), 'taking a seat leaves the reserve area');
select public.use_reserve_area(t.sid('live'));
select t.ok(exists (select 1 from public.resident_seat_assignments where user_id = t.uid('r1') and seat_code = 'L1' and release_reason = 'reserve'), 'the reserve area gives the seat back');
select t.as_user('r4');
select t.expect_error(format($q$select public.use_reserve_area(%L)$q$, t.sid('live')), 'Scan the room QR', 'reserve area needs a scan too');

-- B2: urgent duty
select t.as_user('r3');
select t.expect_error(format($q$select public.report_urgent_duty(%L, 'ท่องเที่ยว', null)$q$, t.sid('live')), 'Reason is not valid', 'urgent duty reason must be from the list');
select t.expect_error(format($q$select public.report_urgent_duty(%L, 'ผ่าตัด', 'HN 12 34 56')$q$, t.sid('live')), 'identify a patient', 'an HN-like note is rejected by the database');
select t.expect_error(format($q$select public.report_urgent_duty(%L, 'ผ่าตัด', '๑๒๓๔๕๖')$q$, t.sid('live')), 'identify a patient', 'Thai digits are rejected too');
select t.expect_error(format($q$select public.report_urgent_duty(%L, 'ผ่าตัด', %L)$q$, t.sid('live'), repeat('ก', 161)), 'too long', 'a 161-character note is refused');
select public.hold_resident_seat(t.sid('live'), 'R5');
select public.confirm_resident_seat(t.sid('live'), 'R5');
select public.report_urgent_duty(t.sid('live'), 'ผ่าตัด', 'ห้องผ่าตัด 3');
select t.ok(exists (select 1 from public.resident_seat_requests where user_id = t.uid('r3') and kind = 'urgent' and state = 'pending')
            and exists (select 1 from public.resident_seat_assignments where user_id = t.uid('r3') and seat_code = 'R5' and release_reason = 'urgent'), 'urgent duty is recorded as pending and frees the seat');
select t.expect_error(format($q$select public.report_urgent_duty(%L, 'อยู่เวร', null)$q$, t.sid('live')), 'already reported urgent', 'one pending urgent report per session');
select t.as_user('r4');
select t.ok((select public.report_urgent_duty(t.sid('live'), 'อยู่เวร', null)) is not null, 'urgent duty does not require a QR scan');
select t.ok((select public.report_urgent_duty(t.sid('ended'), 'ผ่าตัด', null)) is not null, 'urgent duty can be reported within 48 h after the session ended');
select t.expect_error(format($q$select public.report_urgent_duty(%L, 'ผ่าตัด', null)$q$, t.sid('future')), 'Seat map is closed', 'urgent duty cannot be reported before the session starts');

-- B2: correction requests
select t.as_user('r3');
select t.ok((select public.request_seat_correction(t.sid('live'), 'ลืมกดเข้าห้อง')) is not null, 'a Resident can ask for a correction');
select t.expect_error(format($q$select public.request_seat_correction(%L, 'อีกครั้ง')$q$, t.sid('live')), 'correction request waiting', 'one pending correction per session');
select t.as_user('s1');
select t.ok((select public.request_seat_correction(t.sid('live'), 'ย้ายที่ไม่ตรง')) is not null, 'Staff can ask for a correction');
select t.expect_error(format($q$select public.request_seat_correction(%L, 'เลข 1234567')$q$, t.sid('live')), 'identify a patient', 'corrections pass the HN guard');
select t.expect_error(format($q$select public.request_seat_correction(%L, %L)$q$, t.sid('ended'), repeat('ก', 201)), 'too long', 'a 201-character correction is refused');
select t.as_user('adm');
select t.expect_error(format($q$select public.request_seat_correction(%L, 'x')$q$, t.sid('live')), 'Resident or Staff account required', 'Admin does not file corrections');

-- B2: roles, windows and the database guarantees
select t.as_user('s1');
select t.expect_error(format($q$select public.hold_resident_seat(%L, 'C5')$q$, t.sid('live')), 'Active Resident account required', 'Staff do not pick seats');
select t.as_user('r1');
select t.expect_error(format($q$select public.hold_resident_seat(%L, 'C5')$q$, t.sid('ended')), 'Seat map is closed', 'no seat changes after the session ended');
select t.expect_error(format($q$select public.hold_resident_seat(%L, 'C5')$q$, t.sid('noconfig')), 'not open for this session', 'a session without a seat map is untouched');
select t.expect_error(format($q$insert into public.resident_seat_assignments(session_id, user_id, seat_code, seated_at, assigned_by) values (%L, %L, 'C1', clock_timestamp(), %L)$q$, t.sid('live'), t.uid('r5'), t.uid('r5')), 'duplicate key', 'the database refuses two people on one seat even if a function were wrong');
select t.expect_error(format($q$insert into public.resident_seat_assignments(session_id, user_id, seat_code, seated_at, assigned_by) values (%L, %L, 'C7', clock_timestamp(), %L)$q$, t.sid('live'), t.uid('r2'), t.uid('r2')), 'duplicate key', 'the database refuses one person on two seats');

-- B3: Staff and Admin seating
select t.as_user('s2');
select t.expect_error(format($q$select public.staff_set_resident_seat(%L, %L, 'C5')$q$, t.sid('live'), t.uid('r3')), 'Staff who checked in', 'Staff who never scanned cannot seat anyone');
select t.as_user('r1');
select t.expect_error(format($q$select public.staff_set_resident_seat(%L, %L, 'C5')$q$, t.sid('live'), t.uid('r3')), 'Staff who checked in', 'a Resident cannot seat anyone');
select t.as_user('s1');
select public.staff_set_resident_seat(t.sid('live'), t.uid('r3'), 'R6');
select t.ok(exists (select 1 from public.resident_seat_assignments where user_id = t.uid('r3') and seat_code = 'R6' and released_at is null and assigned_by = t.uid('s1'))
            and exists (select 1 from public.resident_seat_events where kind = 'staff_set' and actor_id = t.uid('s1') and subject_id = t.uid('r3') and seat_code = 'R6'), 'Staff seat a Resident and the Staff name is recorded');
select t.expect_error(format($q$select public.staff_set_resident_seat(%L, %L, 'C5')$q$, t.sid('live'), t.uid('r4')), 'has not scanned', 'Staff cannot seat a Resident who never scanned (QR stays the evidence)');
select t.expect_error(format($q$select public.staff_set_resident_seat(%L, %L, 'C1')$q$, t.sid('live'), t.uid('r1')), 'Seat is not available', 'Staff cannot take an occupied seat');
select t.expect_error(format($q$select public.staff_set_resident_seat(%L, %L, 'X9')$q$, t.sid('live'), t.uid('r1')), 'Seat does not exist', 'Staff seat codes are checked too');
select t.expect_error(format($q$select public.staff_set_resident_seat(%L, %L, 'L2')$q$, t.sid('live'), t.uid('s2')), 'Resident not found', 'only Residents can be seated');
select public.staff_set_resident_seat(t.sid('live'), t.uid('r1'), 'L2');
select t.ok(exists (select 1 from public.resident_seat_assignments where user_id = t.uid('r1') and seat_code = 'L2' and released_at is null)
            and not exists (select 1 from public.resident_seat_status where user_id = t.uid('r1')), 'seating a Resident from the reserve area clears the reserve status');
select public.staff_release_resident_seat(t.sid('live'), t.uid('r3'));
select t.ok(exists (select 1 from public.resident_seat_assignments where user_id = t.uid('r3') and seat_code = 'R6' and release_reason = 'staff'), 'Staff release records the reason');
select t.expect_error(format($q$select public.staff_release_resident_seat(%L, %L)$q$, t.sid('live'), t.uid('r3')), 'has no seat', 'releasing nobody is refused');

-- B3: certification (optional extra)
select public.certify_seat_map(t.sid('live'));
select t.ok(exists (select 1 from public.resident_seat_events where kind = 'certify' and actor_id = t.uid('s1') and (detail->>'edits')::int = 3 and (detail->>'seated')::int = 2), 'certification records the time, the Staff edits so far (3) and seats taken (2)');
select t.as_user('s2');
select t.expect_error(format($q$select public.certify_seat_map(%L)$q$, t.sid('live')), 'Check in with the room QR first', 'Staff who never scanned cannot certify');
select t.as_user('r1');
select t.expect_error(format($q$select public.certify_seat_map(%L)$q$, t.sid('live')), 'Active Staff account required', 'a Resident cannot certify');
select t.as_user('adm');
select t.expect_error(format($q$select public.certify_seat_map(%L)$q$, t.sid('live')), 'Active Staff account required', 'Admin does not certify');
select public.staff_set_resident_seat(t.sid('live'), t.uid('r3'), 'R7');
select t.ok(exists (select 1 from public.resident_seat_assignments where user_id = t.uid('r3') and seat_code = 'R7' and assigned_by = t.uid('adm')), 'Admin can seat a Resident who scanned, without scanning themselves');
select t.expect_error(format($q$select public.staff_set_resident_seat(%L, %L, 'R8')$q$, t.sid('ended'), t.uid('r3')), 'Seat map is closed', 'no staff seating after the session ended');

-- B3: Admin configuration
select t.mk_session('fresh', interval '12 hours', interval '13 hours', interval '15 minutes', false);
select t.expect_error(format($q$select * from public.admin_configure_seat_session(%L, null, clock_timestamp())$q$, t.sid('fresh')), 'inside the session window', 'on-time outside the session window is refused');
select * from public.admin_configure_seat_session(t.sid('fresh'));
select t.ok(exists (select 1 from public.resident_round_seat_config c join public.resident_round_sessions s on s.id = c.session_id
                    where c.session_id = t.sid('fresh') and c.on_time_at between s.starts_at and s.ends_at
                      and c.layout_id = (select id from public.resident_room_layouts where name = 'ห้องประชุมวันศุกร์ (37 ที่)')), 'defaults: the existing layout and an on-time time inside the window');
select t.ok(exists (select 1 from public.resident_seat_events where kind = 'configure' and session_id = t.sid('fresh')), 'configuration is logged');
select * from public.admin_configure_seat_session(t.sid('live'), null, (select starts_at + interval '20 minutes' from public.resident_round_sessions where id = t.sid('live')));
select t.ok((select on_time_at from public.resident_round_seat_config where session_id = t.sid('live')) = (select starts_at + interval '20 minutes' from public.resident_round_sessions where id = t.sid('live')), 'Admin can change the on-time time');
insert into public.resident_room_layouts(name) values ('ห้องสำรอง');
insert into public.resident_room_seats(layout_id, seat_code, zone, row_no, col_no) select id, 'M1', 'M', 1, 1 from public.resident_room_layouts where name = 'ห้องสำรอง';
select t.expect_error(format($q$select * from public.admin_configure_seat_session(%L, (select id from public.resident_room_layouts where name = 'ห้องสำรอง'), null)$q$, t.sid('live')), 'cannot change after seating', 'the layout cannot change once people are seated');
select * from public.admin_configure_seat_session(t.sid('future'), (select id from public.resident_room_layouts where name = 'ห้องสำรอง'), null);
select t.ok((select layout_id from public.resident_round_seat_config where session_id = t.sid('future')) = (select id from public.resident_room_layouts where name = 'ห้องสำรอง'), 'the layout can change while nobody is seated');
select t.as_user('s1');
select t.expect_error(format($q$select * from public.admin_configure_seat_session(%L)$q$, t.sid('fresh')), 'Active Admin account required', 'Staff cannot configure a seat map');
select t.as_user('r1');
select t.expect_error(format($q$select * from public.admin_configure_seat_session(%L)$q$, t.sid('fresh')), 'Active Admin account required', 'a Resident cannot configure a seat map');
select t.expect_error($q$select * from public.admin_list_seat_configs()$q$, 'Active Admin account required', 'only Admin lists seat configurations');
select t.as_user('adm');
select t.ok((select count(*) from public.admin_list_seat_configs()) >= 4, 'Admin lists the configured sessions');
select t.ok((select seated from public.admin_list_seat_configs() where session_id = t.sid('live')) = 3, 'Admin sees how many are seated');

-- B3: request review (Staff decide, not Admin)
select t.as_user('adm');
select t.expect_error(format($q$select public.review_seat_request(%L, 'approved')$q$, (select id from public.resident_seat_requests where user_id = t.uid('r3') and kind = 'urgent')), 'Active Staff account required', 'Admin does not decide requests');
select t.as_user('r1');
select t.expect_error(format($q$select public.review_seat_request(%L, 'approved')$q$, (select id from public.resident_seat_requests where user_id = t.uid('r3') and kind = 'urgent')), 'Active Staff account required', 'a Resident cannot decide requests');
select t.as_user('s2');
select t.expect_error(format($q$select public.review_seat_request(%L, 'maybe')$q$, (select id from public.resident_seat_requests where user_id = t.uid('r3') and kind = 'urgent')), 'must be approved or rejected', 'a decision must be approved or rejected');
select public.review_seat_request((select id from public.resident_seat_requests where user_id = t.uid('r3') and kind = 'urgent'), 'approved');
select t.ok(exists (select 1 from public.resident_seat_requests where user_id = t.uid('r3') and kind = 'urgent' and state = 'approved' and reviewed_by = t.uid('s2') and reviewed_at is not null)
            and exists (select 1 from public.resident_seat_events where kind = 'review' and actor_id = t.uid('s2') and subject_id = t.uid('r3')), 'Staff approve an urgent report without needing to be in the room, and the review is logged');
select t.expect_error(format($q$select public.review_seat_request(%L, 'rejected')$q$, (select id from public.resident_seat_requests where user_id = t.uid('r3') and kind = 'urgent')), 'already reviewed', 'a request is reviewed once');
select t.as_user('s1');
select t.expect_error(format($q$select public.review_seat_request(%L, 'approved')$q$, (select id from public.resident_seat_requests where user_id = t.uid('s1') and kind = 'correction')), 'cannot review your own request', 'Staff cannot decide their own request');

-- <<< later tasks append their blocks above this line >>>
rollback;
