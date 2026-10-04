-- New admissions: add "Type" (planned treatment: Conservative / Operative).
-- Additive only: one nullable column and one new function. Existing functions,
-- columns (including the legacy `status`) and stored data are left untouched,
-- so older web app versions keep working while this is rolled out.
-- Rehearse on the staging project before production.

begin;

alter table public.resident_admission_cases
  add column if not exists treatment_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.resident_admission_cases'::regclass
      and conname = 'resident_admission_cases_treatment_type_check'
  ) then
    alter table public.resident_admission_cases
      add constraint resident_admission_cases_treatment_type_check
      check (treatment_type is null or treatment_type in ('conservative', 'operative'));
  end if;
end $$;

-- Sets or clears the Type of one case. Same access rule as editing the case.
-- p_expected_updated_at is optional: pass it to refuse the change if someone
-- else edited the case meanwhile (used after an update); omit it right after create.
create or replace function public.set_resident_case_treatment_type(
  p_case_id uuid, p_treatment_type text, p_expected_updated_at timestamptz default null
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_case public.resident_admission_cases%rowtype;
  v_updated timestamptz;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  if p_treatment_type is not null and p_treatment_type not in ('conservative', 'operative') then
    raise exception 'Invalid treatment type';
  end if;
  select * into v_case from public.resident_admission_cases
  where id = p_case_id and deleted_at is null for update;
  if not found then raise exception 'Case not found'; end if;
  if not (select private.resident_can_edit_case(p_case_id)) then
    raise exception 'You cannot edit this case';
  end if;
  if p_expected_updated_at is not null and v_case.updated_at is distinct from p_expected_updated_at then
    raise exception 'CASE_CONFLICT: this case was changed by someone else';
  end if;
  if v_case.treatment_type is not distinct from p_treatment_type then
    return v_case.updated_at;
  end if;
  update public.resident_admission_cases
  set treatment_type = p_treatment_type, updated_by = auth.uid(), updated_at = clock_timestamp()
  where id = p_case_id
  returning updated_at into v_updated;
  return v_updated;
end;
$$;

revoke all on function public.set_resident_case_treatment_type(uuid, text, timestamptz) from public, anon;
grant execute on function public.set_resident_case_treatment_type(uuid, text, timestamptz) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.set_resident_case_treatment_type(uuid, text, timestamptz)'::regprocedure, 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.set_resident_case_treatment_type(uuid, text, timestamptz)'::regprocedure, 'EXECUTE')
    or not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'resident_admission_cases' and column_name = 'treatment_type')
  then
    raise exception 'Treatment type migration check failed';
  end if;
end $$;

commit;
