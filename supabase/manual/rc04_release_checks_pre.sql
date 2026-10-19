-- RC-04 release checks PART A — run ONCE, BEFORE migration 20261019090000 (read-only, no personal data).
-- Expected: exactly 8 check rows (A1 x7, A2), every ok = true, then a 2-row record of legacy counts. Do not re-run after the migration.

-- ===== A. BEFORE migration 20261019090000
with expected(name, md5) as (values
    ('public.save_resident_exam_scores', '1acb2ef8ed2f9edc456e41e326779453'),
    ('private.resident_exam_replace_mpl', 'b59a4ae77cd10e18768f9eb7d03eceb3'),
    ('public.save_resident_exam_results', '3e1c060d9245526f288a9696d236922d'),
    ('public.set_resident_exam_publication', '715270442a700fb11002090d8cad9de2'),
    ('public.update_resident_exam_mpl', '5ba792dc94656aeda5fd070d858cbbcf'),
    ('public.list_resident_exam_records', '8ca8abaeea3378820469f3c434c16ad1'),
    ('public.delete_resident_exam_event', '34fb51654618348e22be1341ace596c3'))
select 'A1 unchanged since Base: ' || e.name as check_name, coalesce(md5(p.prosrc) = e.md5, false) as ok
from expected e left join pg_proc p on p.oid = to_regproc(e.name)
union all select 'A2 RC-04 objects not present yet', to_regclass('public.rc04_exam_revisions') is null
  and not exists (select 1 from pg_attribute where attrelid = 'public.resident_exam_events'::regclass and attname = 'managed_by_rc04')
;
select 'events' as t, count(*) from public.resident_exam_events union all select 'results', count(*) from public.resident_exam_results;
