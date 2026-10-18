-- RC-02a-1 POST-DEPLOY CHECK (read-only; returns no personal data). Run right AFTER the migration, while paused.
-- Every row with ok = true/false must be true. Rows with ok = null are information for the record.

-- A. release safety
select 'A1 account writes are paused' as check_name, public.resident_accounts_paused() as ok
union all
select 'A2 account numbers unchanged since the pause began (snapshot stored by the migration)',
  (select snapshot = private.resident_account_counts() from public.resident_maintenance_pause where scope = 'accounts')
union all
select 'A3 pause triggers present on the 3 account tables',
  (select count(*) = 5 from pg_trigger where not tgisinternal and tgname like '%\_pause\_%')
union all
select 'A4 direct writes by client roles (incl. service_role / old Edge) are blocked for good, also after pause_off',
  public.resident_account_direct_writes_blocked()
  and not (select prosecdef from pg_proc where oid = 'private.resident_refuse_account_write_when_paused()'::regprocedure)
  and pg_get_functiondef('private.resident_refuse_account_write_when_paused()'::regprocedure) ~ 'service_role'

-- B. effective table privileges (has_table_privilege includes PUBLIC and inherited roles)
union all
select 'B1 anon/authenticated/authenticator: no write of any kind on the account tables',
  not exists (select 1 from pg_roles r, unnest(array['public.resident_profiles','public.resident_user_roles','public.resident_maintenance_pause','public.resident_account_events']) t,
    unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    where r.rolname in ('anon','authenticated','authenticator') and has_table_privilege(r.rolname, t, p))
union all
select 'B2 PUBLIC holds no privilege on the account tables',
  not exists (select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid in ('public.resident_profiles'::regclass, 'public.resident_user_roles'::regclass, 'public.resident_maintenance_pause'::regclass, 'public.resident_account_events'::regclass)
      and a.grantee = 0)
union all
select 'B3 authenticated can still read profiles and roles; nothing else',
  has_table_privilege('authenticated', 'public.resident_profiles', 'SELECT') and has_table_privilege('authenticated', 'public.resident_user_roles', 'SELECT')
  and not has_table_privilege('anon', 'public.resident_profiles', 'SELECT') and not has_table_privilege('anon', 'public.resident_user_roles', 'SELECT')
  and not has_table_privilege('authenticated', 'public.resident_account_events', 'SELECT') and not has_table_privilege('authenticated', 'public.resident_maintenance_pause', 'SELECT')

-- C. effective column privileges, every column, inherited roles included
union all
select 'C1 no column-level INSERT/UPDATE/REFERENCES for anon/authenticated/authenticator',
  not exists (select 1 from pg_roles r cross join pg_attribute a cross join unnest(array['INSERT','UPDATE','REFERENCES']) p
    where r.rolname in ('anon','authenticated','authenticator')
      and a.attrelid in ('public.resident_profiles'::regclass, 'public.resident_user_roles'::regclass) and a.attnum > 0 and not a.attisdropped
      and has_column_privilege(r.rolname, a.attrelid, a.attnum, p))
union all
select 'C2 no write policy left on the two account tables',
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('resident_profiles','resident_user_roles') and cmd <> 'SELECT')

-- D. functions callable by the browser (public + private, DEFINER and INVOKER, PUBLIC/inherited included)
union all
select 'D1 every browser-callable function in public/private is owned by postgres',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      and pg_get_userbyid(p.proowner) <> 'postgres')
union all
select 'D2 new internal functions are not browser-callable',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'private' and p.proname in ('resident_account_lock','resident_account_replay','resident_account_reason','resident_account_pending_requests',
              'resident_account_active_assignments','resident_account_active_admins','resident_account_is_active_admin','resident_account_counts','resident_refuse_account_write_when_paused')
           or n.nspname = 'public' and p.proname = 'admin_provision_account_internal')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
union all
select 'D3 new Admin RPCs are not callable by logged-out visitors',
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('admin_list_accounts','admin_preview_account_action','admin_update_account','admin_set_account_active','admin_list_account_events','resident_accounts_paused','resident_account_direct_writes_blocked')
    and has_function_privilege('anon', p.oid, 'EXECUTE'))
union all
select 'D4 every public function the browser can call that touches Resident data has an active-account guard',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and pg_get_functiondef(p.oid) ~ 'public\.resident_|resident_[a-z_]+ ' and p.proname not in ('resident_accounts_paused','resident_account_direct_writes_blocked')
      and pg_get_functiondef(p.oid) !~ 'resident_role_is|resident_account_active|resident_case_member|resident_can_[a-z_]+|resident_seat_context|resident_seat_actor|r\.user_id = auth\.uid\(\) and r\.active and p\.active')
union all
select 'D5 role check needs both flags', pg_get_functiondef('private.resident_role_is'::regproc) ~ 'p\.active'

-- E. information: other roles that hold write privileges on the account tables (expected: Supabase system roles only)
union all
select 'E1 info: ' || r.rolname || ' can write ' || t, null
from pg_roles r, unnest(array['public.resident_profiles','public.resident_user_roles']) t
where r.rolname not in ('anon','authenticated','authenticator','postgres','service_role') and not r.rolsuper and r.rolname not like 'pg\_%'
  and (has_table_privilege(r.rolname, t, 'INSERT') or has_table_privilege(r.rolname, t, 'UPDATE') or has_table_privilege(r.rolname, t, 'DELETE'));

-- F. for the record: every function the browser can call (name, schema, definer?, owner, callable by anon?)
select n.nspname as schema, p.proname as function, p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_call
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
order by 1, 2;
