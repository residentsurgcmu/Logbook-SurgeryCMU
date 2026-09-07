begin;

-- The multi-curriculum trigger is now the authoritative activity validator.
-- This legacy foreign key only contains Year 4 definitions and therefore
-- rejected valid Year 5 activity codes before the trigger could validate them.
alter table public.year4_logbook_entries
  drop constraint if exists year4_logbook_entries_activity_type_fkey;

-- These Year 4 activities identify the procedure in the selected activity
-- itself; students should not have to enter a second free-text Procedure.
update public.year4_activity_definitions
set requires_procedure = false
where id in (
  'foley-catheter',
  'venipuncture',
  'stomal-care',
  'nasogastric-tube',
  'proctoscopy'
);

-- This is a one-time migration correction to already-published data.  Normal
-- application writes remain protected by curriculum_activities_protect.
alter table public.curriculum_activities disable trigger curriculum_activities_protect;

update public.curriculum_activities activity
set requires_procedure = false
from public.curricula curriculum
where activity.curriculum_id = curriculum.id
  and curriculum.code = 'surgery-y4-2569'
  and activity.activity_code in (
    'foley-catheter',
    'venipuncture',
    'stomal-care',
    'nasogastric-tube',
    'proctoscopy'
  );

alter table public.curriculum_activities enable trigger curriculum_activities_protect;

-- Guard against a future seed reintroducing the two defects above.  The
-- active-enrollment trigger still rejects activity codes not in the student's
-- published curriculum, so removing the obsolete FK does not weaken access
-- control or allow cross-curriculum entries.
do $$
begin
  if exists (
    select 1
    from public.curriculum_activities activity
    join public.curricula curriculum on curriculum.id = activity.curriculum_id
    where curriculum.code = 'surgery-y4-2569'
      and activity.activity_code in (
        'foley-catheter',
        'venipuncture',
        'stomal-care',
        'nasogastric-tube',
        'proctoscopy'
      )
      and activity.requires_procedure
  ) then
    raise exception 'Year 4 basic-procedure validation reconciliation failed';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.year4_logbook_entries'::regclass
      and conname = 'year4_logbook_entries_activity_type_fkey'
  ) then
    raise exception 'Legacy activity-type foreign key was not removed';
  end if;
end;
$$;

commit;
