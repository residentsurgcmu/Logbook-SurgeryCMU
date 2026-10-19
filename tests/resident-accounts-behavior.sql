-- Behaviour tests for RC-02a-1 accounts piece 1 (migration 20261018090000).
-- Run ONLY on a throwaway local database that has all migrations applied (it refuses if any Resident data exists).
-- Everything happens inside one transaction that is rolled back at the end, so nothing is left behind.
--   psql -v ON_ERROR_STOP=1 -f tests/resident-accounts-behavior.sql
-- Concurrency cases (two sessions at once) are in tests/resident-accounts-concurrency.sh.
begin;
do $$ begin
  if exists (select 1 from public.resident_profiles) then
    raise exception 'Refusing to run: this database already has Resident data (use an empty throwaway database)';
  end if;
end $$;

-- The migration leaves account writes paused (release safety); open them inside this rolled-back transaction.
update public.resident_maintenance_pause set paused = false where scope = 'accounts';

create schema t;
create table t.users (name text primary key, id uuid not null default gen_random_uuid());
create table t.ctx (k text primary key, v uuid);
create function t.uid(p_name text) returns uuid language sql as $$ select id from t.users where name = p_name $$;
create function t.v(p_key text) returns uuid language sql as $$ select v from t.ctx where k = p_key $$;
create function t.as_user(p_name text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(t.uid(p_name)::text, ''), true) $$;
create function t.tpl(p_code text) returns uuid language sql as $$ select id from public.resident_template_definitions where template_code = p_code $$;
create function t.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'FAIL %', p_label; end if; raise notice 'PASS %', p_label; end $$;
-- run SQL as a logged-in browser user (role authenticated) and return one jsonb value
create function t.q(p_user text, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform t.as_user(p_user);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  return v;
end $$;
-- expect an error matching p_pattern when p_sql runs as p_user with role authenticated
create function t.err(p_user text, p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
declare v_msg text;
begin
  perform t.as_user(p_user);
  begin
    set local role authenticated;
    execute p_sql;
  exception when others then get stacked diagnostics v_msg = message_text;
  end;
  reset role;
  if v_msg is null then raise exception 'FAIL % : expected an error matching "%" but the call succeeded', p_label, p_pattern; end if;
  if v_msg !~* p_pattern then raise exception 'FAIL % : expected "%" but got "%"', p_label, p_pattern, v_msg; end if;
  raise notice 'PASS %', p_label;
end $$;
create function t.denied(p_role text, p_sql text, p_label text) returns void language plpgsql as $$
declare v_denied boolean := false;
begin
  execute format('set local role %I', p_role);
  begin execute p_sql; exception when insufficient_privilege then v_denied := true; end;
  reset role;
  if not v_denied then raise exception 'FAIL % : expected "permission denied" for role %', p_label, p_role; end if;
  raise notice 'PASS %', p_label;
end $$;
create function t.scores(p_template uuid, p_score text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('criterionId', id, 'score', p_score, 'comment', '') order by sort_order), '[]'::jsonb)
  from public.resident_template_criteria where template_id = p_template and active $$;
create function t.submit(p_resident text, p_code text, p_staff text) returns uuid language plpgsql as $$
declare v_t uuid := t.tpl(p_code); v_req boolean; v_out jsonb;
begin
  perform t.as_user(p_resident);
  select requires_self_assessment, outcome_options into v_req, v_out from public.resident_template_definitions where id = v_t;
  return public.submit_resident_assessment_request(v_t, t.uid(p_staff), (clock_timestamp() at time zone 'Asia/Bangkok')::date,
    'ctx', 'activity ' || p_code, case when v_req then v_out->>0 end, case when v_req then 'self' end,
    case when v_req then t.scores(v_t, (select score_options->>1 from public.resident_template_definitions where id = v_t)) else '[]'::jsonb end);
end $$;
create function t.complete(p_staff text, p_request uuid) returns uuid language plpgsql as $$
declare v_t uuid; v_out text; v_score text;
begin
  perform t.as_user(p_staff);
  select r.template_id into v_t from public.resident_assessment_requests r where r.id = p_request;
  select outcome_options->>0, score_options->>0 into v_out, v_score from public.resident_template_definitions where id = v_t;
  return public.complete_resident_assessment_request(p_request, v_out, '', t.scores(v_t, v_score));
end $$;
create function t.updated_at(p_name text) returns timestamptz language sql as $$ select updated_at from public.resident_profiles where user_id = t.uid(p_name) $$;
create function t.edit(p_actor text, p_target text, p_changes jsonb, p_reason text default null, p_request uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
begin
  return t.q(p_actor, format('select public.admin_update_account(%L::uuid, %L::timestamptz, %L::uuid, %L::jsonb, %L)',
    t.uid(p_target), t.updated_at(p_target), p_request, p_changes, p_reason));
end $$;
create function t.preview(p_actor text, p_target text, p_action text) returns jsonb language plpgsql as $$
begin return t.q(p_actor, format('select public.admin_preview_account_action(%L::uuid, %L)', t.uid(p_target), p_action)); end $$;
create function t.set_active(p_actor text, p_target text, p_active boolean, p_counts jsonb default null, p_reason text default 'test reason', p_request uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
begin
  return t.q(p_actor, format('select public.admin_set_account_active(%L::uuid, %L, %L::timestamptz, %L::uuid, %L, %L::jsonb)',
    t.uid(p_target), p_active, t.updated_at(p_target), p_request, p_reason, p_counts));
end $$;
create function t.count_as(p_user text, p_sql text) returns bigint language plpgsql as $$
begin return (t.q(p_user, format('select to_jsonb((%s))', p_sql)))::text::bigint; end $$;
create function t.rows_as(p_user text, p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform t.as_user(p_user);
  set local role authenticated;
  execute p_sql;
  get diagnostics v = row_count;
  reset role;
  return v;
end $$;
grant usage on schema t to authenticated, anon, service_role;
grant select on all tables in schema t to authenticated, anon, service_role;
grant execute on all functions in schema t to authenticated, anon, service_role;

-- people: 2 Admins, 3 Staff (s3 is the "non-Resident with a PGY" found on production), 3 Residents
insert into t.users(name) values ('adm'),('adm2'),('s1'),('s2'),('s3'),('r1'),('r2'),('r3');
insert into auth.users(id, email) select id, name || '@example.test' from t.users;
insert into public.resident_profiles(user_id, full_name, email, pgy, active)
  select id, 'Test ' || name, name || '@example.test',
         case when name like 'r%' then 2 when name = 's3' then 2 end, true from t.users;
insert into public.resident_user_roles(user_id, role, active)
  select id, case when name like 'r%' then 'resident'::public.resident_system_role when name like 's%' then 'staff' else 'admin' end, true from t.users;
insert into public.resident_staff_directory(email, full_name, unit_name, active, auth_user_id)
  select name || '@example.test', 'Test ' || name, 'Unit ' || name, true, id from t.users where name like 's%';
insert into public.resident_evaluator_assignments(evaluator_id, resident_id, assigned_by, active)
  values (t.uid('s1'), t.uid('r1'), t.uid('adm'), true);

-- history that must never change: s1 evaluated r1 once (resident_pgy snapshot = 2)
insert into t.ctx values ('done', t.complete('s1', t.submit('r1', 'EPA-1', 's1')));

-- ===== P. privileges after the migration (spec 2.5, AC 8, required test 8.6)
select t.denied('authenticated', $$insert into public.resident_profiles(user_id, full_name, email, pgy, active) values (gen_random_uuid(), 'xx', 'x@example.test', 1, true)$$, 'P1 browser cannot insert a profile');
select t.denied('authenticated', $$update public.resident_profiles set pgy = 4$$, 'P2 browser cannot update profiles (even as Admin)');
select t.denied('authenticated', $$delete from public.resident_profiles$$, 'P3 browser cannot delete profiles');
select t.denied('authenticated', $$update public.resident_user_roles set role = 'admin'$$, 'P4 browser cannot change roles');
select t.denied('authenticated', $$delete from public.resident_user_roles$$, 'P5 browser cannot delete roles');
select t.denied('anon', $$select 1 from public.resident_profiles$$, 'P6 logged-out visitor cannot read profiles');
select t.denied('authenticated', $$select 1 from public.resident_account_events$$, 'P7 audit table is not readable directly');
select t.ok((select bool_and(not has_table_privilege(r, c, p))
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.resident_profiles','public.resident_user_roles']) c,
       unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p), 'P8 effective table privileges: no write of any kind for anon/authenticated (incl. TRUNCATE/TRIGGER/REFERENCES)');
select t.ok(has_table_privilege('authenticated', 'public.resident_profiles', 'SELECT') and has_table_privilege('authenticated', 'public.resident_user_roles', 'SELECT')
  and not has_table_privilege('anon', 'public.resident_profiles', 'SELECT') and not has_table_privilege('anon', 'public.resident_user_roles', 'SELECT'), 'P9 only authenticated SELECT remains');
select t.ok((select count(*) = 0 from information_schema.column_privileges
  where table_schema = 'public' and table_name in ('resident_profiles', 'resident_user_roles')
    and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE', 'REFERENCES')), 'P10 no column-level write privilege left');
select t.ok((select count(*) = 0 from pg_policies where schemaname = 'public' and tablename in ('resident_profiles', 'resident_user_roles') and cmd <> 'SELECT'), 'P11 no write policy left on the two account tables');
select t.ok(not has_function_privilege('authenticated', 'public.admin_provision_account_internal(uuid,uuid,text,text,text,smallint,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_provision_account_internal(uuid,uuid,text,text,text,smallint,text)', 'execute')
  and has_function_privilege('service_role', 'public.admin_provision_account_internal(uuid,uuid,text,text,text,smallint,text)', 'execute'), 'P12 provision RPC is service-role only');
select t.ok((select bool_and(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'))
  from unnest(array['public.admin_list_accounts()', 'public.admin_preview_account_action(uuid,text)',
    'public.admin_update_account(uuid,timestamptz,uuid,jsonb,text)', 'public.admin_set_account_active(uuid,boolean,timestamptz,uuid,text,jsonb)',
    'public.admin_list_account_events(uuid)']) f), 'P13 Admin RPCs: authenticated may call (checked inside), anon may not');
select t.ok((select bool_and(not has_function_privilege('authenticated', f, 'execute'))
  from unnest(array['private.resident_account_lock(uuid,uuid)', 'private.resident_account_replay(uuid,uuid,text[])',
    'private.resident_account_pending_requests(uuid)', 'private.resident_account_is_active_admin(uuid)']) f), 'P14 internal helpers are not callable from the browser');
select t.ok((select count(*) = 2 from pg_constraint where conrelid = 'public.resident_profiles'::regclass
  and ((contype = 'u' and pg_get_constraintdef(oid) ilike 'UNIQUE (email)') or (contype = 'c' and pg_get_constraintdef(oid) ilike '%email = lower(email)%'))), 'P15 the existing email constraints are present and were not duplicated');

-- ===== C. completeness of spec 2.6 (every write path and every authenticated-callable function has an account guard)
select t.ok((select count(*) = 0 from pg_policies
  where schemaname = 'public' and tablename like 'resident\_%' and cmd in ('INSERT','UPDATE','DELETE','ALL')
    and coalesce(qual, '') || coalesce(with_check, '') !~ 'resident_role_is|resident_account_active|resident_case_member|resident_can_edit_case'), 'C1 every write policy on resident tables checks an active account');
select t.ok((select count(*) = 0 from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname like 'resident\_%' and cmd in ('INSERT','UPDATE','DELETE','ALL')
    and coalesce(qual, '') || coalesce(with_check, '') !~ 'resident_role_is|resident_account_active|resident_case_member|resident_can_edit_case'), 'C2 every write policy on Resident storage buckets checks an active account');
-- C3: every function in public AND private that anon or authenticated can execute (DEFINER or INVOKER,
-- grants through PUBLIC or inherited roles included — has_function_privilege covers both) is in exactly one
-- known class; anything unclassified fails the test.
create temp table fn_class as
select n.nspname as schema, p.proname as fn, p.prosecdef as definer, pg_get_userbyid(p.proowner) as owner,
  case
    when p.prorettype = 'trigger'::regtype then 'trigger function (cannot be called directly)'
    when n.nspname = 'private' and p.proname in ('resident_role_is','resident_account_active','resident_case_member','resident_can_evaluate',
         'resident_can_edit_case','resident_can_grant_extra_attempts','resident_can_view_cohort_progress','resident_can_configure_seat_map',
         'resident_can_manage_seat_map','resident_can_review_seat_requests','resident_can_view_seat_report','resident_can_manage_conference')
      then 'guard helper (checks the caller''s active account)'
    when n.nspname = 'private' and p.proname in ('resident_academic_year_start','resident_exam_parse_number','resident_case_path_case_id')
      then 'pure helper (no table access)'
    when n.nspname = 'private' and p.proname in ('resident_exam_is_published','resident_is_exam_participant','resident_case_media_path_live','resident_case_media_path_used')
      then 'boolean helper used inside guarded policies (returns true/false only)'
    when n.nspname = 'private' and p.proname in ('current_user_role','is_admin','is_staff','is_active_staff','is_active_staff_email','is_selected_staff',
         'is_active_enrollment','staff_can_access_curriculum','staff_can_access_enrollment','staff_can_access_student')
      then 'legacy helper (retired Year 4/Breast tables; boolean/role only; private schema)'
    when n.nspname = 'public' and p.proname in ('resident_accounts_paused', 'resident_account_direct_writes_blocked') then 'pause status (boolean only)'
    when pg_get_functiondef(p.oid) ~ 'resident_role_is|resident_account_active|resident_case_member|resident_can_[a-z_]+|resident_seat_context|resident_seat_actor|r\.user_id = auth\.uid\(\) and r\.active and p\.active|private\.rc04_require_admin\(\)'
      then 'guarded function'
    else 'UNCLASSIFIED' end as class
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') and p.prokind in ('f','p')
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
select t.ok((select coalesce(string_agg(schema || '.' || fn, ', '), '') = '' from fn_class where class = 'UNCLASSIFIED'), 'C3 every browser-callable function in public/private is classified (guarded, guard/pure/boolean helper, trigger, or legacy helper)');
select t.ok((select bool_and(owner = 'postgres') from fn_class), 'C3b every browser-callable function is owned by postgres');
select t.ok((select count(*) = 0 from fn_class where schema = 'public' and class not in ('guarded function', 'trigger function (cannot be called directly)', 'pause status (boolean only)')), 'C3c every browser-callable PUBLIC-schema function is guarded');
select t.ok(pg_get_functiondef('private.resident_role_is'::regproc) ~ 'p\.active' and pg_get_functiondef('private.resident_can_evaluate'::regproc) ~ 'resident_account_active', 'C4 role check and evaluate check now require both flags');

-- ===== E. edit (spec 2.1, AC 1)
select t.err('r1', $$select public.admin_list_accounts()$$, 'Active Admin account required', 'E1 a Resident cannot list accounts');
select t.ok(t.count_as('adm', 'select count(*) from public.admin_list_accounts()') = 8, 'E2 Admin lists every account');
select t.ok((t.edit('adm', 'r1', '{"full_name":"Test r1 renamed"}')->>'changed')::boolean, 'E3 edit one field');
select t.ok((select full_name = 'Test r1 renamed' and pgy = 2 from public.resident_profiles where user_id = t.uid('r1')), 'E4 only the field sent changed (PGY untouched)');
select t.ok((select count(*) = 1 and bool_and(changes ? 'full_name' and not changes ? 'pgy') from public.resident_account_events where target_id = t.uid('r1') and action = 'account.updated'), 'E5 audit records before/after of that field only');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"full_name":"stale tab"}'::jsonb)$$, t.uid('r1'), t.updated_at('r1') - interval '1 second'), 'ACCOUNT_CONFLICT', 'E6 stale tab gets ACCOUNT_CONFLICT');
select t.ok((select full_name = 'Test r1 renamed' from public.resident_profiles where user_id = t.uid('r1')), 'E7 the stale edit wrote nothing');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"pgy":3}'::jsonb)$$, t.uid('r1'), t.updated_at('r1')), 'reason is required', 'E8 PGY change needs a reason');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"pgy":5}'::jsonb, 'x')$$, t.uid('r1'), t.updated_at('r1')), 'PGY must be 1-4', 'E9 PGY outside 1-4 is refused');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"pgy":"3"}'::jsonb, 'x')$$, t.uid('r1'), t.updated_at('r1')), 'PGY must be 1-4', 'E10 PGY must be a number');
select t.ok((t.edit('adm', 'r1', '{"pgy":3}', 'repeat year correction')->>'changed')::boolean, 'E11 PGY change with a reason');
select t.ok((select resident_pgy = 2 from public.resident_assessments where id = t.v('done')), 'E12 PGY change does not touch assessment history (resident_pgy snapshot stays 2)');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"pgy":2}'::jsonb, 'x')$$, t.uid('s1'), t.updated_at('s1')), 'ROLE_RULE', 'E13 PGY on Staff is refused');
select t.ok((t.edit('adm', 's1', '{"full_name":"Test s1 renamed"}')->>'changed')::boolean, 'E14 Staff name edit');
select t.ok((select p.full_name = 'Test s1 renamed' and d.full_name = 'Test s1 renamed' from public.resident_profiles p join public.resident_staff_directory d on d.auth_user_id = p.user_id where p.user_id = t.uid('s1')), 'E15 Staff name changed in both tables');
select t.ok((t.edit('adm', 's1', '{"unit_name":"Unit new"}')->>'changed')::boolean, 'E16a Staff unit edit');
select t.ok((select unit_name = 'Unit new' from public.resident_staff_directory where auth_user_id = t.uid('s1')), 'E16b unit changed in the Staff list');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"unit_name":"Unit x"}'::jsonb)$$, t.uid('r1'), t.updated_at('r1')), 'ROLE_RULE', 'E17 unit on a Resident is refused');
select t.ok((t.edit('adm', 'adm2', '{"admin_tag":"Admin รอง"}')->>'changed')::boolean, 'E18a admin tag edit');
select t.ok((select admin_tag = 'Admin รอง' from public.resident_user_roles where user_id = t.uid('adm2')), 'E18b admin tag saved');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"admin_tag":"x"}'::jsonb)$$, t.uid('s2'), t.updated_at('s2')), 'ROLE_RULE', 'E19 admin tag on Staff is refused');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"email":"new@example.test"}'::jsonb)$$, t.uid('r2'), t.updated_at('r2')), 'cannot be changed here', 'E20 email cannot be changed here');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"role":"admin"}'::jsonb)$$, t.uid('r2'), t.updated_at('r2')), 'cannot be changed here', 'E21 role cannot be changed here');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"active":false}'::jsonb)$$, t.uid('r2'), t.updated_at('r2')), 'cannot be changed here', 'E22 active cannot be changed through edit');
select t.err('r2', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"full_name":"self service"}'::jsonb)$$, t.uid('r2'), t.updated_at('r2')), 'Active Admin account required', 'E23 a Resident cannot edit, not even themselves (D-008)');
select t.err('s2', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"full_name":"self service"}'::jsonb)$$, t.uid('s2'), t.updated_at('s2')), 'Active Admin account required', 'E24 a Staff cannot edit');
-- the production data case: a non-Resident with a PGY is cleaned only when an Admin saves that account
-- G0 B-R01: only the fields sent change. The production case (a non-Resident that still has a PGY) stays as it is.
select t.ok((select pgy = 2 from public.resident_profiles where user_id = t.uid('s3')), 'E25 untouched non-Resident PGY is left alone by the migration');
select t.ok((t.edit('adm', 's3', '{"full_name":"Test s3 saved"}')->>'changed')::boolean, 'E26 saving that Staff account name works');
select t.ok((select pgy = 2 and full_name = 'Test s3 saved' from public.resident_profiles where user_id = t.uid('s3'))
  and (select bool_and(not changes ? 'pgy') from public.resident_account_events where target_id = t.uid('s3')), 'E27 name edit did not change the PGY (and the audit shows only the name)');
