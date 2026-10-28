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

update public.resident_maintenance_pause set paused=false where scope='accounts';

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
    values (v_id, (select id from public.resident_room_layouts where name = 'ห้องประชุมวันศุกร์ (38 ที่)'), v_start + p_on_time, t.uid('adm'));
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
select t.ok((select count(*) from public.resident_room_seats s join public.resident_room_layouts l on l.id = s.layout_id where l.name = 'ห้องประชุมวันศุกร์ (38 ที่)') = 38, 'seed layout has 38 seats (second moderator seat added by the follow-up migration)');
select t.ok((select count(*) from public.resident_room_seats where layout_id=(select id from public.resident_room_layouts where name='ห้องประชุมวันศุกร์ (38 ที่)') and zone = 'L') = 12 and (select count(*) from public.resident_room_seats where layout_id=(select id from public.resident_room_layouts where name='ห้องประชุมวันศุกร์ (38 ที่)') and zone = 'C') = 12
            and (select count(*) from public.resident_room_seats where layout_id=(select id from public.resident_room_layouts where name='ห้องประชุมวันศุกร์ (38 ที่)') and zone = 'R') = 12 and (select count(*) from public.resident_room_seats where layout_id=(select id from public.resident_room_layouts where name='ห้องประชุมวันศุกร์ (38 ที่)') and zone = 'M') = 2, 'zones: M1+M2, 12 left, 12 centre, 12 right');
select t.ok((select row_no || ',' || col_no from public.resident_room_seats where layout_id=(select id from public.resident_room_layouts where name='ห้องประชุมวันศุกร์ (38 ที่)') and seat_code = 'C1') = '1,1'
            and (select row_no || ',' || col_no from public.resident_room_seats where layout_id=(select id from public.resident_room_layouts where name='ห้องประชุมวันศุกร์ (38 ที่)') and seat_code = 'C2') = '1,2'
            and (select row_no || ',' || col_no from public.resident_room_seats where layout_id=(select id from public.resident_room_layouts where name='ห้องประชุมวันศุกร์ (38 ที่)') and seat_code = 'C11') = '6,1'
            and (select row_no || ',' || col_no from public.resident_room_seats where layout_id=(select id from public.resident_room_layouts where name='ห้องประชุมวันศุกร์ (38 ที่)') and seat_code = 'C12') = '6,2', 'central table is 2 sides x 6 rows');
select t.ok((select row_no || ',' || col_no from public.resident_room_seats where layout_id=(select id from public.resident_room_layouts where name='ห้องประชุมวันศุกร์ (38 ที่)') and seat_code = 'L12') = '4,3'
            and (select row_no || ',' || col_no from public.resident_room_seats where layout_id=(select id from public.resident_room_layouts where name='ห้องประชุมวันศุกร์ (38 ที่)') and seat_code = 'R4') = '2,1', 'side zones are 4 rows x 3 columns');

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
select public.hold_resident_seat(t.sid('live'),'C5');
select t.ok(exists(select 1 from public.resident_seat_holds where session_id=t.sid('live') and user_id=t.uid('s1')), 'Staff may hold their own seat after QR');
delete from public.resident_seat_holds where session_id=t.sid('live') and user_id=t.uid('s1');
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
                      and c.layout_id = (select id from public.resident_room_layouts where name = 'ห้องประชุมจริง · 64 ที่ (2569-10)')), 'defaults: the active layout and an on-time time inside the window');
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

-- B4: session list
select t.as_user('r1');
select t.ok((select count(*) from public.list_resident_seat_sessions()) = 2
            and exists (select 1 from public.list_resident_seat_sessions() where session_id = t.sid('live'))
            and exists (select 1 from public.list_resident_seat_sessions() where session_id = t.sid('ended')), 'a Resident sees the live session and the one that ended within 48 h, not future or unconfigured ones');
select t.expect_denied_as('anon', 'select * from public.list_resident_seat_sessions()', 'anon cannot list seat sessions');

