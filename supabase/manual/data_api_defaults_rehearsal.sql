-- STAGING ONLY. Transactional probe: no application rows touched; all DDL and
-- default changes ROLLED BACK. Never run this through a tool that strips the
-- transaction or commits individual statements. Not a deployment migration.
begin;
set local lock_timeout = '5s';
do $$ begin
  if current_user <> 'postgres' then raise exception 'Expected postgres creator role'; end if;
end $$;
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
create table public.rc_grants_cutover_probe_20261021(id integer);
alter table public.rc_grants_cutover_probe_20261021 enable row level security;
do $$ begin
  if exists (
    select 1 from unnest(array['anon','authenticated','service_role']) r
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
    where has_table_privilege(r, 'public.rc_grants_cutover_probe_20261021', p)
  ) then raise exception 'Probe inherited API grants despite revoked defaults'; end if;
end $$;
grant select on public.rc_grants_cutover_probe_20261021 to authenticated;
do $$ begin
  if not has_table_privilege('authenticated','public.rc_grants_cutover_probe_20261021','SELECT') then
    raise exception 'Explicit SELECT grant did not work';
  end if;
end $$;
set local role authenticated;
select count(*) as probe_rows_visible from public.rc_grants_cutover_probe_20261021;
do $$ begin
  begin
    insert into public.rc_grants_cutover_probe_20261021 values (1);
    raise exception 'Unexpected INSERT access';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select true as new_table_closed_by_default,
       true as explicit_select_works,
       true as ungranted_insert_rejected;
rollback;
