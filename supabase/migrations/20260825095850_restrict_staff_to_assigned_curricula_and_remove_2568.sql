begin;

-- Staff authorization follows the curricula assigned by Admin.  Keep the
-- helper in the private schema because it must read assignment rows without
-- being affected by the caller's RLS policy.
create or replace function private.staff_can_access_curriculum(target_curriculum uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles staff_profile
    join public.curriculum_staff_approvers assignment
      on assignment.staff_email = lower(staff_profile.email)
     and assignment.curriculum_id = target_curriculum
     and assignment.active = true
    where staff_profile.id = (select auth.uid())
      and staff_profile.role = 'staff'
      and staff_profile.active = true
  );
$$;

create or replace function private.staff_can_access_enrollment(target_enrollment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_enrollments enrollment
    join public.profiles staff_profile
      on staff_profile.id = (select auth.uid())
     and staff_profile.role = 'staff'
     and staff_profile.active = true
    join public.curriculum_staff_approvers assignment
      on assignment.staff_email = lower(staff_profile.email)
     and assignment.curriculum_id = enrollment.curriculum_id
     and assignment.active = true
    where enrollment.id = target_enrollment
  );
$$;

create or replace function private.staff_can_access_student(target_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_enrollments enrollment
    join public.profiles staff_profile
      on staff_profile.id = (select auth.uid())
     and staff_profile.role = 'staff'
     and staff_profile.active = true
    join public.curriculum_staff_approvers assignment
      on assignment.staff_email = lower(staff_profile.email)
     and assignment.curriculum_id = enrollment.curriculum_id
     and assignment.active = true
    where enrollment.student_id = target_student
      and enrollment.status = 'active'
  );
$$;

revoke all on function private.staff_can_access_curriculum(uuid) from public, anon;
revoke all on function private.staff_can_access_enrollment(uuid) from public, anon;
revoke all on function private.staff_can_access_student(uuid) from public, anon;
grant execute on function private.staff_can_access_curriculum(uuid) to authenticated;
grant execute on function private.staff_can_access_enrollment(uuid) to authenticated;
grant execute on function private.staff_can_access_student(uuid) to authenticated;

drop policy if exists profiles_select_authorized on public.profiles;
create policy profiles_select_authorized on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (select private.is_admin())
  or (role = 'staff' and active = true)
  or (role = 'student' and (select private.staff_can_access_student(id)))
);

drop policy if exists curricula_select on public.curricula;
create policy curricula_select on public.curricula
for select to authenticated
using (
  (select private.is_admin())
  or (select private.staff_can_access_curriculum(id))
  or (
    status = 'published'
    and exists (
      select 1 from public.student_enrollments enrollment
      where enrollment.curriculum_id = curricula.id
        and enrollment.student_id = (select auth.uid())
        and enrollment.status = 'active'
    )
  )
);

drop policy if exists curriculum_activities_select on public.curriculum_activities;
create policy curriculum_activities_select on public.curriculum_activities
for select to authenticated
using (
  (select private.is_admin())
  or (select private.staff_can_access_curriculum(curriculum_id))
  or exists (
    select 1 from public.student_enrollments enrollment
    where enrollment.curriculum_id = curriculum_activities.curriculum_id
      and enrollment.student_id = (select auth.uid())
      and enrollment.status = 'active'
  )
);

drop policy if exists curriculum_staff_approvers_select on public.curriculum_staff_approvers;
create policy curriculum_staff_approvers_select on public.curriculum_staff_approvers
for select to authenticated
using (
  active
  and (
    (select private.is_admin())
    or (select private.staff_can_access_curriculum(curriculum_id))
    or exists (
      select 1 from public.student_enrollments enrollment
      where enrollment.curriculum_id = curriculum_staff_approvers.curriculum_id
        and enrollment.student_id = (select auth.uid())
        and enrollment.status = 'active'
    )
  )
);

