-- RC-04 managed exams — behaviour tests (migration 20261019090000). Throwaway local database only; everything rolls back.
-- All UUIDs below are synthetic FIXTURE ids (no real people). Run: psql -v ON_ERROR_STOP=1 -f tests/rc04-managed-exams-behavior.sql
begin;
do $$ begin
  if exists (select 1 from public.resident_profiles) then raise exception 'Refusing to run: database already has Resident data'; end if;
end $$;
update public.resident_maintenance_pause set paused = false where scope = 'accounts';

create schema t;
create table t.users (name text primary key, id uuid not null);
create table t.ctx (k text primary key, v jsonb);
create function t.uid(p text) returns uuid language sql as $$ select id from t.users where name = p $$;
create function t.v(p text) returns jsonb language sql as $$ select v from t.ctx where k = p $$;
create function t.s(p text) returns text language sql as $$ select v #>> '{}' from t.ctx where k = p $$;
create function t.put(p text, x jsonb) returns jsonb language sql as $$ insert into t.ctx values (p, x) on conflict (k) do update set v = excluded.v returning v $$;
create function t.ok(c boolean, l text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL %', l; end if; raise notice 'PASS %', l; end $$;
create function t.q(p_user text, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(t.uid(p_user)::text, ''), true);
  set local role authenticated; execute p_sql into v; reset role; return v;
end $$;
create function t.err(p_user text, p_sql text, p_pat text, l text) returns void language plpgsql as $$
declare m text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(t.uid(p_user)::text, ''), true);
  begin set local role authenticated; execute p_sql; exception when others then get stacked diagnostics m = message_text; end;
  reset role;
  if m is null then raise exception 'FAIL % : expected error "%" but it succeeded', l, p_pat; end if;
  if m !~* p_pat then raise exception 'FAIL % : expected "%" got "%"', l, p_pat, m; end if;
  raise notice 'PASS %', l;
end $$;
create function t.err_role(p_role text, p_sql text, p_pat text, l text) returns void language plpgsql as $$
declare m text;
begin
  begin execute format('set local role %I', p_role); execute p_sql; exception when others then get stacked diagnostics m = message_text; end;
  reset role;
  if m is null or m !~* p_pat then raise exception 'FAIL % : expected "%" got "%"', l, p_pat, coalesce(m, 'success'); end if;
  raise notice 'PASS %', l;
end $$;
-- helpers that call the RPCs as a given user
create function t.preview(u text, cells jsonb, rep jsonb default null, ver integer default null) returns jsonb language sql as $$
  select t.q(u, format('select public.rc04_preview_import(%L::uuid, %L::uuid, %s, %L::jsonb, %L::jsonb, %L::jsonb)',
    t.s('exam'), t.s('rev'), coalesce(ver, (select version from public.rc04_exam_revisions where id = t.s('rev')::uuid)),
    cells, '{"file_hash":"fixture-hash"}', rep)) $$;
create function t.commit(u text, req uuid, pv jsonb, reason text default null) returns jsonb language sql as $$
  select t.q(u, format('select public.rc04_commit_import(%L::uuid, %L::uuid, %s, %L, %L)', req, pv->>'preview_id', pv->>'expected_version', pv->>'delta_fingerprint', reason)) $$;
create function t.ver() returns integer language sql as $$ select version from public.rc04_exam_revisions where id = t.s('rev')::uuid $$;
create function t.cell(res text, part text) returns record language sql as $$
  select value_state, score, outcome from public.rc04_revision_results where revision_id = t.s('rev')::uuid and resident_id = t.uid(res) and part_id = t.s(part)::uuid $$;
create function t.state(res text, part text, rev text default 'rev') returns text language sql as $$
  select value_state || ':' || coalesce(score::text, '-') || ':' || coalesce(outcome, '-') from public.rc04_revision_results
   where revision_id = t.s(rev)::uuid and resident_id = t.uid(res) and part_id = t.s(part)::uuid $$;
create function t.c(res text, part text, st text, sc numeric default null, ref text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('resident_id', t.uid(res), 'part_id', t.s(part), 'state', st, 'cell_ref', ref))
         || case when sc is null then '{}'::jsonb else jsonb_build_object('score', sc) end $$;
create function t.read_all(u text, scope text, exam text default null, lim integer default 500) returns jsonb language plpgsql as $$
declare m jsonb; pg jsonb; acc jsonb := '[]'; cur jsonb := null;
begin
  m := t.q(u, format('select public.rc04_open_read_set(%L, %L::uuid, null, null)', scope, exam));
  loop
    pg := t.q(u, format('select public.rc04_read_page(%L::uuid, %L::jsonb, %s)', m->>'manifest_id', cur, lim));
    acc := acc || (pg->'rows');
    exit when (pg->>'done')::boolean; cur := pg->'next_cursor';
  end loop;
  return jsonb_build_object('manifest', m, 'rows', acc);
end $$;
grant usage on schema t to authenticated, anon, service_role;
grant select on all tables in schema t to authenticated, anon, service_role;
grant execute on all functions in schema t to authenticated, anon, service_role;

-- fixture people (synthetic)
insert into t.users values
 ('a1','10000000-0000-4000-8000-0000000000a1'),('a2','10000000-0000-4000-8000-0000000000a2'),
 ('s1','10000000-0000-4000-8000-0000000000b1'),('r1','10000000-0000-4000-8000-0000000000c1'),
 ('r2','10000000-0000-4000-8000-0000000000c2'),('r3','10000000-0000-4000-8000-0000000000c3'),
 ('r4','10000000-0000-4000-8000-0000000000c4'),('rx','10000000-0000-4000-8000-0000000000c9');
