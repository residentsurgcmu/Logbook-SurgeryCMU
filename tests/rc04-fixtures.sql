-- RC-04 fixture generator (synthetic data only). Runs every interface case once inside a rolled-back transaction and
-- prints one JSON document {cases:[{case, call, request, response | error}]}. UUIDs are FIXTURE ids.
-- psql -X -q -At -v ON_ERROR_STOP=1 -f tests/rc04-fixtures.sql > fixtures.json
\set QUIET on
begin;
do $$ begin if exists (select 1 from public.resident_profiles) then raise exception 'throwaway database only'; end if; end $$;
update public.resident_maintenance_pause set paused = false where scope = 'accounts';
create temp table fx (n serial, name text, call text, request jsonb, response jsonb, error jsonb);
grant all on fx to authenticated; grant all on sequence fx_n_seq to authenticated;
insert into auth.users(id, email) select ('10000000-0000-4000-8000-0000000000'||x)::uuid, x||'@fixture.test' from unnest(array['a1','b1','c1','c2']) x;
insert into public.resident_profiles(user_id,full_name,email,pgy,active) select id,'Fixture '||split_part(email,'@',1),email,case when email like 'c%' then 2 end,true from auth.users;
insert into public.resident_user_roles(user_id,role,active) select id, case when email like 'a%' then 'admin'::public.resident_system_role when email like 'b%' then 'staff' else 'resident' end, true from auth.users;
create function pg_temp.call(p_name text, p_user text, p_fn text, p_args jsonb) returns jsonb language plpgsql as $f$
declare v jsonb; m text; st text; sql text; v_missing text;
begin
  -- every argument without a default must be present in the request (null is allowed and kept as JSON null)
  select string_agg(a, ', ') into v_missing
    from (select unnest(p.proargnames[1:(p.pronargs - p.pronargdefaults)]) a from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = p_fn) req
   where not p_args ? a;
  if v_missing is not null then raise exception 'fixture %: request misses required argument(s) %', p_name, v_missing; end if;
  sql := format('select public.%I(%s)', p_fn, (select string_agg(format('%s => %L::%s', k, coalesce(p_args->>k, null), t), ', ' order by ord)
           from jsonb_each(p_args) with ordinality e(k, val, ord)
           cross join lateral (select case when k in ('p_request_id','p_exam_id','p_revision_id','p_preview_id','p_manifest_id','p_expected_published_revision_id') then 'uuid'
                                           when k in ('p_expected_version','p_limit','p_academic_year') then 'integer'
                                           when k in ('p_reason','p_delta_fingerprint','p_scope') then 'text' else 'jsonb' end t) tt));
  perform set_config('request.jwt.claim.sub', ('10000000-0000-4000-8000-0000000000' || p_user), true);
  begin
    set local role authenticated; execute sql into v; reset role;
    insert into fx (name, call, request, response) values (p_name, p_fn, p_args, v);
  exception when others then get stacked diagnostics m = message_text, st = returned_sqlstate; reset role;
    insert into fx (name, call, request, error) values (p_name, p_fn, p_args, jsonb_build_object('code', split_part(m, ':', 1), 'message', m, 'sqlstate', st));
  end;
  return v;