select t.ok((t.edit('adm', 's3', '{}')->>'changed')::boolean = false and (select pgy = 2 from public.resident_profiles where user_id = t.uid('s3')), 'E27b changes = {} writes nothing and keeps the PGY');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"pgy":null}'::jsonb, 'x')$$, t.uid('s3'), t.updated_at('s3')), 'ROLE_RULE', 'E27c the PGY of a non-Resident cannot be edited here (not part of piece 1)');
select t.ok((select r.admin_tag is null and d.unit_name = 'Unit s3' from public.resident_user_roles r join public.resident_staff_directory d on d.auth_user_id = r.user_id where r.user_id = t.uid('s3')), 'E27d fields not sent (unit, admin tag) are unchanged');
insert into t.ctx values ('req_e', gen_random_uuid());
select t.ok((t.edit('adm', 'r2', '{"full_name":"Test r2 once"}', null, t.v('req_e'))->>'changed')::boolean, 'E28 first call with a request id');
select t.ok((t.q('adm', format($$select public.admin_update_account(%L, %L, %L, '{"full_name":"Test r2 twice"}'::jsonb)$$, t.uid('r2'), t.updated_at('r2'), t.v('req_e')))->>'replayed')::boolean
  and (select full_name = 'Test r2 once' from public.resident_profiles where user_id = t.uid('r2'))
  and (select count(*) = 1 from public.resident_account_events where request_id = t.v('req_e')), 'E29 same request id again = first result, nothing written twice');