insert into auth.users(id, email) select id, name || '@fixture.test' from t.users;
insert into public.resident_profiles(user_id, full_name, email, pgy, active)
  select id, 'Fixture ' || name, name || '@fixture.test', case when name like 'r%' then 2 end, name <> 'rx' from t.users;
insert into public.resident_user_roles(user_id, role, active)
  select id, case when name like 'r%' then 'resident'::public.resident_system_role when name like 's%' then 'staff' else 'admin' end, name <> 'rx' from t.users;

-- ===== CREATE (§8) + T17 auth before receipt
select t.put('create_payload', jsonb_build_object('exam_type','xray_anatomy','title','X-ray & Anatomy fixture','exam_date','2026-06-20','academic_year',2569,
  'roster', jsonb_build_array(jsonb_build_object('resident_id',t.uid('r1'),'pgy_at_exam',2,'reference_name','Fixture R1'),
                              jsonb_build_object('resident_id',t.uid('r2'),'pgy_at_exam',3),
                              jsonb_build_object('resident_id',t.uid('r3'),'pgy_at_exam',2)),
  'parts', jsonb_build_array(jsonb_build_object('name','Part A','sort_order',1,'max_score',100,'mpl',jsonb_build_object('2',60,'3',65)),
                             jsonb_build_object('name','Part B','sort_order',2,'max_score',50,'mpl',jsonb_build_object('2',30,'3',30)),
                             jsonb_build_object('name','Part C','sort_order',3,'max_score',20,'mpl',jsonb_build_object('2',12)))));
select t.put('req_create', to_jsonb('20000000-0000-4000-8000-000000000001'::uuid));
select t.err('r1', format($$select public.rc04_create_managed_exam(%L, %L)$$, t.s('req_create'), t.v('create_payload')), 'RC04_FORBIDDEN', 'T17a Resident cannot create');
select t.err('s1', format($$select public.rc04_create_managed_exam(%L, %L)$$, t.s('req_create'), t.v('create_payload')), 'RC04_FORBIDDEN', 'T17b Staff cannot create');
select t.err('rx', format($$select public.rc04_create_managed_exam(%L, %L)$$, t.s('req_create'), t.v('create_payload')), 'RC04_FORBIDDEN', 'T17c inactive account cannot create');
select t.err(null, format($$select public.rc04_create_managed_exam(%L, %L)$$, t.s('req_create'), t.v('create_payload')), 'RC04_FORBIDDEN', 'T17d no login cannot create');
select t.ok((select count(*) = 0 from public.rc04_request_receipts), 'T17e no receipt is reserved before the Admin check');
select t.put('created', t.q('a1', format($$select public.rc04_create_managed_exam(%L, %L)$$, t.s('req_create'), t.v('create_payload'))));
select t.put('exam', t.v('created')->'exam_id'); select t.put('rev', t.v('created')->'revision_id'); select t.put('rev1', t.v('created')->'revision_id');
select t.ok((t.v('created')->>'version')::int = 1 and t.v('created')->>'state' = 'working', 'C1 create returns exam, working revision, version 1');
select t.ok((t.q('a1', format($$select public.rc04_create_managed_exam(%L, %L)$$, t.s('req_create'), t.v('create_payload')))->>'exam_id') = t.s('exam')
  and (select count(*) = 1 from public.resident_exam_events where managed_by_rc04), 'C2 same request again = same exam (replay), nothing new');
select t.err('a1', format($$select public.rc04_create_managed_exam(%L, %L)$$, t.s('req_create'), t.v('create_payload') || '{"title":"other"}'), 'IDEMPOTENCY_KEY_REUSED', 'C3 same request_id, different payload');
select t.ok((select count(*) = 9 and bool_and(value_state = 'unknown' and score is null and outcome is null) from public.rc04_revision_results where revision_id = t.s('rev')::uuid), 'C4 every roster x part cell exists as unknown');
select t.ok((select pgy_at_exam = 3 and reference_name = 'Fixture r2' from public.rc04_revision_participants where revision_id = t.s('rev')::uuid and resident_id = t.uid('r2'))
  and (select pgy = 2 from public.resident_profiles where user_id = t.uid('r2')), 'C5 confirmed PGY at exam stored in the snapshot; profile PGY untouched');
select t.ok((select count(*) = 0 from public.resident_exam_participants where event_id = t.s('exam')::uuid)
  and (select count(*) = 0 from public.resident_exam_parts where event_id = t.s('exam')::uuid), 'C6 legacy child tables hold no managed rows');
select t.err('a1', format($$select public.rc04_create_managed_exam(gen_random_uuid(), %L)$$, t.v('create_payload') || jsonb_build_object('roster', jsonb_build_array(jsonb_build_object('resident_id',t.uid('s1'),'pgy_at_exam',2)))), 'is not a Resident account', 'C7 roster must be Resident accounts');
select t.err('a1', format($$select public.rc04_create_managed_exam(gen_random_uuid(), %L)$$, t.v('create_payload') || jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('name','X','sort_order',1,'max_score',10,'mpl',jsonb_build_object('2',11))))), 'MPL is higher', 'C8 MPL above max refused');
select t.ok((select count(*) = 1 from public.resident_exam_events where managed_by_rc04), 'C9 failed creates left nothing behind');

-- template
select t.put('tpl', t.q('a1', format($$select public.rc04_get_import_template(%L, %L)$$, t.s('exam'), t.s('rev'))));
select t.put('pA', t.v('tpl')->'parts'->0->'part_id'); select t.put('pB', t.v('tpl')->'parts'->1->'part_id'); select t.put('pC', t.v('tpl')->'parts'->2->'part_id');
select t.ok(t.v('tpl')->>'template_version' = 'RC04-TEMPLATE-1' and (t.v('tpl')->>'importable')::boolean
  and t.v('tpl')->'parts'->0->>'column_key' = 'part_1' and t.v('tpl')->'parts'->1->'mpl' = '{"2": 30, "3": 30}'::jsonb
  and jsonb_array_length(t.v('tpl')->'roster') = 3 and jsonb_array_length(t.v('tpl')->'cells') = 9, 'TPL template: version, part-column map, criteria, roster, cells');
