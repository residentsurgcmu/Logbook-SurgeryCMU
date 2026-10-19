-- RC-04 B002 fixes — behaviour tests (B01 roster cap, B02 p_file_reported, B03 real no-op, cursor validation).
-- Throwaway local database only; everything rolls back. All UUIDs are synthetic FIXTURE ids.
-- psql -v ON_ERROR_STOP=1 -f tests/rc04-managed-exams-b002.sql
begin;
do $$ begin
  if exists (select 1 from public.resident_profiles) then raise exception 'Refusing to run: database already has Resident data'; end if;
end $$;
update public.resident_maintenance_pause set paused = false where scope = 'accounts';
create schema t;
create table t.ctx (k text primary key, v jsonb);
create function t.v(p text) returns jsonb language sql as $$ select v from t.ctx where k = p $$;
create function t.s(p text) returns text language sql as $$ select v #>> '{}' from t.ctx where k = p $$;
create function t.put(p text, x jsonb) returns jsonb language sql as $$ insert into t.ctx values (p, x) on conflict (k) do update set v = excluded.v returning v $$;
create function t.ok(c boolean, l text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL %', l; end if; raise notice 'PASS %', l; end $$;
create function t.id(n integer) returns uuid language sql immutable as $$ select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function t.q(u uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; execute p_sql into v; reset role; return v; end $$;
create function t.err(u uuid, p_sql text, p_pat text, l text) returns void language plpgsql as $$
declare m text;
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin set local role authenticated; execute p_sql; exception when others then get stacked diagnostics m = message_text; end;
  reset role;
  if m is null or m !~* p_pat then raise exception 'FAIL % : expected "%" got "%"', l, p_pat, coalesce(m, 'success'); end if;
  raise notice 'PASS %', l;
end $$;
create function t.ver() returns integer language sql as $$ select version from public.rc04_exam_revisions where id = t.s('rev')::uuid $$;
create function t.reviewed() returns boolean language sql as $$ select checked_version is not distinct from version and checked_version is not null from public.rc04_exam_revisions where id = t.s('rev')::uuid $$;
create function t.snap() returns text language sql as $$
  select (select version || '/' || coalesce(checked_version::text, '-') from public.rc04_exam_revisions where id = t.s('rev')::uuid)
    || '/' || (select count(*) from public.rc04_revision_participants where revision_id = t.s('rev')::uuid)
    || '/' || (select count(*) from public.rc04_revision_results where revision_id = t.s('rev')::uuid)
    || '/' || (select count(*) from public.rc04_request_receipts)
    || '/' || (select count(*) from public.rc04_audit)
    || '/' || (select count(*) from public.rc04_import_previews where expires_at > clock_timestamp()) $$;
create function t.upd(changes jsonb, reason text default null, ver integer default null) returns jsonb language sql as $$
  select t.q(t.id(9001), format('select public.rc04_update_working_revision(gen_random_uuid(), %L, %L, %s, %L, %L)', t.s('exam'), t.s('rev'), coalesce(ver, t.ver()), changes, reason)) $$;
create function t.pv(rep jsonb, use_null_arg boolean default false) returns jsonb language sql as $$
  select t.q(t.id(9001), case when use_null_arg then
      format('select public.rc04_preview_import(%L, %L, %s, %L::jsonb, %L::jsonb, null)', t.s('exam'), t.s('rev'), t.ver(), t.v('cells'), '{}')
    else format('select public.rc04_preview_import(%L, %L, %s, %L::jsonb, %L::jsonb, %L::jsonb)', t.s('exam'), t.s('rev'), t.ver(), t.v('cells'), '{}', rep) end) $$;
grant usage on schema t to authenticated; grant select on all tables in schema t to authenticated; grant execute on all functions in schema t to authenticated;

-- fixture accounts: 1 Admin (9001), 1 Staff (9002), 202 Residents (1..202)
insert into auth.users(id, email) select t.id(n), 'u' || n || '@fixture.test' from (select generate_series(1, 202) n union all select 9001 union all select 9002) g;
insert into public.resident_profiles(user_id, full_name, email, pgy, active) select id, 'Fixture ' || email, email, 2, true from auth.users where email like '%@fixture.test';
insert into public.resident_user_roles(user_id, role, active) select id, case when email = 'u9001@fixture.test' then 'admin'::public.resident_system_role when email = 'u9002@fixture.test' then 'staff' else 'resident' end, true from auth.users where email like '%@fixture.test';

-- exam with 200 residents (1..200), 2 parts
select t.put('c', t.q(t.id(9001), format('select public.rc04_create_managed_exam(gen_random_uuid(), %L)', jsonb_build_object(
  'exam_type','xray_anatomy','title','B002 fixture','exam_date','2026-06-20','academic_year',2569,
  'roster', (select jsonb_agg(jsonb_build_object('resident_id', t.id(n), 'pgy_at_exam', 2)) from generate_series(1, 200) n),
  'parts', jsonb_build_array(jsonb_build_object('name','A','sort_order',1,'max_score',100,'mpl',jsonb_build_object('2',60)),
                             jsonb_build_object('name','B','sort_order',2,'max_score',50,'mpl',jsonb_build_object('2',30)))))));
select t.put('exam', t.v('c')->'exam_id'); select t.put('rev', t.v('c')->'revision_id');
select t.put('pA', to_jsonb((select part_id from public.rc04_revision_parts where revision_id = t.s('rev')::uuid and sort_order = 1)));
select t.put('pB', to_jsonb((select part_id from public.rc04_revision_parts where revision_id = t.s('rev')::uuid and sort_order = 2)));
select t.ok((select count(*) = 200 from public.rc04_revision_participants where revision_id = t.s('rev')::uuid), 'S0 roster of 200 created');

-- ===== B01 final roster 1-200, all or nothing
select t.put('before', to_jsonb(t.snap()));
select t.err(t.id(9001), format('select public.rc04_update_working_revision(gen_random_uuid(), %L, %L, %s, %L)', t.s('exam'), t.s('rev'), t.ver(),
  jsonb_build_object('add_participants', jsonb_build_array(jsonb_build_object('resident_id', t.id(201), 'pgy_at_exam', 2)))), 'RC04_LIMIT.*201', 'B01a 200 + 1 is refused');
select t.ok(t.snap() = t.s('before'), 'B01b ... nothing changed (roster, results, version, review, previews, receipts, audit)');
select t.err(t.id(9001), format('select public.rc04_update_working_revision(gen_random_uuid(), %L, %L, %s, %L)', t.s('exam'), t.s('rev'), t.ver(),
  jsonb_build_object('participants', jsonb_build_array(jsonb_build_object('resident_id', t.id(1), 'reference_name', 'renamed')),
                     'remove_participants', jsonb_build_array(t.id(2)),
                     'add_participants', jsonb_build_array(jsonb_build_object('resident_id', t.id(201), 'pgy_at_exam', 2), jsonb_build_object('resident_id', t.id(202), 'pgy_at_exam', 2)))), 'RC04_LIMIT.*201', 'B01c several items: 200 − 1 + 2 = 201 refused');
select t.ok(t.snap() = t.s('before') and (select reference_name <> 'renamed' from public.rc04_revision_participants where revision_id = t.s('rev')::uuid and resident_id = t.id(1))
  and exists (select 1 from public.rc04_revision_participants where revision_id = t.s('rev')::uuid and resident_id = t.id(2)), 'B01d ... and none of its items stayed (rename, removal rolled back)');
select t.put('u1', t.upd(jsonb_build_object('remove_participants', jsonb_build_array(t.id(2)), 'add_participants', jsonb_build_array(jsonb_build_object('resident_id', t.id(201), 'pgy_at_exam', 2)))));
select t.ok((t.v('u1')->>'noop')::boolean = false and (select count(*) = 200 from public.rc04_revision_participants where revision_id = t.s('rev')::uuid)
  and (select count(*) = 400 from public.rc04_revision_results where revision_id = t.s('rev')::uuid), 'B01e 200 − 1 + 1 succeeds (final 200, 400 cells)');
select t.ok(not exists (select 1 from public.rc04_revision_participants where revision_id = t.s('rev')::uuid and resident_id = t.id(2)), 'B01f the removed resident is gone');

-- ===== B02 p_file_reported
select t.put('cells', jsonb_build_array(jsonb_build_object('resident_id', t.id(1), 'part_id', t.s('pA'), 'state', 'scored', 'score', 70)));
select t.put('good', jsonb_build_object('template_version','RC04-TEMPLATE-1','exam_id',t.s('exam'),'revision_id',t.s('rev'),'version',t.ver(),'academic_year',2569));
select t.put('nprev', to_jsonb((select count(*) from public.rc04_import_previews)));
select t.ok((t.q(t.id(9001), format('select public.rc04_preview_import(%L, %L, %s, %L::jsonb)', t.s('exam'), t.s('rev'), t.ver(), t.v('cells')))->>'ok')::boolean, 'B02a argument omitted → allowed (no file metadata sent)');
select t.ok((t.pv(null, true)->>'ok')::boolean, 'B02b SQL NULL → allowed (no file metadata sent)');
create function t.bad(rep jsonb, code text, l text) returns void language plpgsql as $$
declare r jsonb; n0 bigint := (select count(*) from public.rc04_import_previews);
begin
  r := t.pv(rep);
  perform t.ok((r->>'ok')::boolean = false and r->'preview_id' = 'null'::jsonb and (select count(*) from public.rc04_import_previews) = n0
    and exists (select 1 from jsonb_array_elements(r->'errors') e where e->>'code' = code), l || ' → ' || code || ', no preview');
end $$;
select t.bad('null'::jsonb, 'FILE_REPORTED_NOT_OBJECT', 'B02c JSON null');
select t.bad('{}'::jsonb, 'FILE_REPORTED_MISSING_KEY', 'B02d {}');
select t.bad('[]'::jsonb, 'FILE_REPORTED_NOT_OBJECT', 'B02e []');
select t.bad('"x"'::jsonb, 'FILE_REPORTED_NOT_OBJECT', 'B02f scalar string');
select t.bad('5'::jsonb, 'FILE_REPORTED_NOT_OBJECT', 'B02g scalar number');
select t.bad(t.v('good') - 'version', 'FILE_REPORTED_MISSING_KEY', 'B02h required key missing (version)');
select t.bad(t.v('good') || '{"exam_id": null, "version": null, "academic_year": null}', 'FILE_REPORTED_NULL', 'B02i required keys = null (the G0 trigger)');
select t.bad(t.v('good') || jsonb_build_object('version', t.ver()::text), 'FILE_REPORTED_WRONG_TYPE', 'B02j version as a string');
select t.bad(t.v('good') || '{"exam_id": "not-a-uuid"}', 'FILE_REPORTED_WRONG_TYPE', 'B02k exam_id not a uuid (no SQL cast error)');
select t.bad(t.v('good') || '{"academic_year": 2569.5}', 'FILE_REPORTED_WRONG_TYPE', 'B02l academic_year not an integer');
select t.bad(t.v('good') || '{"roster": null}', 'FILE_REPORTED_WRONG_TYPE', 'B02m roster = null');
select t.bad(t.v('good') || '{"roster": {}}', 'FILE_REPORTED_WRONG_TYPE', 'B02n roster not an array');
select t.bad(t.v('good') || jsonb_build_object('roster', jsonb_build_array(jsonb_build_object('resident_id', t.id(1), 'pgy_at_exam', '2'))), 'FILE_REPORTED_WRONG_TYPE', 'B02o roster item with PGY as text');
select t.bad(t.v('good') || jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('part_id', t.s('pA'), 'max_score', 100))), 'FILE_REPORTED_WRONG_TYPE', 'B02p part without mpl');
select t.bad(t.v('good') || '{"surprise": 1}', 'FILE_REPORTED_UNKNOWN_KEY', 'B02q unknown key');
select t.bad(t.v('good') || '{"academic_year": 2570}', 'ACADEMIC_YEAR_MISMATCH', 'B02r valid type, wrong value');
select t.bad(t.v('good') || jsonb_build_object('roster', jsonb_build_array(jsonb_build_object('resident_id', t.id(1), 'pgy_at_exam', 3))), 'ROSTER_OR_PGY_MISMATCH', 'B02s PGY in the file differs from the snapshot');
select t.bad(t.v('good') || jsonb_build_object('roster', jsonb_build_array(jsonb_build_object('resident_id', t.id(1), 'pgy_at_exam', 2), jsonb_build_object('resident_id', t.id(1), 'pgy_at_exam', 2))), 'FILE_REPORTED_DUPLICATE', 'B02t duplicate roster entry');
select t.ok((t.pv(t.v('good') || jsonb_build_object('roster', jsonb_build_array(jsonb_build_object('resident_id', t.id(1), 'pgy_at_exam', 2, 'cell_ref', 'C5')),
  'parts', jsonb_build_array(jsonb_build_object('part_id', t.s('pA'), 'max_score', 100, 'mpl', jsonb_build_object('2', 60)))))->>'ok')::boolean, 'B02u valid metadata (partial roster/parts allowed) → preview');
