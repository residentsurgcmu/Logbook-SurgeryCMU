-- RC-02a-1 PRE-DEPLOY CHECK (read-only; returns no personal data). Run in the SQL Editor BEFORE the migration.
-- Every row must show ok = true. If any row shows false: STOP and send the output to C1.
-- Account numbers are shown at the end for the record (counts only); after the migration the post-deploy
-- check compares against the snapshot the migration itself stores, so no number has to be typed in.

-- 1. The 8 functions this migration replaces must still be exactly the version in the repo (fingerprint of the body).
with expected(name, md5) as (values
    ('cancel_resident_assessment_request', '4f39a19cf85f4d53ca2c8fd0588e3d18'),
    ('complete_resident_assessment_request', '13c77c6b1acbbf776d11895bec643436'),
    ('list_registered_resident_staff', '8ac9d32504f6db74a84eb9b4253c48b1'),
    ('list_resident_counterpart_staff', '3dfd4754a0364746f9c7e2b619c33cdb'),
    ('resident_can_evaluate', '28e9f41d9c1b8057d4de288b573a8a6d'),
    ('resident_role_is', '4a20266ccdfe2d6bbc05d7e31d569d15'),
    ('resolve_resident_assessment_qr', 'bc0d15f84e93d565c7fc0efeef54c7b3'),
    ('submit_resident_assessment_request', '3ebe0f650035f65ffca258db49b5578a'))
select 'function unchanged: ' || e.name as check_name, coalesce(md5(p.prosrc) = e.md5, false) as ok
from expected e
left join pg_proc p on p.proname = e.name and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
union all
-- 2. None of the new objects exists yet.
select 'new objects not present yet',
  to_regclass('public.resident_account_events') is null
  and not exists (select 1 from pg_proc where proname in ('admin_list_accounts','admin_preview_account_action','admin_update_account',
    'admin_set_account_active','admin_list_account_events','admin_provision_account_internal') or proname like 'resident\_account\_%')
union all
-- 3. The installed email constraints exist (the migration relies on them and adds none).
select 'email unique + lower-case check installed',
  (select count(*) = 2 from pg_constraint where conrelid = 'public.resident_profiles'::regclass
    and ((contype = 'u' and pg_get_constraintdef(oid) ilike 'UNIQUE (email)') or (contype = 'c' and pg_get_constraintdef(oid) ilike '%email = lower(email)%')))
union all
-- 4. At least one active Admin exists (so someone can use the new functions afterwards).
select 'at least one active Admin',
  exists (select 1 from public.resident_user_roles r join public.resident_profiles p using (user_id) where r.role = 'admin' and r.active and p.active)
union all
-- 5. No account has the two flags out of step (the migration treats "active" as both).
select 'role.active = profile.active for every account',
  not exists (select 1 from public.resident_user_roles r join public.resident_profiles p using (user_id) where r.active <> p.active)
union all
-- 6. No trigger exists on the account tables yet (the migration adds the pause triggers).
select 'no trigger on the account tables yet',
  not exists (select 1 from pg_trigger where not tgisinternal and tgrelid in ('public.resident_profiles'::regclass, 'public.resident_user_roles'::regclass, 'public.resident_staff_directory'::regclass));

-- For the record (counts only)
select r.role, count(*) filter (where r.active and p.active) as active, count(*) filter (where not (r.active and p.active)) as inactive
from public.resident_user_roles r join public.resident_profiles p using (user_id) group by r.role order by r.role;
