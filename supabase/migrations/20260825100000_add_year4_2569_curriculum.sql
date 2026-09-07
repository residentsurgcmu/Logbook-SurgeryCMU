begin;

-- Academic year 2569 has both Year 4 and Year 5 cohorts.  Year 4 keeps the
-- approved activity definitions that were already used by the Year 4 logbook.
insert into public.curricula (
  code, class_year, academic_year, name, pass_percent, status, source_filename, version
) values (
  'surgery-y4-2569', 4, 2569, 'Surgery Logbook Year 4 · พ.ศ. 2569', 80, 'draft', 'Logbook-year4-2568.pdf', 1
)
on conflict (code) do update set
  class_year = excluded.class_year,
  academic_year = excluded.academic_year,
  name = excluded.name,
  pass_percent = excluded.pass_percent,
  status = 'draft',
  source_filename = excluded.source_filename,
  version = excluded.version;

insert into public.curriculum_activities (
  curriculum_id, activity_code, title_th, group_name, target_count, target_unit,
  sort_order, requires_patient, requires_procedure, requires_week,
  allowed_approver_roles, active
)
select
  curriculum.id,
  definition.id,
  definition.title_th,
  definition.group_name,
  definition.target_count,
  definition.target_unit,
  definition.sort_order,
  definition.requires_patient,
  definition.requires_procedure,
  definition.requires_week,
  definition.allowed_approver_roles,
  definition.active
from public.year4_activity_definitions definition
join public.curricula curriculum on curriculum.code = 'surgery-y4-2569'
where definition.active = true
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
  active = excluded.active;

do $$
declare
  expected_activities integer := 17;
  expected_target_total integer := 78;
  actual_activities integer;
  actual_target_total integer;
begin
  select count(*), coalesce(sum(activity.target_count), 0)
    into actual_activities, actual_target_total
  from public.curriculum_activities activity
  join public.curricula curriculum on curriculum.id = activity.curriculum_id
  where curriculum.code = 'surgery-y4-2569'
    and activity.active = true;

  if actual_activities <> expected_activities or actual_target_total <> expected_target_total then
    raise exception 'Year 4/2569 reconciliation failed: activities %, target total %',
      actual_activities, actual_target_total;
  end if;
end;
$$;

update public.curricula
set status = 'published'
where code = 'surgery-y4-2569'
  and status = 'draft';

commit;