select t.err('s1', format($$select public.rc04_get_import_template(%L, %L)$$, t.s('exam'), t.s('rev')), 'RC04_FORBIDDEN', 'TPL Staff cannot read the draft template');

-- ===== T03/T04/T06/T12 invalid previews: errors with position, no preview row, no mutation
select t.put('bad', t.preview('a1', jsonb_build_array(
  t.c('r1','pA','scored',-1,'D5'), t.c('r1','pB','scored',51,'E5'), t.c('r1','pC','scored',10.555,'F5'),
  jsonb_build_object('resident_id',t.uid('r2'),'part_id',t.s('pA'),'state','scored','score','55ผ่าน','cell_ref','D6'),
  t.c('r2','pB','absent',3,'E6'), t.c('r2','pC','zero',null,'F6'),
  t.c('rx','pA','scored',10,'D9'), jsonb_build_object('resident_id',t.uid('r3'),'part_id',gen_random_uuid(),'state','scored','score',1,'cell_ref','Z7'),
  t.c('r3','pA','scored',70,'D7'), t.c('r3','pA','scored',71,'D8'))));
select t.ok((t.v('bad')->>'ok')::boolean = false and t.v('bad')->>'preview_id' is null, 'T03a invalid cells → ok=false, no preview');
select t.ok((select array_agg(e->>'code' order by e->>'cell_ref') from jsonb_array_elements(t.v('bad')->'errors') e)
  = array['SCORE_NEGATIVE','INVALID_SCORE_TYPE','DUPLICATE_CELL','UNKNOWN_RESIDENT','SCORE_EXCEEDS_MAX','STATE_WITH_SCORE','SCORE_TOO_PRECISE','INVALID_STATE','UNKNOWN_PART'], 'T03b/T04 each error has its cell position and code (negative, text, >max, 3 decimals, absent+score, bad state, not in roster, other part, duplicate)');
select t.ok((select count(*) = 0 from public.rc04_import_previews) and (select bool_and(value_state = 'unknown') from public.rc04_revision_results where revision_id = t.s('rev')::uuid), 'T12 no preview and no cell changed');
select t.put('bad2', t.preview('a1', jsonb_build_array(t.c('r1','pA','scored',1)), jsonb_build_object('exam_id', gen_random_uuid(), 'revision_id', t.s('rev'), 'template_version','RC04-DRAFT-1','academic_year',2570,'version',99,
  'roster', jsonb_build_array(jsonb_build_object('resident_id',t.uid('r1'),'pgy_at_exam',3,'cell_ref','C5')),
  'parts', jsonb_build_array(jsonb_build_object('part_id',t.s('pB'),'max_score',50,'mpl',jsonb_build_object('2',30,'3',31))))));
select t.ok((select array_agg(e->>'code' order by e->>'code') from jsonb_array_elements(t.v('bad2')->'errors') e)
  = array['ACADEMIC_YEAR_MISMATCH','EXAM_MISMATCH','PART_OR_CRITERIA_MISMATCH','ROSTER_OR_PGY_MISMATCH','TEMPLATE_OUTDATED','TEMPLATE_VERSION_MISMATCH'], 'T06/T04 wrong exam/year/template/version, PGY and criteria mismatch are rejected');
select t.err('a1', format($$select public.rc04_preview_import(%L, %L, 99, '[]', '{}', null)$$, t.s('exam'), t.s('rev')), 'RC04_REVISION_CONFLICT', 'T06b preview against an old version → conflict');

-- ===== T01/T02/T05 valid partial import
select t.put('pv1', t.preview('a1', jsonb_build_array(
  t.c('r1','pA','scored',60,'D5'), t.c('r1','pB','absent',null,'E5'), t.c('r1','pC','awaiting',null,'F5'),
  t.c('r2','pA','scored',65,'D6'), t.c('r2','pB','scored',0,'E6'),
  t.c('r3','pA','scored',59.99,'D7'))));
select t.ok((t.v('pv1')->>'ok')::boolean and (t.v('pv1')->'counts'->>'changed')::int = 6 and not (t.v('pv1')->>'requires_reason')::boolean
  and t.v('pv1')->'warnings' @> '[{"code":"PARTS_NOT_IN_FILE"}]'::jsonb is not true, 'P1 preview: 6 changes, no reason needed for first values');
select t.ok((select d->'before'->>'value_state' = 'unknown' and d->'after' = '{"score": 60, "outcome": "pass", "value_state": "scored"}'::jsonb
  from jsonb_array_elements(t.v('pv1')->'diff') d where d->>'cell_ref' = 'D5'), 'P2 diff shows before/after with predicted outcome');
select t.ok((select bool_and(value_state = 'unknown') from public.rc04_revision_results where revision_id = t.s('rev')::uuid), 'P3 preview changed no cell');
select t.put('req1', to_jsonb('20000000-0000-4000-8000-000000000011'::uuid));
select t.put('c1', t.commit('a1', t.s('req1')::uuid, t.v('pv1')));
select t.ok((t.v('c1')->>'changed_count')::int = 6 and (t.v('c1')->>'version')::int = 2 and not (t.v('c1')->>'replayed')::boolean, 'P4 commit: 6 changed, version 2');
select t.ok(t.state('r1','pA') = 'scored:60.00:pass' and t.state('r3','pA') = 'scored:59.99:fail' and t.state('r2','pA') = 'scored:65.00:pass', 'T02 = MPL pass, 0.01 below fail (per PGY snapshot)');
select t.ok(t.state('r2','pB') = 'scored:0.00:fail' and t.state('r1','pB') = 'absent:-:-' and t.state('r1','pC') = 'awaiting:-:-' and t.state('r3','pB') = 'unknown:-:-', 'T01 0 is a score; absent and awaiting are rows with null score/outcome; a blank stays unknown');
select t.ok(t.state('r2','pC') = 'unknown:-:-' and t.state('r3','pC') = 'unknown:-:-', 'T05 cells not in the file are kept');

