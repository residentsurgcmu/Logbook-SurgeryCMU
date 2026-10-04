-- RUN THIS LAST, only after the new web app (which creates cases through create_resident_admission_case_with_type)
-- is live for everyone. From then on a NEW case can only be created together with its Type: the original create
-- function can no longer be called by logged-in users. Nothing is deleted or changed; the new function keeps working
-- because it runs with its owner's rights. Older web pages still open in a browser will get "permission denied" on
-- "add case" until they are reloaded. Safe to run more than once. To undo: grant execute on the original function back.
begin;

do $$
begin
  if to_regprocedure('public.create_resident_admission_case_with_type(date, smallint, text, text, text, text, text, text, uuid, text)') is null then
    raise exception 'Run 20261004130000_resident_case_create_with_type.sql first';
  end if;
end $$;

do $$
declare
  r record;
begin
  -- every installed version of the original create function (9 or 17 arguments)
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_resident_admission_case'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_resident_admission_case'
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))
  ) or not has_function_privilege('authenticated', 'public.create_resident_admission_case_with_type(date, smallint, text, text, text, text, text, text, uuid, text)'::regprocedure, 'EXECUTE')
  then
    raise exception 'Require-type-on-create migration check failed';
  end if;
end $$;

commit;
