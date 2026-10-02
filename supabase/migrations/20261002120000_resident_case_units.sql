-- Department units for admission cases: Upper GI, Colorectal, HPB, B&E, Vascular.
-- Removes the one test case created on an old unit (ADM-00002, approved by the
-- owner 2026-10-02). It had no media or notes; both are deleted first anyway.
-- Apply on its own: npx --yes supabase db query --linked --file <this file>
begin;

delete from public.resident_case_notes
where case_id in (select id from public.resident_admission_cases where case_code = 'ADM-00002');
delete from public.resident_case_media
where case_id in (select id from public.resident_admission_cases where case_code = 'ADM-00002');
delete from public.resident_admission_cases where case_code = 'ADM-00002';

do $$
begin
  if exists (
    select 1 from public.resident_admission_cases
    where unit_name not in ('Upper GI', 'Colorectal', 'HPB', 'B&E', 'Vascular')
  ) then
    raise exception 'Cases still use an old unit; map them before changing the constraint';
  end if;
end;
$$;

alter table public.resident_admission_cases
  drop constraint if exists resident_admission_cases_unit_name_check;
alter table public.resident_admission_cases
  add constraint resident_admission_cases_unit_name_check check (unit_name in ('Upper GI', 'Colorectal', 'HPB', 'B&E', 'Vascular'));

commit;