-- ===== T07/T08/T29 replay and key reuse
select t.ok((t.commit('a1', t.s('req1')::uuid, t.v('pv1'))->>'replayed')::boolean and t.ver() = 2
  and (select count(*) = 1 from public.rc04_import_batches) and (select count(*) = 1 from public.rc04_audit where operation = 'import.commit'), 'T07 lost response → same request again = receipt, one batch, one audit');
select t.err('a1', format($$select public.rc04_commit_import(%L, %L, %s, %L, 'different')$$, t.s('req1'), t.v('pv1')->>'preview_id', t.v('pv1')->>'expected_version', t.v('pv1')->>'delta_fingerprint'), 'IDEMPOTENCY_KEY_REUSED', 'T08 same request_id + different payload rejected');
select t.err('a1', format($$select public.rc04_commit_import(gen_random_uuid(), %L, %s, %L)$$, t.v('pv1')->>'preview_id', t.v('pv1')->>'expected_version', t.v('pv1')->>'delta_fingerprint'), 'RC04_PREVIEW_CONSUMED|RC04_REVISION_CONFLICT', 'T29a NEW request from the old template/preview → conflict');
select t.err('r1', format($$select public.rc04_commit_import(%L, %L, 1, %L)$$, t.s('req1'), t.v('pv1')->>'preview_id', t.v('pv1')->>'delta_fingerprint'), 'RC04_FORBIDDEN', 'T17f a Resident replaying the Admin request id gets nothing');
select t.err('a2', format($$select public.rc04_commit_import(gen_random_uuid(), %L, 2, %L)$$, t.v('pv1')->>'preview_id', t.v('pv1')->>'delta_fingerprint'), 'RC04_PREVIEW_NOT_FOUND', 'T17g another Admin cannot use my preview');

-- ===== T09 preview A, Admin B commits first, A conflicts
select t.put('pvA', t.preview('a1', jsonb_build_array(t.c('r3','pB','scored',40))));
select t.put('pvB', t.preview('a2', jsonb_build_array(t.c('r3','pB','scored',45))));
select t.ok((t.commit('a2', gen_random_uuid(), t.v('pvB'))->>'changed_count')::int = 1, 'T09a Admin B commits first');
select t.err('a1', format($$select public.rc04_commit_import(gen_random_uuid(), %L, %s, %L)$$, t.v('pvA')->>'preview_id', t.v('pvA')->>'expected_version', t.v('pvA')->>'delta_fingerprint'), 'RC04_REVISION_CONFLICT', 'T09b Admin A gets a conflict');
select t.ok(t.state('r3','pB') = 'scored:45.00:pass', 'T09c B''s value is kept');
-- expired preview
select t.put('pvE', t.preview('a1', jsonb_build_array(t.c('r3','pB','scored',46))));
update public.rc04_import_previews set expires_at = clock_timestamp() - interval '1 second' where id = (t.v('pvE')->>'preview_id')::uuid;
select t.err('a1', format($$select public.rc04_commit_import(gen_random_uuid(), %L, %s, %L)$$, t.v('pvE')->>'preview_id', t.v('pvE')->>'expected_version', t.v('pvE')->>'delta_fingerprint'), 'RC04_PREVIEW_EXPIRED', 'P5 expired preview refused');
select t.put('pvF', t.preview('a1', jsonb_build_array(t.c('r3','pB','scored',46))));
select t.err('a1', format($$select public.rc04_commit_import(gen_random_uuid(), %L, %s, 'tampered')$$, t.v('pvF')->>'preview_id', t.v('pvF')->>'expected_version'), 'RC04_PREVIEW_MISMATCH', 'P6 client cannot change the delta after preview');

-- ===== T15 explicit scored → absent needs a reason; back to scored recomputes
select t.put('pvT', t.preview('a1', jsonb_build_array(t.c('r2','pB','absent'))));
select t.ok((t.v('pvT')->>'requires_reason')::boolean and (t.v('pvT')->'diff'->0->>'overwrites_recorded_value')::boolean, 'T15a overwrite of a recorded value is flagged');
select t.err('a1', format($$select public.rc04_commit_import(gen_random_uuid(), %L, %s, %L)$$, t.v('pvT')->>'preview_id', t.v('pvT')->>'expected_version', t.v('pvT')->>'delta_fingerprint'), 'RC04_REASON_REQUIRED', 'T15b no reason → refused');
select t.ok((t.commit('a1', gen_random_uuid(), t.v('pvT'), 'was absent on the day')->>'changed_count')::int = 1 and t.state('r2','pB') = 'absent:-:-', 'T15c scored → absent: score and outcome null');
select t.ok((t.commit('a1', gen_random_uuid(), t.preview('a1', jsonb_build_array(t.c('r2','pB','scored',29.99))), 'took the exam later')->>'changed_count')::int = 1 and t.state('r2','pB') = 'scored:29.99:fail', 'T15d absent → scored recomputes the outcome');
select t.ok((select reason = 'took the exam later' from public.rc04_audit where operation = 'import.commit' order by id desc limit 1), 'T15e reason in the audit');

