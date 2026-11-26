with tables as (
  select c.oid, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='rc_hn_prod_private' and c.relkind='r'
), clients(role) as (values ('anon'),('authenticated'),('service_role'),('authenticator'))
select
  (select count(*)=4 and bool_and(relrowsecurity) from tables) as all_four_tables_rls,
  not exists (select from clients where has_schema_privilege(role,'rc_hn_prod_private','USAGE,CREATE')) as no_client_schema_access,
  not exists (select from clients cross join tables
    where has_table_privilege(role,oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_any_column_privilege(role,oid,'SELECT,INSERT,UPDATE,REFERENCES')) as no_client_table_or_column_access,
  not exists (select from pg_proc p where p.pronamespace='rc_hn_prod_private'::regnamespace)
    and to_regprocedure('public.rc_hn_case_trial(uuid,text,text,text,integer)') is null as no_hn_api,
  not exists (select from rc_hn_prod_private.public_keys) as no_keys,
  not exists (select from rc_hn_prod_private.pilot_config) as no_enabled_config,
  not exists (select from rc_hn_prod_private.pilot_cases) as no_pilot_cases,
  not exists (select from rc_hn_prod_private.records) as no_hn_records;