select t.ok((select pgy_at_exam = 2 from public.rc04_revision_participants where revision_id = t.s('rev')::uuid and resident_id = t.id(1))
  and (select mpl = 60 from public.rc04_revision_mpl where revision_id = t.s('rev')::uuid and part_id = t.s('pA')::uuid and pgy = 2), 'B02v the file never writes PGY or MPL');
select t.ok((select bool_and(value_state = 'unknown') from public.rc04_revision_results where revision_id = t.s('rev')::uuid), 'B02w no preview wrote any result (all-or-nothing)');

-- ===== B03 saving the same values is a real no-op (review and previews kept)
select t.put('pvx', t.pv(t.v('good') || jsonb_build_object('version', t.ver())));
update public.rc04_revision_results set value_state = 'absent' where revision_id = t.s('rev')::uuid; -- setup only: make the revision reviewable
select t.q(t.id(9001), format($$select public.rc04_mark_reviewed(gen_random_uuid(), %L, %L, %s, '{"absent":400,"awaiting":0}')$$, t.s('exam'), t.s('rev'), t.ver()));
select t.put('base', to_jsonb(t.snap()));
select t.ok(t.reviewed(), 'B03a setup: reviewed, with an open preview');
select t.put('n1', t.upd('{"title":"B002 fixture"}'));
select t.ok((t.v('n1')->>'noop')::boolean and t.reviewed(), 'B03b same title → no-op, review kept');
select t.put('n2', t.upd(jsonb_build_object('participants', jsonb_build_array(jsonb_build_object('resident_id', t.id(1), 'pgy_at_exam', 2, 'reference_name', (select reference_name from public.rc04_revision_participants where revision_id = t.s('rev')::uuid and resident_id = t.id(1)))))));
select t.ok((t.v('n2')->>'noop')::boolean and t.reviewed(), 'B03c same PGY and name → no-op');
select t.put('n3', t.upd(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('part_id', t.s('pA'), 'name', 'A', 'max_score', 100.00, 'mpl', jsonb_build_object('2', 60.0))))));
select t.ok((t.v('n3')->>'noop')::boolean and t.reviewed(), 'B03d same name/max/MPL (other number formats) → no-op');
select t.put('n4', t.upd(jsonb_build_object('title', ' B002 fixture ', 'exam_date', '2026-06-20', 'academic_year', 2569,
  'participants', jsonb_build_array(jsonb_build_object('resident_id', t.id(3), 'pgy_at_exam', 2)),
  'parts', jsonb_build_array(jsonb_build_object('part_id', t.s('pB'), 'max_score', 50, 'mpl', jsonb_build_object('2', 30))))));