-- fill the rest
select t.ok((t.commit('a1', gen_random_uuid(), t.preview('a1', jsonb_build_array(t.c('r2','pC','scored',15), t.c('r3','pC','awaiting'))))->>'changed_count')::int = 2, 'P7 remaining cells filled');

-- ===== T10 review rules
select t.err('a1', format($$select public.rc04_mark_reviewed(gen_random_uuid(), %L, %L, %s, '{"absent":1,"awaiting":2}')$$, t.s('exam'), t.s('rev'), t.ver()), 'RC04_NOT_READY.*CRITERIA_MISSING', 'T10a missing MPL (Part C, PGY 3) blocks review');
select t.ok(t.state('r2','pC') = 'scored:15.00:-', 'T10b a score without criteria has no outcome (not pass/fail)');
select t.put('pvStale', t.preview('a1', jsonb_build_array(t.c('r3','pB','scored',44))));
select t.put('upd', t.q('a1', format($$select public.rc04_update_working_revision(gen_random_uuid(), %L, %L, %s, %L)$$, t.s('exam'), t.s('rev'), t.ver(),
  jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('part_id', t.s('pC'), 'mpl', jsonb_build_object('3', 12)))))));
select t.ok(t.state('r2','pC') = 'scored:15.00:pass', 'T10c adding the MPL recomputes affected results');
select t.err('a1', format($$select public.rc04_commit_import(gen_random_uuid(), %L, %s, %L)$$, t.v('pvStale')->>'preview_id', t.v('pvStale')->>'expected_version', t.v('pvStale')->>'delta_fingerprint'), 'RC04_REVISION_CONFLICT|RC04_PREVIEW_EXPIRED', 'T10d a preview made before the criteria change is invalid');
select t.err('a1', format($$select public.rc04_update_working_revision(gen_random_uuid(), %L, %L, %s, %L)$$, t.s('exam'), t.s('rev'), t.ver(),
  jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('part_id', t.s('pA'), 'max_score', 64)))), 'SCORE_EXCEEDS_NEW_MAX', 'T10e new max below a recorded score is refused');
select t.err('a1', format($$select public.rc04_mark_reviewed(gen_random_uuid(), %L, %L, %s, '{"absent":0,"awaiting":0}')$$, t.s('exam'), t.s('rev'), t.ver()), 'CONFIRMATION_MISMATCH', 'P01a Admin must confirm the real absent/awaiting counts');
select t.ok((t.q('a1', format($$select public.rc04_mark_reviewed(gen_random_uuid(), %L, %L, %s, '{"absent":1,"awaiting":2}')$$, t.s('exam'), t.s('rev'), t.ver()))->>'checked_version')::int = t.ver(), 'P01b review with absent 1 / awaiting 2 confirmed');
-- T05/T11 same values again (new file hash) = no-op: version and review unchanged
select t.put('noop', t.commit('a1', gen_random_uuid(), t.preview('a1', jsonb_build_array(t.c('r1','pA','scored',60), t.c('r2','pB','scored',29.99)))));
select t.ok((t.v('noop')->>'noop')::boolean and (t.v('noop')->>'changed_count')::int = 0
  and (select checked_version = version from public.rc04_exam_revisions where id = t.s('rev')::uuid), 'T11/T05 same values again = no-op, review kept');
select t.ok((t.commit('a1', gen_random_uuid(), t.preview('a1', '[]'::jsonb))->>'noop')::boolean, 'T05b empty delta = no-op');
-- change after review clears it
select t.put('rv_before', to_jsonb(t.ver()));
select t.commit('a1', gen_random_uuid(), t.preview('a1', jsonb_build_array(t.c('r3','pB','scored',44))), 'second check of the paper');
select t.ok((select checked_version is null from public.rc04_exam_revisions where id = t.s('rev')::uuid), 'T10f a change after review clears the review');
select t.err('a1', format($$select public.rc04_publish_revision(gen_random_uuid(), %L, %L, %s, null, '{"absent":1,"awaiting":2}')$$, t.s('exam'), t.s('rev'), t.ver()), 'RC04_NOT_REVIEWED', 'T10g publish needs the review of this exact version');
select t.q('a1', format($$select public.rc04_mark_reviewed(gen_random_uuid(), %L, %L, %s, '{"absent":1,"awaiting":2}')$$, t.s('exam'), t.s('rev'), t.ver()));

-- drafts invisible before publish
select t.ok(jsonb_array_length(t.read_all('s1', 'staff')->'rows') = 0 and jsonb_array_length(t.read_all('r1', 'own')->'rows') = 0, 'D1 a draft is invisible to Staff and Residents');

-- ===== publish (P01: absent/awaiting allowed when confirmed)
select t.err('a1', format($$select public.rc04_publish_revision(gen_random_uuid(), %L, %L, %s, %L, '{"absent":1,"awaiting":2}')$$, t.s('exam'), t.s('rev'), t.ver(), gen_random_uuid()), 'PUBLISHED_REVISION_CONFLICT', 'T14a wrong expected published revision');
select t.put('pub1', t.q('a1', format($$select public.rc04_publish_revision(gen_random_uuid(), %L, %L, %s, null, '{"absent":1,"awaiting":2}')$$, t.s('exam'), t.s('rev'), t.ver())));
select t.ok(t.v('pub1')->>'published_revision_id' = t.s('rev'), 'PUB1 published');
select t.ok((select published_revision_id = t.s('rev')::uuid and status = 'published' and title = 'X-ray & Anatomy fixture' from public.resident_exam_events where id = t.s('exam')::uuid), 'R02a pointer and projection changed together');
select t.err_role('postgres', format($$update public.rc04_revision_results set score = 1 where revision_id = %L$$, t.s('rev')), 'RC04_IMMUTABLE', 'IMM1 published rows cannot change (even by the owner)');
select t.err_role('postgres', format($$update public.rc04_exam_revisions set title = 'x' where id = %L$$, t.s('rev')), 'RC04_IMMUTABLE', 'IMM2 published revision metadata cannot change');
select t.err_role('postgres', $$update public.rc04_audit set reason = 'x'$$, 'RC04_IMMUTABLE', 'IMM3 audit is append-only');

