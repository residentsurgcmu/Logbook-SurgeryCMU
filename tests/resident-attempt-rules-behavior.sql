-- Behaviour tests for the EPA/PBA attempt rules (migration 20261007090000).
-- Run ONLY on a throwaway local database that has all migrations applied (it refuses if any Resident data exists).
-- Everything happens inside one transaction that is rolled back at the end, so nothing is left behind.
--   psql -v ON_ERROR_STOP=1 -f tests/resident-attempt-rules-behavior.sql
begin;
do $$ begin
  if exists (select 1 from public.resident_profiles) then
    raise exception 'Refusing to run: this database already has Resident data (use an empty throwaway database)';
  end if;
end $$;

create schema t;
create table t.users (name text primary key, id uuid not null default gen_random_uuid());

create function t.uid(p_name text) returns uuid language sql as $$ select id from t.users where name = p_name $$;
create function t.as_user(p_name text) returns void language sql as $$ select set_config('request.jwt.claim.sub', t.uid(p_name)::text, true) $$;
create function t.tpl(p_code text) returns uuid language sql as $$ select id from public.resident_template_definitions where template_code = p_code $$;
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

-- people: 2 residents, 3 staff, 1 admin
insert into t.users(name) values ('r1'),('r2'),('s1'),('s2'),('s3'),('adm');
insert into auth.users(id, email) select id, name || '@example.test' from t.users;
insert into public.resident_profiles(user_id, full_name, email, pgy, active)
  select id, 'Test ' || name, name || '@example.test', 2, true from t.users;
insert into public.resident_user_roles(user_id, role, active)
  select id, case when name like 'r%' then 'resident'::public.resident_system_role when name like 's%' then 'staff' else 'admin' end, true from t.users;
insert into public.resident_staff_directory(email, full_name, unit_name, active, auth_user_id)
  select name || '@example.test', 'Test ' || name, 'Unit ' || name, true, id from t.users where name like 's%';

-- helpers that talk to the real functions
create function t.scores(p_template uuid, p_score text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('criterionId', id, 'score', p_score, 'comment', '') order by sort_order), '[]'::jsonb)
  from public.resident_template_criteria where template_id = p_template and active $$;
create function t.submit(p_resident text, p_code text, p_staff text, p_date date default null) returns uuid language plpgsql as $$
declare v_t uuid := t.tpl(p_code); v_req boolean; v_out jsonb;
begin
  perform t.as_user(p_resident);
  select requires_self_assessment, outcome_options into v_req, v_out from public.resident_template_definitions where id = v_t;
  return public.submit_resident_assessment_request(v_t, t.uid(p_staff), coalesce(p_date, (clock_timestamp() at time zone 'Asia/Bangkok')::date),
    'ctx', 'activity ' || p_code, case when v_req then v_out->>0 end, case when v_req then 'self' end,
    case when v_req then t.scores(v_t, (select score_options->>1 from public.resident_template_definitions where id = v_t)) else '[]'::jsonb end);
end $$;
create function t.complete(p_staff text, p_request uuid, p_score text) returns uuid language plpgsql as $$
declare v_t uuid; v_out text;
begin
  perform t.as_user(p_staff);
  select r.template_id into v_t from public.resident_assessment_requests r where r.id = p_request;
  select outcome_options->>0 into v_out from public.resident_template_definitions where id = v_t;
  return public.complete_resident_assessment_request(p_request, v_out, '', t.scores(v_t, p_score));
end $$;
create function t.complete_mixed(p_staff text, p_request uuid, p_scores jsonb) returns uuid language plpgsql as $$
declare v_t uuid; v_out text;
begin
  perform t.as_user(p_staff);
  select r.template_id into v_t from public.resident_assessment_requests r where r.id = p_request;
  select outcome_options->>0 into v_out from public.resident_template_definitions where id = v_t;
  return public.complete_resident_assessment_request(p_request, v_out, '', p_scores);
end $$;
create function t.shift_years(p_request uuid, p_years int) returns void language sql as $$
  update public.resident_assessment_requests set submitted_at = submitted_at - make_interval(years => p_years) where id = p_request $$;
create function t.ay_start_at() returns timestamptz language sql as $$
  select private.resident_academic_year_start(clock_timestamp())::timestamp at time zone 'Asia/Bangkok' $$;

