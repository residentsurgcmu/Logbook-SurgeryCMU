begin;

-- Year 5 advisor meetings remain a one-time target, but may be recorded in
-- any rotation week rather than only the first week.
alter table public.curriculum_activities disable trigger curriculum_activities_protect;

update public.curriculum_activities activity
set title_th = 'พบอาจารย์ที่ปรึกษา',
    requires_week = true
from public.curricula curriculum
where activity.curriculum_id = curriculum.id
  and curriculum.code = 'surgery-y5-2569'
  and activity.activity_code = 'advisor-meeting';

alter table public.curriculum_activities enable trigger curriculum_activities_protect;

-- Keep the existing submission safeguards while removing the previous
-- Year 5 advisor-meeting restriction to week 1.
create or replace function private.validate_year4_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare definition public.curriculum_activities%rowtype; staff_name text; active_staff_profile_id uuid;
begin
  if new.status = 'draft' then new.submitted_at = null; new.approved_at = null; return new; end if;
  if tg_op = 'INSERT' and new.status = 'submitted' then new.submitted_at = statement_timestamp();
  elsif tg_op = 'UPDATE' then
    if new.status = 'submitted' and old.status is distinct from 'submitted' then new.submitted_at = statement_timestamp(); end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then new.approved_at = statement_timestamp(); end if;
  end if;
  select directory.full_name, profile.id into staff_name, active_staff_profile_id
  from public.user_directory directory left join public.profiles profile
    on profile.email = directory.email and profile.role = 'staff' and profile.active = true
  where directory.email = lower(new.selected_approver_email) and directory.role = 'staff' and directory.active = true;
  if staff_name is null then raise exception 'Selected approver must be on the active Staff allowlist'; end if;
  select * into definition from public.curriculum_activities where id = new.curriculum_activity_id and active = true;
  if not found then raise exception 'Activity definition is not active'; end if;
  if exists(select 1 from public.curriculum_staff_approvers where curriculum_id=definition.curriculum_id and active=true)
     and not exists(select 1 from public.curriculum_staff_approvers where curriculum_id=definition.curriculum_id and staff_email=lower(new.selected_approver_email) and active=true)
  then raise exception 'Selected approver is not assigned to this curriculum'; end if;
  new.selected_approver_email = lower(new.selected_approver_email); new.selected_approver_id = active_staff_profile_id;
  if nullif(trim(new.detail), '') is null then raise exception 'Activity detail is required before submission'; end if;
  if definition.requires_week and new.week_number is null then raise exception 'Week number is required for this activity'; end if;
  if definition.requires_patient and nullif(trim(new.patient_reference), '') is null then raise exception 'Patient reference is required for this activity'; end if;
  if definition.requires_procedure and nullif(trim(new.procedure_name), '') is null then raise exception 'Procedure is required for this activity'; end if;
  new.supervisor_name = staff_name; return new;
end;
$$;

revoke all on function private.validate_year4_submission() from public, anon, authenticated;

do $$
declare activity_title text; activity_target integer; activity_requires_week boolean;
begin
  select activity.title_th, activity.target_count, activity.requires_week
    into activity_title, activity_target, activity_requires_week
  from public.curriculum_activities activity
  join public.curricula curriculum on curriculum.id = activity.curriculum_id
  where curriculum.code = 'surgery-y5-2569'
    and activity.activity_code = 'advisor-meeting'
    and activity.active;

  if activity_title <> 'พบอาจารย์ที่ปรึกษา' or activity_target <> 1 or not activity_requires_week then
    raise exception 'Year 5 advisor-meeting reconciliation failed';
  end if;
end;
$$;

commit;