-- ===== reads (R01/R03, T20/T23/T24)
select t.put('staffread', t.read_all('s1', 'staff', null, 4));
select t.ok(jsonb_array_length(t.v('staffread')->'rows') = 9 and (select count(distinct x->>'revision_id') = 1 from jsonb_array_elements(t.v('staffread')->'rows') x), 'R1 Staff reads all 9 cells (pages of 4) of one pinned revision');
select t.ok((select count(*) = 9 from (select distinct x->>'resident_id', x->>'part_id' from jsonb_array_elements(t.v('staffread')->'rows') x) k), 'R2 no duplicate and no missing key across pages');
select t.ok((select x->>'value_state' = 'absent' and x->'score' = 'null'::jsonb and x->'outcome' = 'null'::jsonb and x->>'criteria_status' = 'complete'
  from jsonb_array_elements(t.v('staffread')->'rows') x where x->>'resident_id' = t.uid('r1')::text and x->>'part_id' = t.s('pB')), 'T23 absent row is returned with null score/outcome and complete criteria (not "waiting for criteria")');
select t.put('r3row', (select x from jsonb_array_elements(t.v('staffread')->'rows') x where x->>'resident_id' = t.uid('r3')::text limit 1));
select t.ok(t.v('r3row')->'overall'->>'status' = 'incomplete' and t.v('r3row')->'overall'->'failed_part_ids' = jsonb_build_array(t.s('pA'))
  and t.v('r3row')->'overall'->'awaiting_part_ids' = jsonb_build_array(t.s('pC')), 'T24 fail in one part + awaiting in another = incomplete WITH the failed part');
select t.ok((select x->>'pgy_at_exam' = '3' and x->>'reference_name' = 'Fixture r2' and (x->>'mpl')::numeric = 30 and (x->>'max_score')::numeric = 50 and (x->>'score')::numeric = 29.99 and x->>'outcome' = 'fail'
  from jsonb_array_elements(t.v('staffread')->'rows') x where x->>'resident_id' = t.uid('r2')::text and x->>'part_id' = t.s('pB')), 'T20 readback = imported value, PGY at exam, max, MPL, state, ids');
select t.put('own1', t.read_all('r1', 'own'));
select t.ok(jsonb_array_length(t.v('own1')->'rows') = 3 and (select bool_and(x->>'resident_id' = t.uid('r1')::text) from jsonb_array_elements(t.v('own1')->'rows') x), 'R3 a Resident reads only own rows');
select t.ok((select x->'overall'->>'status' from jsonb_array_elements(t.v('own1')->'rows') x limit 1) = 'incomplete', 'R4 r1 (pass + absent + awaiting) = incomplete');
select t.ok(jsonb_array_length(t.read_all('r4', 'own')->'rows') = 0, 'R5 a Resident not in the roster sees nothing');

-- ===== legacy readers/writers (T18/T28/T19)
select t.ok(t.q('a1', $$select to_jsonb(count(*)) from public.list_resident_exam_records() where event_id in (select id from public.resident_exam_events where managed_by_rc04)$$) = '0'::jsonb
  and t.q('s1', $$select to_jsonb(count(*)) from public.list_resident_exam_records()$$) = '0'::jsonb, 'T28a legacy reader returns no managed exam (Admin, Staff)');
select t.ok(t.q('a1', $$select to_jsonb(count(*)) from public.resident_exam_events where managed_by_rc04$$) = '0'::jsonb, 'T28b direct REST on events hides managed exams (even Admin)');
select t.err_role('authenticated', $$select 1 from public.rc04_revision_results$$, 'permission denied', 'T18a browser cannot read rc04 tables directly');
select t.err_role('anon', $$select 1 from public.rc04_exam_revisions$$, 'permission denied', 'T18b anon cannot read rc04 tables');
select t.err_role('service_role', $$select 1 from public.rc04_revision_results$$, 'permission denied', 'T18c service_role cannot read rc04 tables');
select t.err_role('service_role', format($$insert into public.rc04_audit (exam_id, actor_id, operation) values (%L, %L, 'x')$$, t.s('exam'), t.uid('a1')), 'permission denied', 'T18d service_role cannot write rc04 tables');
select t.err('a1', format($$select public.save_resident_exam_scores(%L, '[]', null)$$, t.s('exam')), 'RC04_MANAGED_EXAM', 'T18e save_resident_exam_scores rejects a managed exam');
select t.err('a1', format($$select public.save_resident_exam_results(%L, '[]')$$, t.s('exam')), 'RC04_MANAGED_EXAM', 'T18f save_resident_exam_results with [] rejects');
select t.err('a1', format($$select public.set_resident_exam_publication(%L, false)$$, t.s('exam')), 'RC04_MANAGED_EXAM', 'T18g unpublish rejects');
select t.err('a1', format($$select public.set_resident_exam_publication(%L, true)$$, t.s('exam')), 'RC04_MANAGED_EXAM', 'T18h publish (legacy) rejects');
select t.err('a1', format($$select public.update_resident_exam_mpl(%L, '[]')$$, t.s('exam')), 'RC04_MANAGED_EXAM', 'T18i update_resident_exam_mpl rejects');
select t.err('a1', format($$select public.delete_resident_exam_event(%L)$$, t.s('exam')), 'RC04_MANAGED_EXAM', 'T18j delete_resident_exam_event rejects');
select t.err_role('service_role', format($$update public.resident_exam_events set title = 'x' where id = %L$$, t.s('exam')), 'RC04_MANAGED_EXAM', 'T18k service_role direct update of a managed event refused');
select t.err_role('service_role', format($$delete from public.resident_exam_events where id = %L$$, t.s('exam')), 'RC04_MANAGED_EXAM', 'T18l service_role direct delete refused');
select t.err_role('postgres', format($$delete from public.resident_exam_events where id = %L$$, t.s('exam')), 'RC04_MANAGED_EXAM', 'T18m even the owner cannot delete a managed exam (no cascade loss)');
select t.err_role('service_role', format($$insert into public.resident_exam_results (event_id, resident_id, part_id, score, updated_by) values (%L, %L, null, 1, %L)$$, t.s('exam'), t.uid('r1'), t.uid('a1')), 'RC04_MANAGED_EXAM', 'T18n legacy result rows for a managed exam refused');
select t.err('r1', format($$select public.rc04_publish_revision(gen_random_uuid(), %L, %L, 1, null, '{}')$$, t.s('exam'), t.s('rev')), 'RC04_FORBIDDEN', 'T17h Resident cannot publish');
select t.err('s1', format($$select public.rc04_begin_correction(gen_random_uuid(), %L, %L, 'x')$$, t.s('exam'), t.s('rev')), 'RC04_FORBIDDEN', 'T17i Staff cannot correct');