drop policy if exists curriculum_rotations_select on public.curriculum_rotations;
create policy curriculum_rotations_select on public.curriculum_rotations
for select to authenticated
using (
  (select private.is_admin())
  or (select private.staff_can_access_curriculum(curriculum_id))
  or exists (
    select 1 from public.student_enrollments enrollment
    where enrollment.curriculum_id = curriculum_rotations.curriculum_id
      and enrollment.student_id = (select auth.uid())
      and enrollment.status = 'active'
  )
);

drop policy if exists student_enrollments_select on public.student_enrollments;
create policy student_enrollments_select on public.student_enrollments
for select to authenticated
using (
  (student_id = (select auth.uid()) and status = 'active')
  or (select private.is_admin())
  or (select private.staff_can_access_curriculum(curriculum_id))
);

drop policy if exists year4_entries_select on public.year4_logbook_entries;
create policy year4_entries_select on public.year4_logbook_entries
for select to authenticated
using (
  (
    student_id = (select auth.uid())
    and (select private.is_active_enrollment(enrollment_id, student_id))
  )
  or (select private.is_admin())
  or (select private.staff_can_access_enrollment(enrollment_id))
);

drop policy if exists year4_events_select on public.year4_approval_events;
create policy year4_events_select on public.year4_approval_events
for select to authenticated
using (
  (
    student_id = (select auth.uid())
    and (select private.is_active_enrollment(enrollment_id, student_id))
  )
  or (select private.is_admin())
  or (select private.staff_can_access_enrollment(enrollment_id))
);

drop policy if exists year4_certifications_select on public.year4_logbook_certifications;
create policy year4_certifications_select on public.year4_logbook_certifications
for select to authenticated
using (
  (
    student_id = (select auth.uid())
    and (select private.is_active_enrollment(enrollment_id, student_id))
  )
  or (select private.is_admin())
  or (select private.staff_can_access_enrollment(enrollment_id))
);

drop policy if exists year4_entries_staff_update on public.year4_logbook_entries;
create policy year4_entries_staff_update on public.year4_logbook_entries
for update to authenticated
using (
  (select private.is_staff())
  and (select private.staff_can_access_enrollment(enrollment_id))
  and (select private.is_selected_staff(selected_approver_email))
  and status = 'submitted'
)
with check (
  (select private.is_staff())
  and (select private.staff_can_access_enrollment(enrollment_id))
  and (select private.is_selected_staff(selected_approver_email))
  and status in ('approved', 'rejected')
);

drop policy if exists year4_certifications_staff_update on public.year4_logbook_certifications;
create policy year4_certifications_staff_update on public.year4_logbook_certifications
for update to authenticated
using (
  (
    (select private.is_staff())
    and (select private.staff_can_access_enrollment(enrollment_id))
    and (select private.is_selected_staff(selected_certifier_email))
  )
  or (select private.is_admin())
)
with check (
  (
    (select private.is_staff())
    and (select private.staff_can_access_enrollment(enrollment_id))
    and (select private.is_selected_staff(selected_certifier_email))
  )
  or (select private.is_admin())
);

-- Students no longer choose class year or academic year.  New self-service
-- registrations are enrolled only into the current published intake; Admin
-- remains responsible for later curriculum assignment and promotion.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  directory_entry public.user_directory%rowtype;
  submitted_name text;
  submitted_code text;
  submitted_group text;
  requested_role text;
  target_curriculum public.curricula%rowtype;