-- B4: the map as a Resident
select t.ok(jsonb_array_length(public.get_resident_seat_map(t.sid('live'))->'seats') = 38, 'the map lists all 38 seats');
select t.ok(public.get_resident_seat_map(t.sid('live'))->'me'->>'seat' = 'L2' and public.get_resident_seat_map(t.sid('live'))->'me'->>'status' = 'seat'
            and (public.get_resident_seat_map(t.sid('live'))->'me'->>'in_room')::boolean, 'my own seat and status are right');
select t.ok((select e->'occupant'->>'name' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'seats') e where e->>'seat_code' = 'C1') = 'Test r2', 'names are visible on the map (decision B)');
select t.ok(position('@example.test' in public.get_resident_seat_map(t.sid('live'))::text) = 0, 'no e-mail address in the map');
select t.ok(not exists (select 1 from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'status' in ('absent', 'urgent')), 'a Resident cannot see who is absent or on urgent duty');
select t.ok(exists (select 1 from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('s1')::text and p->>'status' = 'staff'), 'Staff in the room are listed');
select t.ok(not exists (select 1 from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('s2')::text), 'Staff who are not in the room are not listed to a Resident');
select t.ok((select p->>'checked_in_at' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('r2')::text) is null
            and (select p->>'checked_in_at' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('r1')::text) is not null, 'a Resident sees entry times only for themselves');
select t.as_user('r2');
select public.hold_resident_seat(t.sid('live'), 'L5');
select t.as_user('r1');
select t.ok((select (e->>'held')::boolean from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'seats') e where e->>'seat_code' = 'L5')
            and (select e->'occupant' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'seats') e where e->>'seat_code' = 'L5') = 'null'::jsonb
            and public.get_resident_seat_map(t.sid('live'))->'me'->'hold' = 'null'::jsonb, 'a hold shows as held, never who holds it');
select t.expect_error(format($q$select public.get_resident_seat_map(%L)$q$, t.sid('future')), 'Seat map is closed', 'a Resident cannot read a session that starts in hours');
select t.expect_error(format($q$select public.get_resident_seat_map(%L)$q$, t.sid('noconfig')), 'not open for this session', 'a session without a map has nothing to read');
select t.ok((public.get_resident_seat_map(t.sid('ended'))->'session'->>'ended')::boolean and not (public.get_resident_seat_map(t.sid('ended'))->'session'->>'open')::boolean, 'an ended session reads as ended');
select t.expect_denied_as('anon', format('select public.get_resident_seat_map(%L)', t.sid('live')), 'anon cannot read the map');

-- B4: my own history
select t.ok(exists (select 1 from public.get_my_seat_events(t.sid('live')) where kind = 'staff_set' and seat_code = 'L2')
            and not exists (select 1 from public.get_my_seat_events(t.sid('live')) where kind = 'hold'), 'my history lists what happened to me, without the hold taps');
select t.ok(not exists (select 1 from public.get_my_seat_events(t.sid('live')) where seat_code = 'C1'), 'my history never shows another person''s seat events');
select t.expect_denied_as('anon', format('select * from public.get_my_seat_events(%L)', t.sid('live')), 'anon cannot read a history');

-- B4: the map as Staff and Admin
select t.as_user('s1');
select t.ok(exists (select 1 from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('r5')::text and p->>'status' = 'absent')
            and exists (select 1 from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('r4')::text and p->>'status' = 'urgent'), 'Staff see absent and urgent-duty people');
select t.ok((select p->>'checked_in_at' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('r2')::text) is not null, 'Staff see entry times');
select t.as_user('adm');
select t.ok(jsonb_array_length(public.get_resident_seat_map(t.sid('future'))->'seats') >= 1, 'Admin may read any configured session');

-- B4: the Admin report
insert into public.resident_round_attendance(session_id, user_id, role_at_check_in, checked_in_at)
  select t.sid('live'), t.uid('r5'), 'resident', on_time_at + interval '1 minute' from public.resident_round_seat_config where session_id = t.sid('live');