select t.err('adm', format($$select public.admin_set_account_active(%L, false, %L, %L, 'x', '{}'::jsonb)$$, t.uid('r2'), t.updated_at('r2'), t.v('req_e')), 'already used for another action', 'E30 a request id cannot be reused for another action');
select t.ok((t.edit('adm', 'r2', '{"full_name":"Test r2 once"}')->>'changed')::boolean = false
  and (select count(*) = 1 from public.resident_account_events where target_id = t.uid('r2')), 'E31 saving with no real change writes nothing');

-- ===== D. deactivate (spec 2.2, D-009, D-021, AC 2)
insert into t.ctx values ('p_r1', t.submit('r1', 'EPA-2', 's1'));
insert into t.ctx values ('p_r2', t.submit('r2', 'EPA-1', 's1'));
insert into t.ctx values ('p_r2b', t.submit('r2', 'EPA-3', 's2'));
select t.ok((select count(*) = 2 from public.resident_notifications where request_id in (t.v('p_r1'), t.v('p_r2')) and notification_type = 'assessment_requested'), 'D0 Staff s1 has two "please evaluate" notifications');
create temp table pv as select t.preview('adm', 's1', 'deactivate') as j;
grant select on pv to authenticated;
select t.ok((select (j->>'pending_requests')::int = 2 and (j->>'pending_as_staff')::int = 2 and (j->>'active_assignments')::int = 1
  and j->'blockers' = '[]'::jsonb from pv), 'D1 preview: 2 pending requests, 1 assignment kept, no blockers');