-- T19 legacy MPL exam still works and is visible to the legacy reader
select t.put('leg', to_jsonb(t.q('a1', format($$select to_jsonb(public.create_resident_exam_event_mpl('xray_anatomy', '2026-05-01', 'Legacy fixture', null, %L, %L))$$,
  jsonb_build_array(jsonb_build_object('name','L1','maxScore','10')), jsonb_build_array(t.uid('r1'))))));
select t.ok(t.q('a1', format($$select to_jsonb(count(*)) from public.list_resident_exam_records() where event_id = %L$$, t.s('leg'))) <> '0'::jsonb, 'T19a legacy MPL exam created and listed as before');
select t.err_role('service_role', format($$update public.resident_exam_events set managed_by_rc04 = true where id = %L$$, t.s('leg')), 'RC04_MANAGED_EXAM|cannot change', 'T18o a legacy exam cannot be flipped to managed directly');
select t.q('a1', format($$select to_jsonb(public.delete_resident_exam_event(%L))$$, t.s('leg')));
select t.ok((select count(*) = 0 from public.resident_exam_events where id = t.s('leg')::uuid), 'T19b legacy delete of a legacy draft still works');

-- ===== correction (T13/T25/T26/T14)
select t.err('a1', format($$select public.rc04_begin_correction(gen_random_uuid(), %L, %L, '')$$, t.s('exam'), t.s('rev')), 'REASON_REQUIRED', 'T13a correction needs a reason');
select t.put('corr', t.q('a1', format($$select public.rc04_begin_correction(gen_random_uuid(), %L, %L, 'paper recheck')$$, t.s('exam'), t.s('rev'))));
select t.put('rev', t.v('corr')->'revision_id');
select t.err('a1', format($$select public.rc04_begin_correction(gen_random_uuid(), %L, %L, 'again')$$, t.s('exam'), t.s('rev1')), 'WORKING_REVISION_EXISTS', 'T14b only one working revision');
select t.put('M_old', t.q('s1', $$select public.rc04_open_read_set('staff')$$));
select t.put('p1', t.q('s1', format($$select public.rc04_read_page(%L, null, 4)$$, t.v('M_old')->>'manifest_id')));
-- edit metadata, PGY, name, criteria and a score in the working correction
select t.q('a1', format($$select public.rc04_update_working_revision(gen_random_uuid(), %L, %L, %s, %L, 'fix')$$, t.s('exam'), t.s('rev'), t.ver(),
  jsonb_build_object('title','X-ray & Anatomy fixture (corrected)','exam_date','2026-06-21','academic_year',2569,
    'participants', jsonb_build_array(jsonb_build_object('resident_id', t.uid('r3'), 'pgy_at_exam', 3, 'reference_name', 'Fixture R3 corrected')),
    'parts', jsonb_build_array(jsonb_build_object('part_id', t.s('pA'), 'name', 'Part A2', 'mpl', jsonb_build_object('3', 55))))));
select t.ok(t.state('r3','pA') = 'scored:59.99:pass', 'T25a PGY 2→3 + new MPL recomputes r3 Part A in the working copy only');
select t.commit('a1', gen_random_uuid(), t.preview('a1', jsonb_build_array(t.c('r1','pC','scored',13))), 'sat the part later');
select t.ok(t.state('r3','pA','rev1') = 'scored:59.99:fail' and t.state('r1','pC','rev1') = 'awaiting:-:-', 'T13b published revision unchanged');
select t.put('p2', t.q('s1', format($$select public.rc04_read_page(%L, %L, 4)$$, t.v('M_old')->>'manifest_id', t.v('p1')->'next_cursor')));
select t.ok((select bool_and(x->>'revision_id' = t.s('rev1') and x->>'title' = 'X-ray & Anatomy fixture') from jsonb_array_elements(t.v('p2')->'rows') x), 'T13c/T25b during the correction readers get the old metadata and scores');
-- publish the correction between page 2 and 3 of the old read set
select t.q('a1', format($$select public.rc04_mark_reviewed(gen_random_uuid(), %L, %L, %s, '{"absent":1,"awaiting":1}')$$, t.s('exam'), t.s('rev'), t.ver()));
select t.err('a1', format($$select public.rc04_publish_revision(gen_random_uuid(), %L, %L, %s, null, '{"absent":1,"awaiting":1}')$$, t.s('exam'), t.s('rev'), t.ver()), 'PUBLISHED_REVISION_CONFLICT', 'T14c correction must name the current published revision');
select t.put('pub2', t.q('a1', format($$select public.rc04_publish_revision(gen_random_uuid(), %L, %L, %s, %L, '{"absent":1,"awaiting":1}')$$, t.s('exam'), t.s('rev'), t.ver(), t.s('rev1'))));
select t.put('p3', t.q('s1', format($$select public.rc04_read_page(%L, %L, 4)$$, t.v('M_old')->>'manifest_id', t.v('p2')->'next_cursor')));
select t.ok((select bool_and(x->>'revision_id' = t.s('rev1')) from jsonb_array_elements(t.v('p3')->'rows') x)
  and jsonb_array_length(t.v('p1')->'rows') + jsonb_array_length(t.v('p2')->'rows') + jsonb_array_length(t.v('p3')->'rows') = 9, 'T26a a read set started before the new publication stays on the old revision for every page (9 rows, none missing)');