-- ===== 0. the migration did what it says
select t.ok((select max_attempts = 3 and max_attempts_per_year = 1 from public.resident_template_definitions where template_code = 'EPA-1'), 'EPA 1: lifetime limit 3, 1 per year');
select t.ok((select max_attempts = 1 and max_attempts_per_year = 1 from public.resident_template_definitions where template_code = 'EPA-7-L3'), 'EPA 7 (L3): stays 1, 1 per year');
select t.ok((select max_attempts is null and max_attempts_per_year is null from public.resident_template_definitions where template_code = 'EPA-8'), 'EPA 8: unlimited (unchanged)');
select t.ok((select bool_and(max_attempts is null and max_attempts_per_year is null) from public.resident_template_definitions where template_type = 'PBA'), 'PBA forms: no numeric limit (no-repeat is a rule, not a number)');
select t.ok(private.resident_academic_year_start('2026-10-06 10:00+07') = date '2026-07-01' and private.resident_academic_year_start('2027-06-30 23:59:59+07') = date '2026-07-01' and private.resident_academic_year_start('2027-07-01 00:00:00+07') = date '2027-07-01' and private.resident_academic_year_start('2027-06-30 16:59:59+00') = date '2026-07-01' and private.resident_academic_year_start('2027-06-30 17:00:00+00') = date '2027-07-01', 'academic year changes at 00:00 on 1 July Bangkok time (17:00 UTC on 30 June)');

-- ===== A. one request per form per academic year; pending still blocks
create temp table ctx(k text primary key, v uuid);
insert into ctx values ('a1', t.submit('r1', 'EPA-1', 's1'));
select t.expect_error($$select t.submit('r1','EPA-1','s2')$$, 'already has a pending request', 'A1 second request while one is pending is blocked (existing rule kept)');
select t.complete('s1', (select v from ctx where k='a1'), 'L4');
select t.expect_error($$select t.submit('r1','EPA-1','s2')$$, 'already requested this academic year', 'A2 same form again in the same academic year is blocked');
select t.expect_error($$select t.submit('r1','EPA-1','s1')$$, 'already requested this academic year', 'A3 same Staff, same form, same year is blocked');
select t.ok(t.submit('r1', 'EPA-2', 's1') is not null, 'A4 a different EPA form is fine');
select t.ok(t.submit('r2', 'EPA-1', 's1') is not null, 'A5 another Resident is not affected');

-- ===== B. the 1 July boundary (exact to the second)
update public.resident_assessment_requests set submitted_at = t.ay_start_at() - interval '1 second' where id = (select v from ctx where k='a1');
select t.ok(t.submit('r1', 'EPA-1', 's2') is not null, 'B1 a request made 1 second before 1 July Bangkok belongs to the previous academic year -> new request allowed');
update public.resident_assessment_requests set status = 'cancelled' where resident_id = t.uid('r1') and template_id = t.tpl('EPA-1') and status = 'pending';
update public.resident_assessment_requests set submitted_at = t.ay_start_at() where id = (select v from ctx where k='a1');
select t.expect_error($$select t.submit('r1','EPA-1','s2')$$, 'already requested this academic year', 'B2 a request made exactly at 00:00 on 1 July counts for the new academic year');

-- ===== C. lifetime limit 3 (+ Admin extra attempt)
insert into ctx values ('c1', t.submit('r2', 'EPA-3', 's1'));  select t.complete('s1', (select v from ctx where k='c1'), 'L3'); select t.shift_years((select v from ctx where k='c1'), 3);
insert into ctx values ('c2', t.submit('r2', 'EPA-3', 's2'));  select t.complete('s2', (select v from ctx where k='c2'), 'L3'); select t.shift_years((select v from ctx where k='c2'), 2);
insert into ctx values ('c3', t.submit('r2', 'EPA-3', 's3'));  select t.complete('s3', (select v from ctx where k='c3'), 'L3'); select t.shift_years((select v from ctx where k='c3'), 1);
select t.as_user('r2');
select t.ok((select attempts_used = 3 and attempts_cap = 3 and attempts_this_year = 0 and not met from public.get_my_epa_progress() where template_code = 'EPA-3'), 'C0 progress shows 3 of 3 used, none this year, level not reached');
select t.expect_error($$select t.submit('r2','EPA-3','s1')$$, 'attempt limit reached', 'C1 a 4th attempt on EPA 3 is blocked even in a new academic year');
select t.expect_error($$select public.admin_grant_resident_extra_attempt(t.uid('r2'), t.tpl('EPA-3'), 'x')$$, 'Active Admin|reason', 'C2 only an Admin can grant (and a reason is required)');
select t.as_user('adm');
select t.expect_error($$select public.admin_grant_resident_extra_attempt(t.uid('r2'), t.tpl('EPA-3'), 'ok')$$, 'reason of 5-500', 'C3 a too-short reason is refused');
select t.expect_error($$select public.admin_grant_resident_extra_attempt(t.uid('r2'), t.tpl('EPA-8'), 'EPA 8 is unlimited')$$, 'no attempt limit to extend', 'C4 forms without a limit cannot be extended');
select t.ok(public.admin_grant_resident_extra_attempt(t.uid('r2'), t.tpl('EPA-3'), 'Course director approved one more try') is not null, 'C5 Admin grants one extra attempt with a reason');
select t.ok(t.submit('r2', 'EPA-3', 's1') is not null, 'C6 after the grant the 4th attempt is allowed');

