-- RC-04 release INVENTORY (read-only, after migration 20261019090000; run together with rc04_release_checks_post.sql).
-- Fail-closed: every expected object is listed by name/signature and LEFT JOINed to the catalog, so a missing object
-- gives ok = false (never a vacuous "nothing found" true). Expected: exactly 65 rows, every ok = true.
-- This is a catalog inventory, not a proof of production privileges over HTTP.
with
tables(name) as (values ('rc04_exam_revisions'),('rc04_revision_parts'),('rc04_revision_mpl'),('rc04_revision_participants'),('rc04_revision_results'),
  ('rc04_import_previews'),('rc04_import_batches'),('rc04_request_receipts'),('rc04_audit'),('rc04_read_manifests')),
cols(name) as (values ('managed_by_rc04'),('published_revision_id')),
pub(sig) as (values ('rc04_admin_get_revision(uuid,uuid)'),('rc04_admin_list_exams(integer)'),('rc04_begin_correction(uuid,uuid,uuid,text)'),
  ('rc04_commit_import(uuid,uuid,integer,text,text)'),('rc04_create_managed_exam(uuid,jsonb)'),('rc04_get_import_template(uuid,uuid)'),
  ('rc04_mark_reviewed(uuid,uuid,uuid,integer,jsonb)'),('rc04_open_read_set(text,uuid,integer,uuid)'),('rc04_preview_import(uuid,uuid,integer,jsonb,jsonb,jsonb)'),
  ('rc04_publish_revision(uuid,uuid,uuid,integer,uuid,jsonb)'),('rc04_read_page(uuid,jsonb,integer)'),('rc04_update_working_revision(uuid,uuid,uuid,integer,jsonb,text)')),
priv(sig) as (values ('rc04_audit(uuid,uuid,uuid,text,text,integer,integer,uuid,jsonb)'),('rc04_bump(uuid)'),('rc04_file_reported_errors(jsonb,uuid,uuid)'),
  ('rc04_fp(jsonb)'),('rc04_guard_exam_event()'),('rc04_guard_immutable()'),('rc04_guard_legacy_child()'),('rc04_is_managed_exam(uuid)'),('rc04_lock_exam(uuid)'),
  ('rc04_lock_revision(uuid,uuid)'),('rc04_overall(uuid,uuid)'),('rc04_receipt_begin(uuid,text,uuid,jsonb)'),('rc04_receipt_finish(uuid,text,uuid,jsonb)'),
  ('rc04_recompute(uuid)'),('rc04_reject_managed_exam(uuid)'),('rc04_require_admin()'),('rc04_require_working(rc04_exam_revisions,integer)'),
  ('rc04_score_error(jsonb,numeric)'),('rc04_validation(uuid)')),
trg(tbl, name) as (values ('resident_exam_events','rc04_guard_exam_event'),('resident_exam_participants','rc04_guard_legacy_child'),('resident_exam_parts','rc04_guard_legacy_child'),
  ('resident_exam_results','rc04_guard_legacy_child'),('resident_exam_mpl','rc04_guard_legacy_child'),('rc04_exam_revisions','rc04_immutable'),('rc04_revision_parts','rc04_immutable'),
  ('rc04_revision_mpl','rc04_immutable'),('rc04_revision_participants','rc04_immutable'),('rc04_revision_results','rc04_immutable'),('rc04_audit','rc04_immutable'),
  ('rc04_audit','rc04_immutable_truncate')),
legacy(name) as (values ('save_resident_exam_scores'),('save_resident_exam_results'),('set_resident_exam_publication'),('update_resident_exam_mpl'),('delete_resident_exam_event')),
clients(r) as (select rolname from pg_roles where rolname in ('anon','authenticated','authenticator','service_role'))
select 'I-table ' || t.name || ': exists, RLS on, owner postgres' as check_name,
       coalesce(c.relrowsecurity and pg_get_userbyid(c.relowner) = 'postgres', false) as ok
  from tables t left join pg_class c on c.oid = to_regclass('public.' || t.name)
union all
select 'I-column resident_exam_events.' || k.name, exists (select 1 from pg_attribute a where a.attrelid = 'public.resident_exam_events'::regclass and a.attname = k.name and not a.attisdropped)
  from cols k
union all
select 'I-rpc public.' || f.sig || ': SECURITY DEFINER, search_path empty, owner postgres, authenticated only',
       coalesce(p.prosecdef and p.proconfig = array['search_path=""'] and pg_get_userbyid(p.proowner) = 'postgres'
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and not exists (select 1 from clients c where c.r <> 'authenticated' and has_function_privilege(c.r, p.oid, 'EXECUTE')), false)
  from pub f left join pg_proc p on p.oid = to_regprocedure('public.' || f.sig)
union all
select 'I-helper private.' || f.sig || ': exists, owner postgres, no client role can execute',
       coalesce(pg_get_userbyid(p.proowner) = 'postgres' and not exists (select 1 from clients c where has_function_privilege(c.r, p.oid, 'EXECUTE')), false)
  from priv f left join pg_proc p on p.oid = to_regprocedure('private.' || f.sig)
union all
select 'I-trigger ' || t.tbl || '.' || t.name || ': exists and enabled',
       coalesce(g.tgenabled = 'O', false)
  from trg t left join pg_trigger g on g.tgrelid = to_regclass('public.' || t.tbl) and g.tgname = t.name and not g.tgisinternal
union all
select 'I-policy resident_exam_events_visible excludes managed exams',
       coalesce((select qual ~ 'managed_by_rc04' from pg_policies where schemaname = 'public' and tablename = 'resident_exam_events' and policyname = 'resident_exam_events_visible'), false)
union all
select 'I-legacy writer public.' || l.name || ' rejects managed exams',
       coalesce((select bool_or(pg_get_functiondef(p.oid) ~ 'perform private\.rc04_reject_managed_exam\(p_event_id\)') from pg_proc p
                  where p.pronamespace = 'public'::regnamespace and p.proname = l.name), false)
  from legacy l
union all
select 'I-legacy writer private.resident_exam_replace_mpl rejects managed exams',
       coalesce((select pg_get_functiondef(p.oid) ~ 'perform private\.rc04_reject_managed_exam\(p_event_id\)' from pg_proc p where p.oid = to_regprocedure('private.resident_exam_replace_mpl(uuid,jsonb)')), false)
union all
select 'I-legacy reader list_resident_exam_records excludes managed exams',
       coalesce((select pg_get_functiondef(p.oid) ~ 'not event\.managed_by_rc04' from pg_proc p where p.oid = to_regprocedure('public.list_resident_exam_records()')), false)
union all
select 'I-index rc04_one_working_revision (one working revision per exam)', to_regclass('public.rc04_one_working_revision') is not null
union all
select 'I-constraint events published pointer FK', exists (select 1 from pg_constraint where conname = 'resident_exam_events_published_revision_fk' and convalidated);