select t.put('newread', t.read_all('s1', 'staff'));
select t.ok((select bool_and(x->>'revision_id' = t.s('rev') and x->>'title' = 'X-ray & Anatomy fixture (corrected)') from jsonb_array_elements(t.v('newread')->'rows') x)
  and (select x->>'reference_name' = 'Fixture R3 corrected' and x->>'pgy_at_exam' = '3' from jsonb_array_elements(t.v('newread')->'rows') x where x->>'resident_id' = t.uid('r3')::text limit 1), 'T25c/T26b a new read set gets the whole new revision (metadata, name, PGY)');
select t.ok((select title = 'X-ray & Anatomy fixture (corrected)' and exam_date = '2026-06-21' and published_revision_id = t.s('rev')::uuid from public.resident_exam_events where id = t.s('exam')::uuid), 'R02b projection switched together with the pointer');
select t.ok((select x->'is_current' = 'false'::jsonb from jsonb_array_elements(t.v('M_old')->'entries') x) is not null, 'R03 manifest entry records which revision was pinned');

-- ===== T16 next year, different PGY, entrant/leaver; history still readable while N+1 is draft
select t.put('created2', t.q('a1', format($$select public.rc04_create_managed_exam(gen_random_uuid(), %L)$$, t.v('create_payload') || jsonb_build_object('academic_year', 2570, 'exam_date', '2027-06-20',
  'roster', jsonb_build_array(jsonb_build_object('resident_id',t.uid('r1'),'pgy_at_exam',3), jsonb_build_object('resident_id',t.uid('r4'),'pgy_at_exam',1))))));
select t.ok((select pgy_at_exam = 2 from public.rc04_revision_participants where revision_id = t.s('rev')::uuid and resident_id = t.uid('r1'))
  and (select pgy_at_exam = 3 from public.rc04_revision_participants where revision_id = (t.v('created2')->>'revision_id')::uuid and resident_id = t.uid('r1')), 'T16a year N keeps PGY 2, year N+1 has PGY 3');
select t.ok((select count(distinct x->>'exam_id') = 1 and bool_and(x->>'academic_year' = '2569') from jsonb_array_elements(t.read_all('r1', 'own')->'rows') x), 'T16b year N history readable while N+1 is a draft');
select t.ok(jsonb_array_length(t.read_all('r2', 'own')->'rows') = 3, 'T16c a leaver (not in N+1) still reads year N');

-- ===== T27 wrong owner, guessed draft, deactivated between pages
select t.put('Mr1', t.q('r1', $$select public.rc04_open_read_set('own', null, null, null)$$));
select t.err('r2', format($$select public.rc04_read_page(%L)$$, t.v('Mr1')->>'manifest_id'), 'READ_SET_NOT_FOUND', 'T27a another Resident cannot use my read set');
select t.err('s1', format($$select public.rc04_open_read_set('staff', %L, null, %L)$$, t.v('created2')->>'exam_id', t.v('created2')->>'revision_id'), 'RC04_NOT_FOUND', 'T27b a guessed draft revision id is refused');
select t.err('r1', format($$select public.rc04_read_page(%L, %L)$$, t.v('Mr1')->>'manifest_id', jsonb_build_object('manifest_id', t.v('M_old')->>'manifest_id', 'i', 0, 'r', t.uid('r1'), 's', 1, 'p', t.s('pA'))), 'INVALID_CURSOR', 'T27c a cursor from another read set is refused');
select t.put('pg_r1', t.q('r1', format($$select public.rc04_read_page(%L, null, 1)$$, t.v('Mr1')->>'manifest_id')));
update public.resident_profiles set active = false where user_id = t.uid('r1');
select t.err('r1', format($$select public.rc04_read_page(%L, %L, 1)$$, t.v('Mr1')->>'manifest_id', t.v('pg_r1')->'next_cursor'), 'RC04_FORBIDDEN', 'T27d deactivated between pages → next page refused');
update public.resident_profiles set active = true where user_id = t.uid('r1');
select t.err('rx', $$select public.rc04_open_read_set('own')$$, 'RC04_FORBIDDEN', 'T27e inactive Resident cannot open a read set');
select t.err('r1', $$select public.rc04_open_read_set('staff')$$, 'RC04_FORBIDDEN', 'T17j a Resident cannot open the Staff scope');

-- audit present for every step, no scores/names in details
select t.ok((select count(*) >= 10 from public.rc04_audit where exam_id = t.s('exam')::uuid)
  and not exists (select 1 from public.rc04_audit where details::text ~ 'Fixture|"score"'), 'AUD audit rows exist and carry no names or scores');

do $$ begin raise notice 'ALL RC04 BEHAVIOUR TESTS PASSED'; end $$;
rollback;