-- ===== D. EPA 7 forms: a single attempt each
insert into ctx values ('d1', t.submit('r1', 'EPA-7-L1-L2', 's1')); select t.complete('s1', (select v from ctx where k='d1'), 'F'); select t.shift_years((select v from ctx where k='d1'), 1);
select t.expect_error($$select t.submit('r1','EPA-7-L1-L2','s2')$$, 'attempt limit reached', 'D1 EPA 7 (L1-L2) is limited to one attempt in total');
select t.ok(t.submit('r1', 'EPA-7-L3', 's2') is not null, 'D2 the other EPA 7 form is separate');

-- ===== E. PBA topics are never repeated; cancelling frees the topic
insert into ctx values ('e1', t.submit('r2', 'PBA-01', 's1'));
select t.expect_error($$select t.submit('r2','PBA-01','s2')$$, 'pending request', 'E1 a second PBA-01 while pending is blocked');
select t.complete('s1', (select v from ctx where k='e1'), 'M');
select t.expect_error($$select t.submit('r2','PBA-01','s2')$$, 'PBA topic was already requested', 'E2 the same PBA topic cannot be requested again');
select t.ok(t.submit('r2', 'PBA-02', 's1') is not null, 'E3 a different PBA topic is fine (no per-year number limit)');
select t.as_user('r2'); select public.cancel_resident_assessment_request((select id from public.resident_assessment_requests where resident_id = t.uid('r2') and template_id = t.tpl('PBA-02') and status = 'pending'));
select t.ok(t.submit('r2', 'PBA-02', 's1') is not null, 'E4 after cancelling, the topic can be requested again');
select t.as_user('r2');
select t.expect_error(format($q$select public.submit_resident_assessment_request(%L, %L, current_date, '', 'x', null, null, '[]'::jsonb)$q$, t.tpl('PBA-03'), t.uid('s1')), 'Every self-assessment criterion', 'E5 PBA still needs the self-assessment (existing rule kept)');

-- ===== F. cancelled requests never count
insert into ctx values ('f1', t.submit('r1', 'EPA-4', 's1'));
select t.as_user('r1'); select public.cancel_resident_assessment_request((select v from ctx where k='f1'));
select t.ok(t.submit('r1', 'EPA-4', 's1') is not null, 'F1 a cancelled request does not use the yearly limit');

-- ===== G. Staff availability
select t.as_user('s2');
select t.expect_error($$select public.set_my_resident_staff_availability(current_date - 1)$$, 'in the past', 'G1 a past date is refused');
select t.expect_error($$select public.set_my_resident_staff_availability(current_date + 400)$$, 'too far ahead', 'G2 more than a year ahead is refused');
select public.set_my_resident_staff_availability((clock_timestamp() at time zone 'Asia/Bangkok')::date + 5);
select t.expect_error($$select t.submit('r1','EPA-5','s2')$$, 'not accepting assessments until', 'G3 a request to an unavailable Staff is refused');
select t.ok(t.submit('r1', 'EPA-5', 's3') is not null, 'G4 another Staff is fine');
select t.as_user('r1');
select t.ok((select unavailable_until = (clock_timestamp() at time zone 'Asia/Bangkok')::date + 5 from public.list_registered_resident_staff() where user_id = t.uid('s2')) and (select unavailable_until is null from public.list_registered_resident_staff() where user_id = t.uid('s1')), 'G5 residents see who is unavailable (and until when) in the Staff list');
select t.expect_error($$select public.set_my_resident_staff_availability(current_date + 3)$$, 'Active Staff role required', 'G6 a Resident cannot set availability');
select t.as_user('s2'); select public.set_my_resident_staff_availability(null);
select t.ok(t.submit('r1', 'EPA-6', 's2') is not null, 'G7 after the Staff clears the period, requests are accepted again');
update public.resident_staff_availability set unavailable_until = current_date - 10 where staff_id = t.uid('s2');
select t.as_user('r1');
select t.ok((select unavailable_until is null from public.list_registered_resident_staff() where user_id = t.uid('s2')), 'G8 an expired period is not shown');

