begin;

-- Add the Year 5 first-week advisor meeting as a counted curriculum activity.
-- Published curricula are normally immutable in the app; this controlled
-- migration is the sole exception for the corrected official requirement.
alter table public.curriculum_activities disable trigger curriculum_activities_protect;

-- Move into a non-conflicting range first: sort_order is unique per curriculum
-- and a direct +1 update can temporarily collide with the next activity.
update public.curriculum_activities activity
set sort_order = sort_order + 1000
from public.curricula curriculum
where activity.curriculum_id = curriculum.id
  and curriculum.code = 'surgery-y5-2569'
  and activity.active;

update public.curriculum_activities activity
set sort_order = sort_order - 999
from public.curricula curriculum
where activity.curriculum_id = curriculum.id
  and curriculum.code = 'surgery-y5-2569'
  and activity.active;

insert into public.curriculum_activities (
  curriculum_id, activity_code, title_th, group_name, target_count, target_unit,
  sort_order, requires_patient, requires_procedure, requires_week,
  allowed_approver_roles, active
)
select curriculum.id, 'advisor-meeting', 'พบอาจารย์ที่ปรึกษา (สัปดาห์แรก)',
       'การกำกับติดตาม', 1, 'ครั้ง', 1, false, false, true,
       array['staff']::text[], true
from public.curricula curriculum
where curriculum.code = 'surgery-y5-2569'
on conflict (curriculum_id, activity_code) do update set
  title_th = excluded.title_th,
  group_name = excluded.group_name,
  target_count = excluded.target_count,
  target_unit = excluded.target_unit,
  sort_order = excluded.sort_order,
  requires_patient = excluded.requires_patient,
  requires_procedure = excluded.requires_procedure,
  requires_week = excluded.requires_week,
  allowed_approver_roles = excluded.allowed_approver_roles,
  active = true;

alter table public.curriculum_activities enable trigger curriculum_activities_protect;

-- The selected activity must be recorded only in week 1.  Other Year 4/5
-- advisor-meeting activities keep their own existing rules.
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
  if definition.activity_code = 'advisor-meeting'
     and (select class_year from public.curricula where id = definition.curriculum_id) = 5
     and new.week_number <> 1
  then raise exception 'Year 5 advisor meeting must be recorded in week 1'; end if;
  if definition.requires_patient and nullif(trim(new.patient_reference), '') is null then raise exception 'Patient reference is required for this activity'; end if;
  if definition.requires_procedure and nullif(trim(new.procedure_name), '') is null then raise exception 'Procedure is required for this activity'; end if;
  new.supervisor_name = staff_name; return new;
end;
$$;
revoke all on function private.validate_year4_submission() from public, anon, authenticated;

do $$
declare activity_count integer; target_total integer;
begin
  select count(*), coalesce(sum(activity.target_count), 0)
    into activity_count, target_total
  from public.curriculum_activities activity
  join public.curricula curriculum on curriculum.id = activity.curriculum_id
  where curriculum.code = 'surgery-y5-2569' and activity.active;
  if activity_count <> 13 or target_total <> 54 then
    raise exception 'Year 5 advisor-meeting reconciliation failed: activities %, target %', activity_count, target_total;
  end if;
end;
$$;

commit;