begin
  select * into directory_entry
  from public.user_directory
  where email = lower(new.email) and active = true;

  if found then
    insert into public.profiles (
      id, email, full_name, role, active, student_code, cohort_year
    ) values (
      new.id, directory_entry.email, directory_entry.full_name,
      directory_entry.role, true, directory_entry.student_code,
      directory_entry.cohort_year
    );
    return new;
  end if;

  requested_role := coalesce(nullif(trim(new.raw_user_meta_data ->> 'requested_role'), ''), 'student');
  if requested_role <> 'student' then
    raise exception 'Staff and Admin must be allowlisted before activation';
  end if;

  submitted_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  submitted_code := nullif(trim(new.raw_user_meta_data ->> 'student_code'), '');
  submitted_group := nullif(trim(new.raw_user_meta_data ->> 'student_group'), '');
  if submitted_name is null then raise exception 'Student full name is required'; end if;
  if submitted_code is null or submitted_code !~ '^[0-9]{6,20}$' then raise exception 'Student code must contain 6 to 20 digits'; end if;
  if submitted_group is null or submitted_group !~ '^[0-9]{1,3}$' then raise exception 'Student group must contain 1 to 3 digits'; end if;

  select * into target_curriculum
  from public.curricula
  where class_year = 5
    and academic_year = 2569
    and status = 'published'
  order by version desc
  limit 1;
  if not found then raise exception 'Current student intake is not open'; end if;

  insert into public.profiles (
    id, email, full_name, role, active, student_code, student_group, cohort_year
  ) values (
    new.id, lower(new.email), submitted_name, 'student', true,
    submitted_code, submitted_group, target_curriculum.academic_year
  );

  insert into public.student_enrollments (
    student_id, curriculum_id, group_code, status, activated_at
  ) values (
    new.id, target_curriculum.id, submitted_group, 'active', statement_timestamp()
  );
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

-- Remove academic year 2568 logbook data while retaining the affected Auth
-- identity as an inactive account that an Admin can handle separately.
create temporary table removed_2568_students on commit drop as
select distinct enrollment.student_id
from public.student_enrollments enrollment
join public.curricula curriculum on curriculum.id = enrollment.curriculum_id
where curriculum.academic_year = 2568;

delete from public.student_promotion_audit promotion
where promotion.from_enrollment_id in (
  select enrollment.id from public.student_enrollments enrollment
  join public.curricula curriculum on curriculum.id = enrollment.curriculum_id
  where curriculum.academic_year = 2568
)
or promotion.to_enrollment_id in (
  select enrollment.id from public.student_enrollments enrollment
  join public.curricula curriculum on curriculum.id = enrollment.curriculum_id
  where curriculum.academic_year = 2568
);

delete from public.year4_logbook_certifications certification
where certification.enrollment_id in (
  select enrollment.id from public.student_enrollments enrollment
  join public.curricula curriculum on curriculum.id = enrollment.curriculum_id
  where curriculum.academic_year = 2568
);

delete from public.year4_logbook_entries entry
where entry.enrollment_id in (
  select enrollment.id from public.student_enrollments enrollment
  join public.curricula curriculum on curriculum.id = enrollment.curriculum_id
  where curriculum.academic_year = 2568
);

delete from public.student_enrollments enrollment
using public.curricula curriculum
where curriculum.id = enrollment.curriculum_id
  and curriculum.academic_year = 2568;

alter table public.profiles drop constraint if exists profiles_student_fields;
alter table public.profiles add constraint profiles_student_fields check (
  role <> 'student'
  or active = false
  or (student_code ~ '^[0-9]{6,20}$' and cohort_year is not null)
);

update public.profiles profile
set active = false,
    cohort_year = null,
    updated_at = statement_timestamp()
where profile.id in (select student_id from removed_2568_students)
  and profile.role = 'student'
  and not exists (
    select 1 from public.student_enrollments enrollment
    where enrollment.student_id = profile.id
      and enrollment.status = 'active'
  );

delete from public.curricula where academic_year = 2568;

do $$
begin
  if exists (select 1 from public.curricula where academic_year = 2568) then
    raise exception 'Academic year 2568 curriculum removal failed';
  end if;
  if exists (
    select 1 from public.year4_logbook_entries entry
    join public.student_enrollments enrollment on enrollment.id = entry.enrollment_id
    join public.curricula curriculum on curriculum.id = enrollment.curriculum_id
    where curriculum.academic_year = 2568
  ) then
    raise exception 'Academic year 2568 logbook removal failed';
  end if;
end;
$$;

commit;