-- ===== H. assessments recorded by an Admin (historical) count toward the limits
create function t.hist(p_resident text, p_code text, p_staff text, p_date date, p_score text) returns uuid language plpgsql as $$
declare v_t uuid := t.tpl(p_code); v_out text;
begin
  perform t.as_user('adm');
  select outcome_options->>0 into v_out from public.resident_template_definitions where id = v_t;
  return public.admin_record_historical_resident_assessment(v_t, t.uid(p_resident), t.uid(p_staff), p_date, '', 'old record', v_out, '', t.scores(v_t, p_score));
end $$;
select t.hist('r2', 'EPA-5', 's1', ((clock_timestamp() at time zone 'Asia/Bangkok')::date - 400), 'L3');
select t.ok(t.submit('r2', 'EPA-5', 's2') is not null, 'H1 a historical assessment from an earlier year does not block this year');
select t.as_user('r2'); select t.ok((select attempts_used = 2 from public.get_my_epa_progress() where template_code = 'EPA-5'), 'H2 progress counts the historical assessment + the new request');
select t.hist('r2', 'EPA-6', 's1', (clock_timestamp() at time zone 'Asia/Bangkok')::date - 1, 'L3');
select t.expect_error($$select t.submit('r2','EPA-6','s2')$$, 'already requested this academic year', 'H3 a historical assessment dated in this academic year uses the yearly limit');
select t.hist('r1', 'EPA-2', 's1', (clock_timestamp() at time zone 'Asia/Bangkok')::date - 800, 'L3');
select t.hist('r1', 'EPA-2', 's2', (clock_timestamp() at time zone 'Asia/Bangkok')::date - 500, 'L3');
select t.as_user('r1'); select t.ok((select attempts_used from public.get_my_epa_progress() where template_code = 'EPA-2') = 3, 'H5 r1 has 3 EPA 2 attempts (2 historical + 1 request)');
select t.complete('s1', (select id from public.resident_assessment_requests where resident_id = t.uid('r1') and template_id = t.tpl('EPA-2') and status = 'pending'), 'L3');
select t.shift_years((select id from public.resident_assessment_requests where resident_id = t.uid('r1') and template_id = t.tpl('EPA-2')), 1);
select t.as_user('r1');
select t.expect_error($$select t.submit('r1','EPA-2','s3')$$, 'attempt limit reached', 'H6 historical attempts count toward the lifetime limit');

-- ===== I. "reached the level" = EVERY criterion at L4/L5 in one assessment (M/E for the F/M/E forms)
select t.as_user('r1');
insert into ctx values ('i1', (select id from public.resident_assessment_requests where resident_id = t.uid('r1') and template_id = t.tpl('EPA-6') and status = 'pending'));
select t.complete_mixed('s2', (select v from ctx where k='i1'),
  (select jsonb_agg(jsonb_build_object('criterionId', id, 'score', case when sort_order = 1 then 'L3' when sort_order = 2 then 'L2' else 'L5' end, 'comment', '') order by sort_order)
     from public.resident_template_criteria where template_id = t.tpl('EPA-6') and active));
select t.as_user('r1');
select t.ok((select not met from public.get_my_epa_progress() where template_code = 'EPA-6'), 'I1 one or two criteria below L4 -> the assessment does NOT reach the level');
select t.ok((select jsonb_array_length(latest_below) = 2 and latest_below->0->>'score' = 'L3' and latest_below->1->>'score' = 'L2' from public.get_my_epa_progress() where template_code = 'EPA-6'), 'I2 the criteria still below L4 are listed with their scores (for the Resident to see)');
-- EPA 4 (r1): the pending request from test F1 is completed with every criterion at L4
insert into ctx values ('i2', (select id from public.resident_assessment_requests where resident_id = t.uid('r1') and template_id = t.tpl('EPA-4') and status = 'pending'));
select t.complete('s1', (select v from ctx where k='i2'), 'L4');
select t.as_user('r1');
select t.ok((select met and latest_below = '[]'::jsonb from public.get_my_epa_progress() where template_code = 'EPA-4'), 'I4 all criteria L4 -> reached; nothing below L4');
-- F/M/E form (EPA 7 L3)
insert into ctx values ('i3', (select id from public.resident_assessment_requests where resident_id = t.uid('r1') and template_id = t.tpl('EPA-7-L3') and status = 'pending'));
select t.complete_mixed('s2', (select v from ctx where k='i3'),
  (select jsonb_agg(jsonb_build_object('criterionId', id, 'score', case when sort_order = 1 then 'F' else 'E' end, 'comment', '') order by sort_order)
     from public.resident_template_criteria where template_id = t.tpl('EPA-7-L3') and active));