select t.err('adm', format($$select public.admin_set_account_active(%L, false, %L, gen_random_uuid(), 'leaving', '{"pending_requests":1,"active_assignments":1}'::jsonb)$$, t.uid('s1'), t.updated_at('s1')), 'PREVIEW_CHANGED', 'D2 numbers differ from the preview => PREVIEW_CHANGED');
select t.ok((select active from public.resident_profiles where user_id = t.uid('s1')) and (select count(*) = 2 from public.resident_assessment_requests where id in (t.v('p_r1'), t.v('p_r2')) and status = 'pending'), 'D3 ... and nothing was written');
select t.err('adm', format($$select public.admin_set_account_active(%L, false, %L, gen_random_uuid(), '', (select j->'preview_counts' from pv))$$, t.uid('s1'), t.updated_at('s1')), 'reason is required', 'D4 a reason is required');
select t.err('adm', format($$select public.admin_set_account_active(%L, false, %L, gen_random_uuid(), %L, (select j->'preview_counts' from pv))$$, t.uid('s1'), t.updated_at('s1'), repeat('x', 301)), 'longer than 300', 'D5 reason longer than 300 is refused');
select t.ok((t.set_active('adm', 's1', false, (select j->'preview_counts' from pv))->>'cancelled_requests')::int = 2, 'D6 deactivate Staff s1');
select t.ok((select not r.active and not p.active from public.resident_user_roles r join public.resident_profiles p using (user_id) where user_id = t.uid('s1')), 'D7 both flags are off');
select t.ok((select count(*) = 2 from public.resident_assessment_requests where id in (t.v('p_r1'), t.v('p_r2')) and status = 'cancelled')
  and (select status = 'pending' from public.resident_assessment_requests where id = t.v('p_r2b')), 'D8 only the requests addressed to s1 were cancelled');