select t.ok((t.v('n4')->>'noop')::boolean and t.reviewed(), 'B03e mixed payload of unchanged values → no-op');
select t.ok(substring(t.snap() from '^[^/]+/[^/]+/[^/]+/[^/]+') = substring(t.s('base') from '^[^/]+/[^/]+/[^/]+/[^/]+')
  and split_part(t.snap(), '/', 7) = split_part(t.s('base'), '/', 7) and split_part(t.snap(), '/', 6) = split_part(t.s('base'), '/', 6), 'B03f version, review, roster, cells, audit and open previews unchanged');
select t.ok((select count(*) = 4 from public.rc04_request_receipts r where r.operation = 'update_working_revision' and (r.result->>'noop')::boolean), 'B03g each no-op still has its receipt');
select t.err(t.id(9001), format('select public.rc04_update_working_revision(gen_random_uuid(), %L, %L, %s, %L)', t.s('exam'), t.s('rev'), t.ver() - 1, '{"title":"B002 fixture"}'), 'RC04_REVISION_CONFLICT', 'B03h a new request with an old expected_version conflicts even when it sends the same values');
select t.put('ch', t.upd('{"title":"B002 fixture (real change)"}'));
select t.ok((t.v('ch')->>'noop')::boolean = false and not t.reviewed() and (select count(*) = 0 from public.rc04_import_previews where expires_at > clock_timestamp() and consumed_at is null), 'B03i a real change bumps, clears review and expires previews');
select t.put('ch2', t.upd(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('part_id', t.s('pA'), 'mpl', jsonb_build_object('2', 61)))))) ;
select t.ok((t.v('ch2')->>'noop')::boolean = false and (t.v('ch2')->>'version')::int = t.ver(), 'B03j a real MPL change bumps the version');
select t.put('ch3', t.upd(jsonb_build_object('remove_participants', jsonb_build_array(t.id(3)), 'add_participants', jsonb_build_array(jsonb_build_object('resident_id', t.id(3), 'pgy_at_exam', 2))), 'redo'));
select t.ok((t.v('ch3')->>'noop')::boolean = false and (select bool_and(value_state = 'unknown') from public.rc04_revision_results where revision_id = t.s('rev')::uuid and resident_id = t.id(3)),
  'B03k remove + add of the same resident is a real change (results start again as unknown), not a no-op');

