-- Run read-only against the linked Resident database AFTER the migration:
-- npx --yes supabase db query --linked --file tests/resident-cases-db.sql
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.resident_admission_cases'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.resident_case_media'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.resident_case_notes'::regclass)
  then raise exception 'Resident case RLS regression'; end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'resident-case-media' and public = false and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  ) then raise exception 'Case media bucket regression'; end if;

  if has_table_privilege('authenticated', 'public.resident_admission_cases', 'insert')
    or has_table_privilege('authenticated', 'public.resident_admission_cases', 'update')
    or has_table_privilege('authenticated', 'public.resident_admission_cases', 'delete')
    or has_table_privilege('authenticated', 'public.resident_case_media', 'insert')
    or has_table_privilege('authenticated', 'public.resident_case_media', 'update')
    or has_table_privilege('authenticated', 'public.resident_case_notes', 'insert')
    or has_table_privilege('authenticated', 'public.resident_case_notes', 'update')
    or has_table_privilege('anon', 'public.resident_admission_cases', 'select')
  then raise exception 'Resident case table grant regression'; end if;

  if has_function_privilege('anon', 'public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid)', 'execute')
    or has_function_privilege('anon', 'public.update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid)', 'execute')
    or has_function_privilege('anon', 'public.soft_delete_resident_admission_case(uuid, timestamptz)', 'execute')
    or has_function_privilege('anon', 'public.admin_purge_resident_admission_case(uuid)', 'execute')
    or has_function_privilege('anon', 'public.add_resident_case_media(uuid, text, text)', 'execute')
    or has_function_privilege('anon', 'public.add_resident_case_note(uuid, text)', 'execute')
    or has_function_privilege('anon', 'public.list_resident_case_people()', 'execute')
  then raise exception 'Resident case function grant regression'; end if;

  if not has_function_privilege('authenticated', 'public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid)', 'execute')
    or not has_function_privilege('authenticated', 'private.resident_case_member()', 'execute')
  then raise exception 'Authenticated must execute case RPCs and RLS helpers'; end if;

  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'resident_case_media_objects_%') <> 3
  then raise exception 'Case media storage policy count regression'; end if;

  if exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename in ('resident_admission_cases', 'resident_case_media', 'resident_case_notes')
      and cmd <> 'SELECT'
  ) then raise exception 'Case tables must have SELECT policies only'; end if;
end;
$$;
select 'resident cases db checks passed' as result;