select t.ok((select count(*) = 0 from public.resident_notifications where request_id in (t.v('p_r1'), t.v('p_r2')) and notification_type in ('assessment_requested', 'assessment_reminder')), 'D9 their "please evaluate" notifications are gone');
select t.ok((select active from public.resident_evaluator_assignments where evaluator_id = t.uid('s1') and resident_id = t.uid('r1')), 'D10 assignment is kept (D-021)');
select t.ok((select count(*) = 1 and bool_and(reason = 'test reason' and jsonb_array_length(side_effects->'cancelled_request_ids') = 2 and (side_effects->>'kept_assignment_count')::int = 1
  and changes = '{"active": {"before": true, "after": false}}'::jsonb) from public.resident_account_events where target_id = t.uid('s1') and action = 'account.deactivated'), 'D11 audit: who, why, cancelled ids, kept assignments');
select t.ok((select status = 'completed' from public.resident_assessment_requests where assessment_id = t.v('done')), 'D12 a completed evaluation is never cancelled');
select t.ok(t.submit('r1', 'EPA-2', 's2') is not null, 'D13a the Resident can request the same form again from another Staff');
select t.ok((select attempt_number = 1 from public.resident_assessment_requests where resident_id = t.uid('r1') and template_id = t.tpl('EPA-2') and status = 'pending'), 'D13b the attempt was given back (new request is attempt 1 again)');
select t.err('adm', format($$select public.admin_set_account_active(%L, false, %L, gen_random_uuid(), 'x', '{"pending_requests":0,"active_assignments":0}'::jsonb)$$, t.uid('adm'), t.updated_at('adm')), 'SELF_ACTION_FORBIDDEN', 'D14 an Admin cannot deactivate themselves');
select t.err('adm', format($$select public.admin_set_account_active(%L, false, %L, gen_random_uuid(), 'x', '{"pending_requests":0,"active_assignments":1}'::jsonb)$$, t.uid('s1'), t.updated_at('s1')), 'already deactivated', 'D15 deactivating twice is refused');
select t.err('s2', format($$select public.admin_set_account_active(%L, false, %L, gen_random_uuid(), 'x', '{}'::jsonb)$$, t.uid('r3'), t.updated_at('r3')), 'Active Admin account required', 'D16 a Staff cannot deactivate anyone');

-- ===== A. a deactivated account can do nothing and cannot read other people's data (spec 2.6, AC 4, required test 8.5)
-- In the database a "token issued before deactivation" and a "fresh login after" are the same thing: auth.uid() = s1.
select t.ok(t.q('s1', 'select to_jsonb(private.resident_account_active())') = 'false'::jsonb and t.q('s1', $$select to_jsonb(private.resident_role_is('staff'))$$) = 'false'::jsonb, 'A1 s1: account and role checks are false');
select t.ok(t.count_as('s1', 'select count(*) from public.resident_assessments') = 0, 'A2 s1 cannot read assessments they gave');
select t.ok(t.count_as('s1', 'select count(*) from public.resident_assessment_scores') = 0, 'A3 s1 cannot read scores they gave');
select t.ok(t.count_as('s1', 'select count(*) from public.resident_assessment_requests') = 0, 'A4 s1 cannot read requests addressed to them');
select t.ok(t.count_as('s1', 'select count(*) from public.resident_self_assessment_scores') = 0, 'A5 s1 cannot read Residents'' self-assessments');
select t.ok(t.count_as('s1', 'select count(*) from public.resident_profiles') = 1, 'A6 s1 sees only their own profile (assignment / party paths closed)');
select t.ok(t.count_as('s1', 'select count(*) from public.resident_evaluator_assignments') = 0, 'A7 s1 cannot read assignments');
select t.err('s1', format($$select public.resolve_resident_assessment_qr(%L)$$, (select qr_token from public.resident_profiles where user_id = t.uid('r1'))), 'Active Staff account required', 'A8 s1 cannot resolve a Resident QR');
select t.err('s1', $$select public.set_my_resident_staff_availability(current_date + 3)$$, 'required', 'A9 s1 cannot set availability');
select t.err('s1', $$select public.list_resident_exam_records()$$, 'account required', 'A10 s1 cannot list exam records');
select t.err('s1', $$select * from public.list_resident_case_people()$$, 'account required', 'A11 s1 cannot list case people');
select t.err('s1', $$select * from public.list_resident_seat_sessions()$$, 'Active account required', 'A12 s1 cannot list seat sessions');
select t.ok(t.count_as('s1', $$select count(*) from public.resident_conference_sessions$$) = 0 and t.count_as('s1', $$select count(*) from public.resident_admission_cases$$) = 0, 'A13 s1 cannot read cases or conference data');
-- r3 is deactivated with nothing pending; then every Resident path is refused
select t.ok((t.set_active('adm', 'r3', false, (select t.preview('adm', 'r3', 'deactivate')->'preview_counts'))->>'changed')::boolean, 'A14 deactivate Resident r3');
select t.err('r3', format($$select public.submit_resident_assessment_request(%L, %L, current_date, '', 'x', null, null, '[]'::jsonb)$$, t.tpl('EPA-4'), t.uid('s2')), 'Active Resident role required', 'A15 r3 cannot submit a request');
select t.err('r3', $$select * from public.list_registered_resident_staff()$$, 'account required', 'A16 r3 cannot list Staff names');
select t.err('r3', $$select * from public.list_resident_counterpart_staff()$$, 'account required', 'A17 r3 cannot list their counterpart Staff');
select t.err('r3', $$select public.check_in_resident_round(gen_random_uuid())$$, 'account required', 'A18 r3 cannot check in');
select t.err('r3', $$select public.get_my_epa_progress()$$, 'Active Resident role required', 'A19 r3 cannot read progress through the RPC');
select t.ok(t.count_as('r3', 'select count(*) from public.resident_user_roles') = 1 and t.count_as('r3', 'select count(*) from public.resident_profiles') = 1, 'A20 own-row reads remain (accepted residual): the app can show "บัญชีถูกปิด"');
-- the deactivated Staff's own notifications: readable (own row, residual) but not writable
insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message) values (t.uid('s1'), t.v('p_r1'), 'assessment_completed', 't', 'm');
select t.ok(t.count_as('s1', $$select count(*) from public.resident_notifications$$) = (select count(*) from public.resident_notifications where recipient_id = t.uid('s1')), 'A21 own notifications still readable (residual)');
select t.ok(t.rows_as('s1', $$update public.resident_notifications set read_at = now()$$) = 0, 'A22 marking a notification read is refused for a deactivated account');
select t.ok(t.rows_as('r1', $$update public.resident_notifications set read_at = now()$$) = (select count(*) from public.resident_notifications where recipient_id = t.uid('r1')) and (select count(*) > 0 from public.resident_notifications where recipient_id = t.uid('r1')), 'A23 an active account can still mark its own notifications');
-- the cancel owner path (Q7): a Resident whose account is off cannot cancel their own request
update public.resident_profiles set active = false where user_id = t.uid('r2');  -- direct (superuser) to isolate the owner-path check
select t.err('r2', format($$select public.cancel_resident_assessment_request(%L)$$, t.v('p_r2b')), 'Only the Resident who sent this request or an Admin', 'A24 cancel owner path needs an active account');
update public.resident_profiles set active = true where user_id = t.uid('r2');
select t.ok((select status = 'pending' from public.resident_assessment_requests where id = t.v('p_r2b')), 'A25 ... and the request is still pending');
select t.q('r2', format($$select to_jsonb(public.cancel_resident_assessment_request(%L))$$, t.v('p_r2b')));
select t.ok((select status = 'cancelled' from public.resident_assessment_requests where id = t.v('p_r2b')), 'A26 an active owner still cancels normally');
-- an evaluation for a deactivated Resident is impossible: requests were cancelled; a direct try is refused
insert into t.ctx values ('p_r1b', t.submit('r1', 'EPA-3', 's2'));
select t.ok((t.set_active('adm', 'r1', false, (select t.preview('adm', 'r1', 'deactivate')->'preview_counts'))->>'cancelled_requests')::int = 2, 'A27 deactivating Resident r1 cancels both of their pending requests');
select t.err('s2', format($$select t.complete('s2', %L)$$, t.v('p_r1b')), 'no longer pending', 'A28 Staff cannot evaluate a cancelled request');

