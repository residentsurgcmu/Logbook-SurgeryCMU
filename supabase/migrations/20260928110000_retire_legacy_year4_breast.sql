-- Retire the legacy Year 4 logbook and Breast fellow logbook.
--
-- The web app only mounts the Resident platform, but the legacy tables were
-- still reachable through the Supabase REST API with a signed-in user's
-- token, including several known RLS gaps (students editing any column of
-- their own profile, Year 4 staff reading Breast fellow logbooks, approval
-- edits). This closes all client access in one step.
--
-- DATA IS KEPT. Nothing is dropped: service_role / postgres (Supabase
-- Dashboard, SQL Editor, backups) can still read every row. Every statement
-- is guarded so the migration is a no-op for objects that do not exist in
-- this project.

do $$
declare
  v_table text;
  v_legacy_tables text[] := array[
    'profiles', 'user_directory', 'topics', 'logbook_entries',
    'epa_assessments', 'pba_assessments', 'essential_procedures', 'essential_targets',
    'curricula', 'curriculum_activities', 'curriculum_rotations', 'curriculum_staff_approvers',
    'student_enrollments', 'student_promotion_batches', 'student_promotion_audit',
    'staff_digest_deliveries',
    'year4_activity_definitions', 'year4_rotations', 'year4_logbook_entries',
    'year4_approval_events', 'year4_logbook_certifications'
  ];
begin
  foreach v_table in array v_legacy_tables loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    end if;
  end loop;
end;
$$;

-- Legacy RPCs: callable only by service_role from now on.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_promote_student_batch', 'admin_promote_students',
        'admin_replace_curriculum_activities',
        'admin_rollback_promotion', 'admin_rollback_promotion_batch',
        'current_user_role', 'is_staff'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
  end loop;
end;
$$;

-- Legacy sign-up trigger: it created legacy `profiles` rows and rejected any
-- new Auth user that was not a Year 4 student or in user_directory. The
-- Resident platform provisions its own profiles/roles, so it is not needed.
drop trigger if exists on_auth_user_created on auth.users;

-- Legacy student avatar bucket: remove client policies (files are kept).
drop policy if exists student_avatars_select on storage.objects;
drop policy if exists student_avatars_insert on storage.objects;
drop policy if exists student_avatars_update on storage.objects;
drop policy if exists student_avatars_delete on storage.objects;
