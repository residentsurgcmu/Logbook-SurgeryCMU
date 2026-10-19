-- RC-04 release checks PART B — run AFTER migration 20261019090000 (read-only, no personal data).
-- Expected: exactly 8 rows B1-B8, every ok = true. B8 is meaningful only BEFORE the first managed exam is created.
-- Run rc04_release_inventory.sql as well (65 rows): B1-B4 alone could be true if objects were missing.
select * from (
select 'B1 no client/service privilege on rc04 tables (incl. inherited/PUBLIC)' as check_name,
  not exists (select 1 from pg_class c cross join (select rolname as r from pg_roles where rolname in ('anon','authenticated','authenticator','service_role')) rr
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    where c.relnamespace = 'public'::regnamespace and c.relname like 'rc04\_%' and c.relkind = 'r' and has_table_privilege(rr.r, c.oid, p)) as ok
union all select 'B2 no column privilege on rc04 tables',
  not exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid cross join (select rolname as r from pg_roles where rolname in ('anon','authenticated','authenticator','service_role')) rr
    cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
    where c.relname like 'rc04\_%' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and has_column_privilege(rr.r, a.attrelid, a.attnum, p))
union all select 'B3 private rc04 helpers not callable by any client role',
  not exists (select 1 from pg_proc p cross join (select rolname as r from pg_roles where rolname in ('anon','authenticated','authenticator','service_role')) rr
    where p.pronamespace = 'private'::regnamespace and p.proname like 'rc04\_%' and has_function_privilege(rr.r, p.oid, 'EXECUTE'))
union all select 'B4 public rc04 RPCs: authenticated only (not anon, not service_role)',
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'rc04\_%'
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE')))
union all select 'B5 every legacy writer has the managed guard',
  (select count(*) = 6 from pg_proc p where p.proname in ('save_resident_exam_scores','save_resident_exam_results','set_resident_exam_publication',
     'update_resident_exam_mpl','resident_exam_replace_mpl','delete_resident_exam_event') and pg_get_functiondef(p.oid) ~ 'rc04_reject_managed_exam')
union all select 'B6 legacy reader + events policy exclude managed',
  pg_get_functiondef('public.list_resident_exam_records'::regproc) ~ 'not event\.managed_by_rc04'
  and exists (select 1 from pg_policies where policyname = 'resident_exam_events_visible' and qual ~ 'managed_by_rc04')
union all select 'B7 guard triggers present (events 1, legacy child 4, rc04 immutability 7)',
  (select count(*) = 12 from pg_trigger where not tgisinternal and tgname like 'rc04\_%')
union all select 'B8 existing exams untouched (none flagged managed)', not exists (select 1 from public.resident_exam_events where managed_by_rc04)
) x;