-- ===== R. reactivate (spec 2.3, AC 6, required test 8.9)
select t.ok((select (j->>'academic_year_warning')::boolean = false and j->>'role' = 'staff' from (select t.preview('adm', 's1', 'reactivate') j) x), 'R1 reactivate preview (no academic-year warning for Staff)');
select t.ok((t.set_active('adm', 's1', true)->>'changed')::boolean, 'R2 reactivate s1');
select t.ok((select r.active and p.active from public.resident_user_roles r join public.resident_profiles p using (user_id) where user_id = t.uid('s1')), 'R3 both flags back on');
select t.ok(t.count_as('s1', 'select count(*) from public.resident_assessments') = 1, 'R4 s1 sees the assessment they gave again (history unchanged)');
select t.ok(t.q('s1', format($$select to_jsonb(private.resident_can_evaluate(%L))$$, t.uid('r1'))) = 'true'::jsonb, 'R5 the kept assignment works again');
select t.ok((select resident_pgy = 2 from public.resident_assessments where id = t.v('done')) and (select count(*) = 1 from public.resident_assessments), 'R6 assessment history untouched');
select t.ok((select count(*) = 0 from public.resident_assessment_requests where status = 'cancelled' and id = t.v('done')), 'R7 reactivation does not un-cancel or re-create anything');
select t.ok((select count(*) = 1 from public.resident_account_events where target_id = t.uid('s1') and action = 'account.reactivated'), 'R8 audit records the reactivation');
select t.ok((select (j->>'academic_year_warning') is not null from (select t.preview('adm', 'r3', 'reactivate') j) x), 'R9 reactivate preview for a Resident returns the academic-year flag');

-- ===== L. last Admin (AC 5)
select t.ok((select j->'blockers' ? 'SELF_ACTION_FORBIDDEN' from (select t.preview('adm', 'adm', 'deactivate') j) x), 'L1 preview flags self');
select t.ok((t.set_active('adm', 'adm2', false, (select t.preview('adm', 'adm2', 'deactivate')->'preview_counts'))->>'changed')::boolean, 'L2 one Admin can deactivate the other');
select t.ok((select j->'blockers' ? 'LAST_ADMIN' from (select t.preview('adm', 'adm', 'deactivate') j) x), 'L3 preview: the remaining Admin is the last one');
select t.err('adm2', format($$select public.admin_set_account_active(%L, false, %L, gen_random_uuid(), 'x', '{"pending_requests":0,"active_assignments":0}'::jsonb)$$, t.uid('adm'), t.updated_at('adm')), 'Active Admin account required', 'L4 the deactivated Admin cannot deactivate the last one');
select t.ok((select count(*) = 1 from public.resident_user_roles r join public.resident_profiles p using (user_id) where r.role = 'admin' and r.active and p.active), 'L5 one active Admin remains');
select t.err('adm2', $$select public.admin_list_accounts()$$, 'Active Admin account required', 'L6 the deactivated Admin cannot list accounts');
select t.err('adm2', format($$select * from public.admin_list_account_events(%L)$$, t.uid('s1')), 'Active Admin account required', 'L7 ... nor read the audit');
select t.ok(t.count_as('adm', format($$select count(*) from public.admin_list_account_events(%L)$$, t.uid('s1'))) = 4, 'L8 active Admin reads the account history (2 edits, deactivate, reactivate)');

-- ===== N. no overwrite when adding accounts (D-011, AC 7) — service-role RPC used by the Edge Function
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1', 'new1@example.test');
set local role service_role;
select t.ok((public.admin_provision_account_internal(t.uid('adm'), '00000000-0000-0000-0000-0000000000a1', 'New1@Example.test', 'Test new1', 'resident', 1::smallint)->>'created')::boolean, 'N1 a new Resident is created (email lower-cased)');
reset role;
select t.ok((select email = 'new1@example.test' and pgy = 1 from public.resident_profiles where user_id = '00000000-0000-0000-0000-0000000000a1')
  and (select count(*) = 1 from public.resident_account_events where target_id = '00000000-0000-0000-0000-0000000000a1' and action = 'account.created'), 'N2 profile + role + audit written');