-- ===== cursor validation (§5.2)
-- publish so readers have something
select t.q(t.id(9001), format('select public.rc04_commit_import(gen_random_uuid(), %L, %s, %L, %L)', p->>'preview_id', p->>'expected_version', p->>'delta_fingerprint', 'fill'))
  from (select t.q(t.id(9001), format('select public.rc04_preview_import(%L, %L, %s, %L::jsonb)', t.s('exam'), t.s('rev'), t.ver(),
    jsonb_build_array(jsonb_build_object('resident_id', t.id(3), 'part_id', t.s('pA'), 'state', 'absent'), jsonb_build_object('resident_id', t.id(3), 'part_id', t.s('pB'), 'state', 'absent')))) p) x;
select t.q(t.id(9001), format($$select public.rc04_mark_reviewed(gen_random_uuid(), %L, %L, %s, '{"absent":400,"awaiting":0}')$$, t.s('exam'), t.s('rev'), t.ver()));
select t.q(t.id(9001), format($$select public.rc04_publish_revision(gen_random_uuid(), %L, %L, %s, null, '{"absent":400,"awaiting":0}')$$, t.s('exam'), t.s('rev'), t.ver()));
select t.put('M', t.q(t.id(9002), $$select public.rc04_open_read_set('staff')$$));
select t.put('M', t.v('M')->'manifest_id');
select t.put('P1', t.q(t.id(9002), format('select public.rc04_read_page(%L, null, 3)', t.s('M'))));
create function t.badcur(cur jsonb, l text) returns void language sql as $$
  select t.err(t.id(9002), format('select public.rc04_read_page(%L, %L::jsonb, 3)', t.s('M'), cur), 'RC04_INVALID_CURSOR', l) $$;
