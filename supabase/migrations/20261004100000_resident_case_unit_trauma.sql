-- Admission cases: add Trauma as a sixth department unit (Upper GI, Colorectal, HPB, B&E, Vascular, Trauma).
-- Loosening only: every existing row already satisfies the wider list, nothing is deleted or changed.
-- Safe to run more than once. Rehearse on the staging project first.
begin;

alter table public.resident_admission_cases
  drop constraint if exists resident_admission_cases_unit_name_check;
alter table public.resident_admission_cases
  add constraint resident_admission_cases_unit_name_check
  check (unit_name in ('Upper GI', 'Colorectal', 'HPB', 'B&E', 'Vascular', 'Trauma'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.resident_admission_cases'::regclass
      and conname = 'resident_admission_cases_unit_name_check'
      and pg_get_constraintdef(oid) like '%Trauma%'
  ) then
    raise exception 'Trauma unit migration check failed';
  end if;
end $$;

commit;