create function t.provision(p_actor text, p_user uuid, p_email text, p_name text, p_role text, p_pgy smallint, p_unit text) returns jsonb language plpgsql as $$
declare v jsonb; begin set local role service_role; v := public.admin_provision_account_internal(t.uid(p_actor), p_user, p_email, p_name, p_role, p_pgy, p_unit); reset role; return v; end $$;
create function t.provision_err(p_actor text, p_user uuid, p_email text, p_name text, p_role text, p_pgy smallint, p_unit text, p_pattern text, p_label text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin perform t.provision(p_actor, p_user, p_email, p_name, p_role, p_pgy, p_unit); exception when others then get stacked diagnostics v_msg = message_text; end;
  reset role;
  if v_msg is null or v_msg !~* p_pattern then raise exception 'FAIL % : expected "%" got "%"', p_label, p_pattern, coalesce(v_msg, 'success'); end if;
  raise notice 'PASS %', p_label;
end $$;
grant execute on all functions in schema t to service_role;
select t.provision_err('adm', gen_random_uuid(), 'r2@example.test', 'Overwrite try', 'admin', null, null, 'ACCOUNT_EXISTS', 'N3 an existing email is never overwritten');
select t.ok((select r.role = 'resident' and p.full_name = 'Test r2 once' and p.pgy = 2 from public.resident_user_roles r join public.resident_profiles p using (user_id) where user_id = t.uid('r2')), 'N4 ... the existing account is unchanged');
select t.provision_err('adm', t.uid('r3'), 'other@example.test', 'Reactivate try', 'resident', 2::smallint, null, 'ACCOUNT_EXISTS', 'N5 an existing user id (inactive) is not reactivated by adding');
select t.ok((select not active from public.resident_profiles where user_id = t.uid('r3')), 'N6 ... r3 is still deactivated');
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a2', 'newstaff@example.test');
select t.ok((t.provision('adm', '00000000-0000-0000-0000-0000000000a2', 'newstaff@example.test', 'Test new staff', 'staff', null, 'Unit X')->>'created')::boolean, 'N7a a new Staff account is created');
select t.ok((select auth_user_id = '00000000-0000-0000-0000-0000000000a2' and active from public.resident_staff_directory where email = 'newstaff@example.test'), 'N7b with a Staff list entry linked to it');
select t.provision_err('adm', gen_random_uuid(), 's2@example.test', 'x x', 'staff', null, 'Unit', 'ACCOUNT_EXISTS', 'N8 Staff already in the list and linked => ACCOUNT_EXISTS');
select t.provision_err('adm2', gen_random_uuid(), 'n3@example.test', 'x x', 'resident', 1::smallint, null, 'Active Admin account required', 'N9 a deactivated Admin cannot add accounts through the Edge Function');
select t.provision_err('adm', gen_random_uuid(), 'n4@example.test', 'x x', 'resident', null, null, 'ROLE_RULE', 'N10 a Resident needs a PGY');
select t.provision_err('adm', gen_random_uuid(), 'n5@example.test', 'x x', 'admin', 2::smallint, null, 'ROLE_RULE', 'N11 an Admin has no PGY');

-- ===== X. nothing outside the scope changed (D-014, D-020)
select t.ok((select count(*) = 0 from public.resident_round_attendance), 'X1 no attendance rows were created or touched by account actions');
select t.ok(pg_get_functiondef('public.save_resident_exam_scores'::regproc) !~ 'resident_account' and pg_get_functiondef('public.create_resident_exam_event_mpl'::regproc) !~ 'resident_account', 'X2 exam scoring functions are unchanged');

-- ===== Z. account-write pause (release safety, G0 B-R02)
update public.resident_maintenance_pause set paused = true where scope = 'accounts';
select t.ok(public.resident_accounts_paused(), 'Z1 pause is on');
create function t.err_as(p_role text, p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin execute format('set local role %I', p_role); execute p_sql; exception when others then get stacked diagnostics v_msg = message_text; end;
  reset role;
  if v_msg is null or v_msg !~* p_pattern then raise exception 'FAIL % : expected "%" got "%"', p_label, p_pattern, coalesce(v_msg, 'success'); end if;
  raise notice 'PASS %', p_label;
end $$;
select t.err_as('service_role', format($$insert into public.resident_profiles (user_id, full_name, email, pgy, active) values (%L, 'Old Edge', 'r2@example.test', 1, true)
  on conflict (user_id) do update set full_name = excluded.full_name, active = true$$, t.uid('r2')), 'ACCOUNTS_PAUSED', 'Z2 the OLD Edge Function upsert (service role) is refused while paused');
select t.err_as('service_role', format($$update public.resident_user_roles set role = 'admin' where user_id = %L$$, t.uid('r2')), 'ACCOUNTS_PAUSED', 'Z3 service-role role change refused while paused');
select t.err_as('service_role', $$insert into public.resident_staff_directory (email, full_name, unit_name, active) values ('z@example.test', 'Z z', 'Unit', true)$$, 'ACCOUNTS_PAUSED', 'Z4 Staff list insert refused while paused');
select t.err_as('service_role', format($$delete from public.resident_profiles where user_id = %L$$, t.uid('r3')), 'ACCOUNTS_PAUSED', 'Z5 delete refused while paused');
select t.err_as('postgres', $$truncate public.resident_user_roles cascade$$, 'ACCOUNTS_PAUSED', 'Z6 even TRUNCATE by the owner is refused while paused');
select t.err('adm', format($$select public.admin_update_account(%L, %L, gen_random_uuid(), '{"full_name":"paused edit"}'::jsonb)$$, t.uid('r2'), t.updated_at('r2')), 'ACCOUNTS_PAUSED', 'Z7 Admin edit RPC refused while paused');
select t.err('adm', format($$select public.admin_set_account_active(%L, true, %L, gen_random_uuid(), 'x')$$, t.uid('s1'), t.updated_at('s1')), 'ACCOUNTS_PAUSED|ACCOUNT_CONFLICT', 'Z8 Admin activate/deactivate refused while paused');
select t.err('adm', format($$select public.admin_set_account_active(%L, true, %L, gen_random_uuid(), 'x')$$, t.uid('r1'), t.updated_at('r1')), 'ACCOUNTS_PAUSED', 'Z8b reactivate refused while paused');
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a9', 'z9@example.test');
select t.provision_err('adm', '00000000-0000-0000-0000-0000000000a9', 'z9@example.test', 'Z nine', 'resident', 1::smallint, null, 'ACCOUNTS_PAUSED', 'Z9 adding an account (new Edge path) refused while paused');
select t.ok(t.count_as('adm', 'select count(*) from public.admin_list_accounts()') > 0 and t.count_as('r2', 'select count(*) from public.resident_profiles') = 1, 'Z10 reading still works while paused');
select t.ok(t.submit('r2', 'EPA-6', 's2') is not null, 'Z11 Residents can still send requests while paused (only account writes stop)');
select t.ok((select r.role = 'resident' and p.full_name = 'Test r2 once' from public.resident_user_roles r join public.resident_profiles p using (user_id) where user_id = t.uid('r2')), 'Z12 nothing was changed by the refused writes');
update public.resident_maintenance_pause set paused = false where scope = 'accounts';
select t.ok((t.edit('adm', 'r2', '{"full_name":"Test r2 after pause"}')->>'changed')::boolean, 'Z13 after the pause is off, edits work again');
select t.denied('authenticated', $$select * from public.resident_maintenance_pause$$, 'Z14 the pause table is not readable/writable from the browser');
select t.denied('authenticated', $$update public.resident_maintenance_pause set paused = false$$, 'Z15 the browser cannot switch the pause');

-- ===== G. v3 (Option A): direct writes by client roles stay refused AFTER the pause ends; reviewed functions still work
select t.ok(not public.resident_accounts_paused() and public.resident_account_direct_writes_blocked(), 'G0 pause off, direct-write guard on');
select t.err_as('service_role', format($$insert into public.resident_profiles (user_id, full_name, email, pgy, active) values (%L, 'Old Edge', 'r2@example.test', 1, true)
  on conflict (user_id) do update set full_name = excluded.full_name, active = true$$, t.uid('r2')), 'ACCOUNT_WRITE_REFUSED', 'G1 the OLD Edge upsert (service role) is refused after pause_off too');
select t.err_as('service_role', format($$update public.resident_user_roles set role = 'admin', active = true where user_id = %L$$, t.uid('r2')), 'ACCOUNT_WRITE_REFUSED', 'G2 old-Edge style role change refused');
select t.err_as('service_role', format($$update public.resident_staff_directory set auth_user_id = %L where email = 's2@example.test'$$, t.uid('r2')), 'ACCOUNT_WRITE_REFUSED', 'G3 old-Edge style Staff list link refused');
select t.err_as('service_role', $$insert into public.resident_staff_directory (email, full_name, unit_name, active) values ('g4@example.test', 'G four', 'Unit', true)$$, 'ACCOUNT_WRITE_REFUSED', 'G4 old-Edge style Staff list insert refused');
select t.err_as('service_role', format($$delete from public.resident_profiles where user_id = %L$$, t.uid('r3')), 'ACCOUNT_WRITE_REFUSED', 'G5 service-role delete refused');
select t.err_as('service_role', $$truncate public.resident_user_roles cascade$$, 'ACCOUNT_WRITE_REFUSED', 'G6 service-role TRUNCATE refused');
select t.ok((select r.role = 'resident' and p.full_name = 'Test r2 after pause' from public.resident_user_roles r join public.resident_profiles p using (user_id) where user_id = t.uid('r2'))
  and (select auth_user_id = t.uid('s2') from public.resident_staff_directory where email = 's2@example.test'), 'G7 nothing was changed by the refused writes');
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000b1', 'g8@example.test'), ('00000000-0000-0000-0000-0000000000b2', 'g9staff@example.test');
select t.ok((t.provision('adm', '00000000-0000-0000-0000-0000000000b1', 'g8@example.test', 'G eight', 'resident', 3::smallint, null)->>'created')::boolean, 'G8 NEW Edge path (service role calling the reviewed function) still adds a Resident');
select t.ok((t.provision('adm', '00000000-0000-0000-0000-0000000000b2', 'g9staff@example.test', 'G nine', 'staff', null, 'Unit G')->>'created')::boolean
  , 'G9 ... and a Staff with a new Staff list entry');
select t.ok((select auth_user_id = '00000000-0000-0000-0000-0000000000b2' from public.resident_staff_directory where email = 'g9staff@example.test'), 'G10 Staff list entry linked inside the reviewed function');
select t.provision_err('adm', gen_random_uuid(), 'g8@example.test', 'Overwrite', 'admin', null, null, 'ACCOUNT_EXISTS', 'G11 no overwrite through the new path');
select t.ok((t.edit('adm', 'r2', '{"full_name":"Test r2 v3 edit"}')->>'changed')::boolean, 'G12 Admin edit RPC works with the guard on');
select t.ok((t.set_active('adm', 's2', false, (select t.preview('adm', 's2', 'deactivate')->'preview_counts'))->>'changed')::boolean, 'G13 Admin deactivate RPC works with the guard on');
select t.ok((t.set_active('adm', 's2', true)->>'changed')::boolean, 'G14 Admin reactivate RPC works with the guard on');
select t.ok((select r.active and p.active from public.resident_user_roles r join public.resident_profiles p using (user_id) where user_id = t.uid('s2')), 'G15 s2 is active again');
update public.resident_profiles set full_name = 'Test r3 owner fix' where user_id = t.uid('r3');
select t.ok((select full_name = 'Test r3 owner fix' from public.resident_profiles where user_id = t.uid('r3')), 'G16 the database owner (SQL Editor) can still correct data by hand');
select t.denied('authenticated', format($$update public.resident_profiles set full_name = 'x' where user_id = %L$$, t.uid('r2')), 'G17 browser direct write still refused by privileges (before the guard)');
select t.ok(not (select prosecdef from pg_proc where oid = 'private.resident_refuse_account_write_when_paused()'::regprocedure), 'G18 the guard runs as the caller (SECURITY INVOKER), so it sees service_role');
-- rollback mode: rc02a1_rollback.sql switches the guard off so the restored old Edge works again
update public.resident_maintenance_pause set block_client_direct_writes = false where scope = 'accounts';
select t.ok(t.q('adm', 'select to_jsonb(1)') is not null, 'G19 (setup) guard switched off as the rollback does');
set local role service_role;
insert into public.resident_profiles (user_id, full_name, email, pgy, active) values (t.uid('r2'), 'Old Edge after rollback', 'r2@example.test', 2, true)
  on conflict (user_id) do update set full_name = excluded.full_name;
reset role;
select t.ok((select full_name = 'Old Edge after rollback' from public.resident_profiles where user_id = t.uid('r2')), 'G20 with the guard off (rollback) the old Edge path works again');
update public.resident_maintenance_pause set block_client_direct_writes = true where scope = 'accounts';

do $$ begin raise notice 'ALL ACCOUNT BEHAVIOUR TESTS PASSED'; end $$;
rollback;
