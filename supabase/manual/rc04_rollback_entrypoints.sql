-- RC-04 RELEASE ROLLBACK (manual, owner/operator, one transaction). Use when the RC04-aware frontend/helpers must be
-- withdrawn (back below compatibility floor RC04-STATE-READER-1).
-- Fail-closed by design (contract §12.1):
--   * removes every RC-04 entry point (public.rc04_* functions) → no managed read or write path is left;
--   * KEEPS all managed data (events rows, revisions, snapshots, results with value_state, previews, batches,
--     receipts, audit), the legacy-writer guards, the legacy-reader / events-policy exclusion and every trigger;
--   * old readers then see legacy exams only; managed results are "paused", never shown as 0 / remediation / waiting.
-- It does not delete or convert any data. Re-enable later by re-creating the functions (sections 4–6 of migration
-- 20261019090000) — a reviewed release step, not part of this file.
begin;
set local lock_timeout = '15s';
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'rc04\_%' loop
    execute format('drop function %s', f);
  end loop;
end $$;
-- checks before COMMIT (any failure rolls the rollback back)
do $$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'rc04\_%') then
    raise exception 'rollback check: RC-04 entry points still present'; end if;
  if pg_get_functiondef('public.list_resident_exam_records'::regproc) !~ 'not event\.managed_by_rc04' then
    raise exception 'rollback check: legacy reader exclusion missing'; end if;
  if (select count(*) from pg_proc p where p.proname in ('save_resident_exam_scores','save_resident_exam_results','set_resident_exam_publication',
        'update_resident_exam_mpl','resident_exam_replace_mpl','delete_resident_exam_event')
        and pg_get_functiondef(p.oid) ~ 'rc04_reject_managed_exam') <> 6 then
    raise exception 'rollback check: legacy writer guards missing'; end if;
  if not exists (select 1 from pg_policies where policyname = 'resident_exam_events_visible' and qual ~ 'managed_by_rc04') then
    raise exception 'rollback check: events policy exclusion missing'; end if;
  raise notice 'RC04 rollback: entry points removed; data, guards and exclusion kept';
end $$;
commit;
notify pgrst, 'reload schema';