select t.badcur((t.v('P1')->'next_cursor') - 'i'::text, 'K1 missing i');
select t.badcur(t.v('P1')->'next_cursor' || '{"r": null}', 'K2 r = null');
select t.badcur(t.v('P1')->'next_cursor' || '{"s": "1"}', 'K3 s as a string');
select t.badcur(t.v('P1')->'next_cursor' || '{"p": "not-a-uuid"}', 'K4 p not a uuid');
select t.badcur(t.v('P1')->'next_cursor' || '{"i": -1}', 'K5 negative i');
select t.badcur(t.v('P1')->'next_cursor' || '{"i": 99}', 'K6 i outside the read set');
select t.badcur(t.v('P1')->'next_cursor' || '{"extra": 1}', 'K7 extra key');
select t.badcur('null'::jsonb, 'K8 JSON null');
select t.badcur('[]'::jsonb, 'K9 array');
select t.badcur(jsonb_build_object('manifest_id', t.s('M')), 'K10 only manifest_id (G0 trigger: was [] + done)');
select t.badcur(t.v('P1')->'next_cursor' || jsonb_build_object('manifest_id', gen_random_uuid()), 'K11 cursor of another read set');
select t.err(t.id(1), format('select public.rc04_read_page(%L, %L::jsonb, 3)', t.s('M'), t.v('P1')->'next_cursor'), 'READ_SET_NOT_FOUND', 'K12 a valid cursor used by another user');
select t.put('P2', t.q(t.id(9002), format('select public.rc04_read_page(%L, %L::jsonb, 3)', t.s('M'), t.v('P1')->'next_cursor')));
select t.ok((t.v('P2')->>'row_count')::int = 3 and (t.v('P2')->'rows'->0->>'resident_id', t.v('P2')->'rows'->0->>'part_sort_order') > (t.v('P1')->'rows'->2->>'resident_id', t.v('P1')->'rows'->2->>'part_sort_order'), 'K13 a valid cursor continues after the last key');
update public.resident_user_roles set active = false where user_id = t.id(9002);
select t.err(t.id(9002), format('select public.rc04_read_page(%L, %L::jsonb, 3)', t.s('M'), t.v('P2')->'next_cursor'), 'RC04_FORBIDDEN', 'K14 active role still checked on every page');

do $$ begin raise notice 'ALL RC04 B002 TESTS PASSED'; end $$;
rollback;