select t.ok((public.admin_seat_report(t.sid('live'))->'counts'->>'residents_attended')::int = 4
            and (public.admin_seat_report(t.sid('live'))->'counts'->>'before_on_time')::int = 3
            and (public.admin_seat_report(t.sid('live'))->'counts'->>'after_on_time')::int = 1
            and (public.admin_seat_report(t.sid('live'))->'counts'->>'staff_attended')::int = 1, 'report: entries before and after the on-time time');
select t.ok((public.admin_seat_report(t.sid('live'))->'counts'->>'seated')::int = 3
            and (public.admin_seat_report(t.sid('live'))->'counts'->>'urgent_pending')::int = 1
            and (public.admin_seat_report(t.sid('live'))->'counts'->>'urgent_approved')::int = 1
            and (public.admin_seat_report(t.sid('live'))->'counts'->>'correction_pending')::int = 2
            and (public.admin_seat_report(t.sid('live'))->'counts'->>'certifications')::int = 1, 'report: seats, requests and certifications');
select t.ok(jsonb_array_length(public.admin_seat_report(t.sid('live'))->'requests') = 4 and jsonb_array_length(public.admin_seat_report(t.sid('live'))->'events') > 10, 'report: requests and the event log are listed');
select t.as_user('s1');
select t.expect_error(format($q$select public.admin_seat_report(%L)$q$, t.sid('live')), 'Active Admin account required', 'Staff cannot read the report');
select t.as_user('r1');
select t.expect_error(format($q$select public.admin_seat_report(%L)$q$, t.sid('live')), 'Active Admin account required', 'a Resident cannot read the report');

-- B4: the request list (Staff decide, Admin may read)
select t.expect_error(format($q$select * from public.list_seat_requests(%L)$q$, t.sid('live')), 'Active Staff account required', 'a Resident cannot list requests');
select t.as_user('s2');
select t.ok((select count(*) from public.list_seat_requests(t.sid('live'))) = 4
            and exists (select 1 from public.list_seat_requests(t.sid('live')) where kind = 'urgent' and state = 'approved' and reviewed_by_name = 'Test s2'), 'Staff list the requests of the session and see who decided');
select t.as_user('adm');
select t.ok((select count(*) from public.list_seat_requests(t.sid('live'))) = 4, 'Admin may read the request list');
select t.expect_denied_as('anon', format('select * from public.list_seat_requests(%L)', t.sid('live')), 'anon cannot list requests');

-- B5: direct access is closed, whatever the functions do
select t.expect_denied_as('anon', 'select * from public.resident_seat_assignments', 'anon cannot read assignments');
select t.expect_denied_as('authenticated', 'select * from public.resident_seat_assignments', 'signed-in users cannot read assignments directly');
select t.expect_denied_as('authenticated', 'select * from public.resident_seat_events', 'signed-in users cannot read the event log directly');
select t.expect_denied_as('authenticated', 'select * from public.resident_seat_requests', 'signed-in users cannot read requests directly');
select t.expect_denied_as('authenticated', format($q$insert into public.resident_seat_events(session_id, actor_id, kind) values (%L, %L, 'hold')$q$, t.sid('live'), t.uid('r1')), 'signed-in users cannot write the log directly');
select t.expect_denied_as('authenticated', format($q$update public.resident_seat_assignments set seat_code = 'M1' where session_id = %L$q$, t.sid('live')), 'signed-in users cannot edit assignments directly');
select t.expect_denied_as('authenticated', format($q$delete from public.resident_seat_holds where session_id = %L$q$, t.sid('live')), 'signed-in users cannot delete holds directly');
select t.expect_denied_as('authenticated', 'select private.resident_seat_context(null, ''live'')', 'internal helpers are not callable from outside');
create function t.expect_allowed_as(p_role text, p_sql text, p_label text) returns void language plpgsql as $$
declare v_msg text;
begin
  execute format('set local role %I', p_role);
  begin execute p_sql; exception when others then get stacked diagnostics v_msg = message_text; end;
  execute 'reset role';
  if v_msg is not null then raise exception 'FAIL % : % (%)', p_label, v_msg, p_role; end if;
  raise notice 'PASS %', p_label;