end $f$;
do $$
declare c jsonb; ex text; rv text; pa text; pb text; pv jsonb; m jsonb; pg jsonb; w text; R1 text := '10000000-0000-4000-8000-0000000000c1'; R2 text := '10000000-0000-4000-8000-0000000000c2';
begin
  c := pg_temp.call('create managed exam', 'a1', 'rc04_create_managed_exam', jsonb_build_object('p_request_id', '20000000-0000-4000-8000-000000000001',
    'p_payload', jsonb_build_object('exam_type','xray_anatomy','title','X-ray & Anatomy fixture','exam_date','2026-06-20','academic_year',2569,
      'roster', jsonb_build_array(jsonb_build_object('resident_id',R1,'pgy_at_exam',2), jsonb_build_object('resident_id',R2,'pgy_at_exam',3,'reference_name','Fixture R2 (as on the paper)')),
      'parts', jsonb_build_array(jsonb_build_object('name','Part A','sort_order',1,'max_score',100,'mpl',jsonb_build_object('2',60,'3',65)),
                                 jsonb_build_object('name','Part B','sort_order',2,'max_score',50,'mpl',jsonb_build_object('2',30,'3',30))))));
  ex := c->>'exam_id'; rv := c->>'revision_id';
  perform pg_temp.call('create replay (same request, same payload)', 'a1', 'rc04_create_managed_exam', (select request from fx where n = 1));
  perform pg_temp.call('create key reuse (same request, other payload)', 'a1', 'rc04_create_managed_exam', jsonb_set((select request from fx where n = 1), '{p_payload,title}', '"other"'));
  perform pg_temp.call('create by a Resident (forbidden)', 'c1', 'rc04_create_managed_exam', (select request from fx where n = 1));
  c := pg_temp.call('template', 'a1', 'rc04_get_import_template', jsonb_build_object('p_exam_id', ex, 'p_revision_id', rv));
  pa := c->'parts'->0->>'part_id'; pb := c->'parts'->1->>'part_id';
  perform pg_temp.call('preview with errors (position kept, nothing written)', 'a1', 'rc04_preview_import', jsonb_build_object('p_exam_id', ex, 'p_revision_id', rv, 'p_expected_version', 1,
    'p_cells', jsonb_build_array(jsonb_build_object('resident_id',R1,'part_id',pa,'state','scored','score',101,'cell_ref','D5'),
                                 jsonb_build_object('resident_id',R1,'part_id',pb,'state','scored','score','55ผ่าน','cell_ref','E5'),
                                 jsonb_build_object('resident_id',R2,'part_id',pa,'state','absent','score',3,'cell_ref','D6')),
    'p_file_evidence', '{"file_hash":"fixture-sha256"}'::jsonb, 'p_file_reported', null));
  pv := pg_temp.call('preview partial: scored 0, absent, awaiting; one cell left blank (stays unknown)', 'a1', 'rc04_preview_import', jsonb_build_object('p_exam_id', ex, 'p_revision_id', rv, 'p_expected_version', 1,
    'p_cells', jsonb_build_array(jsonb_build_object('resident_id',R1,'part_id',pa,'state','scored','score',0,'cell_ref','D5'),
                                 jsonb_build_object('resident_id',R1,'part_id',pb,'state','absent','cell_ref','E5'),
                                 jsonb_build_object('resident_id',R2,'part_id',pa,'state','awaiting','cell_ref','D6')),
    'p_file_evidence', '{"file_hash":"fixture-sha256","file_name":"fixture.xlsx"}'::jsonb,
    'p_file_reported', jsonb_build_object('template_version','RC04-TEMPLATE-1','exam_id',ex,'revision_id',rv,'version',1,'academic_year',2569)));
  perform pg_temp.call('commit import', 'a1', 'rc04_commit_import', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000002','p_preview_id',pv->>'preview_id','p_expected_version',1,'p_delta_fingerprint',pv->>'delta_fingerprint','p_reason',null));
  perform pg_temp.call('commit replay after lost response', 'a1', 'rc04_commit_import', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000002','p_preview_id',pv->>'preview_id','p_expected_version',1,'p_delta_fingerprint',pv->>'delta_fingerprint','p_reason',null));
  perform pg_temp.call('new request from the old template (conflict)', 'a1', 'rc04_commit_import', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000003','p_preview_id',pv->>'preview_id','p_expected_version',1,'p_delta_fingerprint',pv->>'delta_fingerprint','p_reason',null));
  perform pg_temp.call('preview against an old version (conflict)', 'a1', 'rc04_preview_import', jsonb_build_object('p_exam_id', ex, 'p_revision_id', rv, 'p_expected_version', 1, 'p_cells', '[]'::jsonb, 'p_file_evidence', '{}'::jsonb, 'p_file_reported', null));
  pv := pg_temp.call('preview same values again (no change)', 'a1', 'rc04_preview_import', jsonb_build_object('p_exam_id', ex, 'p_revision_id', rv, 'p_expected_version', 2,
    'p_cells', jsonb_build_array(jsonb_build_object('resident_id',R1,'part_id',pa,'state','scored','score',0)), 'p_file_evidence', '{"file_hash":"another-hash"}'::jsonb, 'p_file_reported', null));
  perform pg_temp.call('commit no-op', 'a1', 'rc04_commit_import', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000004','p_preview_id',pv->>'preview_id','p_expected_version',2,'p_delta_fingerprint',pv->>'delta_fingerprint','p_reason',null));
  pv := pg_temp.call('preview fill the rest (R2 Part B fails)', 'a1', 'rc04_preview_import', jsonb_build_object('p_exam_id', ex, 'p_revision_id', rv, 'p_expected_version', 2,
    'p_cells', jsonb_build_array(jsonb_build_object('resident_id',R2,'part_id',pb,'state','scored','score',12.5)), 'p_file_evidence', '{}'::jsonb, 'p_file_reported', null));
  perform pg_temp.call('commit fill', 'a1', 'rc04_commit_import', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000005','p_preview_id',pv->>'preview_id','p_expected_version',2,'p_delta_fingerprint',pv->>'delta_fingerprint','p_reason',null));
  perform pg_temp.call('admin view of the working revision (validation + overall)', 'a1', 'rc04_admin_get_revision', jsonb_build_object('p_exam_id', ex, 'p_revision_id', rv));
  perform pg_temp.call('mark reviewed with wrong counts', 'a1', 'rc04_mark_reviewed', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000006','p_exam_id',ex,'p_revision_id',rv,'p_expected_version',3,'p_confirm','{"absent":0,"awaiting":0}'::jsonb));
  perform pg_temp.call('mark reviewed', 'a1', 'rc04_mark_reviewed', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000007','p_exam_id',ex,'p_revision_id',rv,'p_expected_version',3,'p_confirm','{"absent":1,"awaiting":1}'::jsonb));
  perform pg_temp.call('publish', 'a1', 'rc04_publish_revision', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000008','p_exam_id',ex,'p_revision_id',rv,'p_expected_version',3,'p_expected_published_revision_id',null,'p_confirm','{"absent":1,"awaiting":1}'::jsonb));
  m := pg_temp.call('Staff opens a read set (old publication)', 'b1', 'rc04_open_read_set', jsonb_build_object('p_scope','staff','p_exam_id',null,'p_academic_year',null,'p_revision_id',null));
  pg := pg_temp.call('Staff page 1 (limit 2): incomplete + failed, absent/awaiting rows with null score', 'b1', 'rc04_read_page', jsonb_build_object('p_manifest_id', m->>'manifest_id', 'p_cursor', null, 'p_limit', 2));
  perform pg_temp.call('Resident own history', 'c2', 'rc04_open_read_set', jsonb_build_object('p_scope','own','p_exam_id',null,'p_academic_year',null,'p_revision_id',null));
  w := (pg_temp.call('begin correction', 'a1', 'rc04_begin_correction', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000009','p_exam_id',ex,'p_expected_published_revision_id',rv,'p_reason','paper recheck')))->>'revision_id';
  perform pg_temp.call('edit the draft correction (title, PGY, criteria)', 'a1', 'rc04_update_working_revision', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000010','p_exam_id',ex,'p_revision_id',w,'p_expected_version',1,
    'p_changes', jsonb_build_object('title','X-ray & Anatomy fixture (corrected)','parts', jsonb_build_array(jsonb_build_object('part_id',pb,'mpl',jsonb_build_object('3',12)))),'p_reason','criteria typo'));
  perform pg_temp.call('mark reviewed correction', 'a1', 'rc04_mark_reviewed', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000011','p_exam_id',ex,'p_revision_id',w,'p_expected_version',2,'p_confirm','{"absent":1,"awaiting":1}'::jsonb));
  perform pg_temp.call('publish correction', 'a1', 'rc04_publish_revision', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000012','p_exam_id',ex,'p_revision_id',w,'p_expected_version',2,'p_expected_published_revision_id',rv,'p_confirm','{"absent":1,"awaiting":1}'::jsonb));
  perform pg_temp.call('Staff page 2 of the OLD read set after the correction was published (still old revision)', 'b1', 'rc04_read_page', jsonb_build_object('p_manifest_id', m->>'manifest_id', 'p_cursor', pg->'next_cursor', 'p_limit', 2));
  m := pg_temp.call('Staff opens a NEW read set (new publication)', 'b1', 'rc04_open_read_set', jsonb_build_object('p_scope','staff','p_exam_id',null,'p_academic_year',null,'p_revision_id',null));
  perform pg_temp.call('Staff page of the new read set', 'b1', 'rc04_read_page', jsonb_build_object('p_manifest_id', m->>'manifest_id', 'p_cursor', null, 'p_limit', 10));
  perform pg_temp.call('another user uses that read set (refused)', 'c1', 'rc04_read_page', jsonb_build_object('p_manifest_id', m->>'manifest_id', 'p_cursor', null, 'p_limit', 10));
  perform pg_temp.call('Admin list of managed exams', 'a1', 'rc04_admin_list_exams', jsonb_build_object('p_academic_year', null));
  perform pg_temp.call('cursor with missing keys (refused, not an empty page)', 'b1', 'rc04_read_page', jsonb_build_object('p_manifest_id', m->>'manifest_id', 'p_cursor', jsonb_build_object('manifest_id', m->>'manifest_id'), 'p_limit', 10));
  w := (pg_temp.call('begin second correction', 'a1', 'rc04_begin_correction', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000013','p_exam_id',ex,'p_expected_published_revision_id',w,'p_reason','second look')))->>'revision_id';
  perform pg_temp.call('update with the same values (no-op: version and review kept)', 'a1', 'rc04_update_working_revision', jsonb_build_object('p_request_id','20000000-0000-4000-8000-000000000014','p_exam_id',ex,'p_revision_id',w,'p_expected_version',1,
    'p_changes', jsonb_build_object('title','X-ray & Anatomy fixture (corrected)'),'p_reason',null));
  perform pg_temp.call('preview with file metadata {} (refused)', 'a1', 'rc04_preview_import', jsonb_build_object('p_exam_id', ex, 'p_revision_id', w, 'p_expected_version', 1,
    'p_cells', '[]'::jsonb, 'p_file_evidence', '{}'::jsonb, 'p_file_reported', '{}'::jsonb));
  perform pg_temp.call('p_file_reported null over the API arrives as SQL NULL = metadata not sent (accepted; proves nothing about a file)', 'a1', 'rc04_preview_import', jsonb_build_object('p_exam_id', ex, 'p_revision_id', w, 'p_expected_version', 1,
    'p_cells', '[]'::jsonb, 'p_file_evidence', '{}'::jsonb, 'p_file_reported', 'null'::jsonb));
end $$;
select jsonb_pretty(jsonb_build_object('fixture_note', 'Synthetic data from tests/rc04-fixtures.sql; every UUID is a fixture id. Nulls inside request/response are kept exactly as sent/returned (a JSON null argument is passed as SQL NULL). Each case has either response or error. Errors are what PostgREST returns as message/code (P0001); the RC04_* prefix before ":" is the error code.',
  'cases', (select jsonb_agg(jsonb_build_object('n', n, 'case', name, 'call', call, 'request', request)
      || case when error is null then jsonb_build_object('response', response) else jsonb_build_object('error', error) end order by n) from fx)));
rollback;