select t.as_user('r1');
select t.ok((select not met and latest_below->0->>'score' = 'F' from public.get_my_epa_progress() where template_code = 'EPA-7-L3'), 'I5 EPA 7: one F among M/E -> not reached');
select t.ok((select counts_for_board is false and attempts_cap is null from public.get_my_epa_progress() where template_code = 'EPA-8'), 'I6 EPA 8 is not counted for the board and has no limit');
select t.ok((select count(*) = 9 from public.get_my_epa_progress()), 'I7 all 9 EPA forms are returned (8 board forms + EPA 8)');
select t.as_user('r2'); select t.ok((select attempts_used = 1 and not met from public.get_my_epa_progress() where template_code = 'EPA-1'), 'I8 a Resident only ever sees their own progress');
select t.as_user('s1'); select t.expect_error($$select * from public.get_my_epa_progress()$$, 'Active Resident role required', 'I9 progress is for Residents only');

-- ===== K. privileges
select t.ok(not has_function_privilege('anon', 'public.get_my_epa_progress()', 'execute') and not has_function_privilege('anon', 'public.set_my_resident_staff_availability(date)', 'execute') and not has_function_privilege('anon', 'public.admin_grant_resident_extra_attempt(uuid,uuid,text)', 'execute') and not has_function_privilege('anon', 'public.list_registered_resident_staff()', 'execute') and not has_function_privilege('anon', 'public.submit_resident_assessment_request(uuid,uuid,date,text,text,text,text,jsonb)', 'execute'), 'K1 nobody who is not logged in can call any of the functions');
select t.ok(has_function_privilege('authenticated', 'public.get_my_epa_progress()', 'execute') and has_function_privilege('authenticated', 'public.submit_resident_assessment_request(uuid,uuid,date,text,text,text,text,jsonb)', 'execute'), 'K2 logged-in users can call them (each checks its own role inside)');
select t.ok(not has_table_privilege('authenticated', 'public.resident_staff_availability', 'select') and not has_table_privilege('authenticated', 'public.resident_attempt_grants', 'select') and not has_table_privilege('authenticated', 'public.resident_staff_availability', 'insert') and not has_table_privilege('anon', 'public.resident_attempt_grants', 'select'), 'K3 the two new tables cannot be read or written directly');
select t.ok((select relrowsecurity from pg_class where oid = 'public.resident_staff_availability'::regclass) and (select relrowsecurity from pg_class where oid = 'public.resident_attempt_grants'::regclass), 'K4 row level security is on for both new tables');

-- ===== L. existing checks still in place
select t.as_user('r1');
select t.expect_error(format($q$select public.submit_resident_assessment_request(%L, %L, current_date + 3, '', 'x', null, null, '[]'::jsonb)$q$, t.tpl('EPA-8'), t.uid('s1')), 'date is invalid', 'L1 a future activity date is refused (existing rule kept)');
select t.expect_error(format($q$select public.submit_resident_assessment_request(%L, %L, current_date, '', 'x', null, null, '[]'::jsonb)$q$, t.tpl('EPA-8'), t.uid('r2')), 'active registered Staff', 'L2 a non-Staff cannot be chosen (existing rule kept)');
select t.ok(t.submit('r1', 'EPA-8', 's1') is not null, 'L3 EPA 8 can be requested (no limit)');
select t.as_user('r1'); select public.cancel_resident_assessment_request((select id from public.resident_assessment_requests where resident_id = t.uid('r1') and template_id = t.tpl('EPA-8') and status = 'pending'));
select t.ok(t.submit('r1', 'EPA-8', 's1') is not null, 'L4 EPA 8 can be requested again right after (unlimited)');

do $$ begin raise notice 'ALL BEHAVIOUR TESTS PASSED'; end $$;
rollback;