end $$;
select t.expect_allowed_as('authenticated', 'select count(*) from public.resident_room_layouts', 'signed-in users can read layouts directly');
select t.expect_allowed_as('authenticated', 'select count(*) from public.resident_room_seats', 'signed-in users can read seats directly');
select t.expect_denied_as('anon', 'select count(*) from public.resident_room_seats', 'anon cannot read seats');

-- B5: every public function refuses anon; nobody but the owner runs the internals
do $$
declare v_f regprocedure;
begin
  for v_f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname ~ '^(hold_resident_seat|confirm_resident_seat|release_resident_seat|use_reserve_area|report_urgent_duty|request_seat_correction|staff_set_resident_seat|staff_release_resident_seat|certify_seat_map|admin_configure_seat_session|review_seat_request|list_seat_requests|admin_list_seat_configs|list_resident_seat_sessions|get_resident_seat_map|get_my_seat_events|admin_seat_report)$'
  loop
    if has_function_privilege('anon', v_f, 'execute') then raise exception 'FAIL anon can run %', v_f; end if;
    if not has_function_privilege('authenticated', v_f, 'execute') then raise exception 'FAIL authenticated cannot run %', v_f; end if;
  end loop;
  raise notice 'PASS no seat function is open to anon and all are open to signed-in users';
end $$;

-- FINAL-REVIEW FIXES: seat time privacy, urgent precedence, Staff late-request window, helper hardening
-- (a) an occupant's seat time is visible only to Staff, Admin and the occupant
select t.as_user('r1');
select t.ok((select e->'occupant'->>'seated_at' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'seats') e where e->>'seat_code' = 'C1') is null
            and (select e->'occupant'->>'name' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'seats') e where e->>'seat_code' = 'C1') = 'Test r2', 'a Resident sees who sits at C1 but not when they sat down');
select t.ok((select e->'occupant'->>'seated_at' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'seats') e where e->>'seat_code' = 'L2') is not null, 'a Resident sees the seat time of their own seat');
select t.as_user('s1');
select t.ok((select e->'occupant'->>'seated_at' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'seats') e where e->>'seat_code' = 'C1') is not null, 'Staff see the seat time of an occupant');

-- (b) a Resident who scanned, took a seat and then reported urgent duty shows as urgent (not as in the room)
insert into t.users(name) values ('r6');
insert into auth.users(id, email) select id, name || '@example.test' from t.users where name = 'r6';
insert into public.resident_profiles(user_id, full_name, email, pgy, active) select id, 'Test r6', 'r6@example.test', 2, true from t.users where name = 'r6';
insert into public.resident_user_roles(user_id, role, active) select id, 'resident'::public.resident_system_role, true from t.users where name = 'r6';
insert into public.resident_round_attendance(session_id, user_id, role_at_check_in, checked_in_at) values (t.sid('live'), t.uid('r6'), 'resident', clock_timestamp() - interval '5 minutes');
select t.as_user('r6');
select public.hold_resident_seat(t.sid('live'), 'R10');
select public.confirm_resident_seat(t.sid('live'), 'R10');
select public.report_urgent_duty(t.sid('live'), 'อยู่เวร', null);
select t.ok(public.get_resident_seat_map(t.sid('live'))->'me'->>'status' = 'urgent', 'a Resident who scanned and then reported urgent duty sees status urgent for themself');
select t.as_user('s1');
select t.ok((select p->>'status' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('r6')::text) = 'urgent', 'Staff see a scanned Resident with urgent duty as urgent');
select t.as_user('adm');
select t.ok((select p->>'status' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('r6')::text) = 'urgent', 'Admin sees a scanned Resident with urgent duty as urgent');
select t.as_user('r1');
select t.ok(not exists (select 1 from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('r6')::text), 'another Resident does not see r6 listed at all');

-- (c) Staff can still decide a late request: Staff read a session for 7 days, other roles for 48 h, Admin always
select t.mk_session('old', interval '-100 hours', interval '-98 hours', interval '15 minutes');
insert into public.resident_seat_requests(session_id, user_id, kind, reason) values (t.sid('old'), t.uid('r1'), 'urgent', 'อยู่เวร');
select t.as_user('s1');
select t.ok(exists (select 1 from public.list_resident_seat_sessions() where session_id = t.sid('old')), 'Staff still list a session that ended 98 hours ago');
select t.ok(jsonb_array_length(public.get_resident_seat_map(t.sid('old'))->'seats') = 38, 'Staff can read the map of a session that ended 98 hours ago');
select t.ok((select count(*) from public.list_seat_requests(t.sid('old'))) = 1, 'Staff list the request of that older session');
select public.review_seat_request((select id from public.resident_seat_requests where session_id = t.sid('old') and user_id = t.uid('r1') and kind = 'urgent'), 'approved');
select t.ok(exists (select 1 from public.resident_seat_requests where session_id = t.sid('old') and user_id = t.uid('r1') and state = 'approved' and reviewed_by = t.uid('s1')), 'Staff decided the late request');
select t.as_user('r1');
select t.ok(not exists (select 1 from public.list_resident_seat_sessions() where session_id = t.sid('old')), 'a Resident does not list a session that ended 98 hours ago');
select t.expect_error(format($q$select public.get_resident_seat_map(%L)$q$, t.sid('old')), 'Seat map is closed', 'a Resident cannot read a session that ended 98 hours ago');
select t.as_user('adm');
select t.ok(jsonb_array_length(public.get_resident_seat_map(t.sid('old'))->'seats') = 38, 'Admin can read a session that ended 98 hours ago');

-- (d) fold-ins
select t.as_user('s1');
select t.expect_error(format($q$select * from private.resident_seat_context(%L, 'write')$q$, t.sid('live')), 'Unknown seat map phase', 'an unknown phase name is refused, not treated as open');
update public.resident_profiles set active = false where user_id = t.uid('s2');
select t.as_user('s2');
select t.expect_error(format($q$select public.review_seat_request(%L, 'approved')$q$, (select id from public.resident_seat_requests where session_id = t.sid('live') and user_id = t.uid('r4') and kind = 'urgent')), 'Active Staff account required', 'Staff whose profile is inactive cannot decide a request');
update public.resident_profiles set active = true where user_id = t.uid('s2');
select t.as_user('r1');
select t.ok((select p->>'on_time' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('r2')::text) is null
            and (select p->>'on_time' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'people') p where p->>'user_id' = t.uid('r1')::text) is not null, 'a Resident sees on-time only for themself, never for other people');

-- Two moderator seats (follow-up migration): either may stay empty, both may be used, a seat is still one person
select t.as_user('r1');
select public.hold_resident_seat(t.sid('live'), 'M2');
select public.confirm_resident_seat(t.sid('live'), 'M2');
select t.ok((select s->'occupant'->>'user_id' is null from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'seats') s where s->>'seat_code' = 'M1')
            and (select s->'occupant'->>'user_id' from jsonb_array_elements(public.get_resident_seat_map(t.sid('live'))->'seats') s where s->>'seat_code' = 'M2') = t.uid('r1')::text,
            'M2 can be taken while M1 stays empty (the moderator seats need not both be filled)');
select t.as_user('r2');
select public.hold_resident_seat(t.sid('live'), 'M1');
select public.confirm_resident_seat(t.sid('live'), 'M1');
select t.ok((select count(*) from public.resident_seat_assignments where session_id = t.sid('live') and seat_code in ('M1', 'M2') and released_at is null) = 2,
            'both moderator seats can be occupied at once by two different people');
select t.as_user('r1');
select t.expect_error(format($q$select public.hold_resident_seat(%L, 'M1')$q$, t.sid('live')), '', 'a taken moderator seat cannot be picked by someone else');

-- <<< later tasks append their blocks above this line >>>
rollback;
