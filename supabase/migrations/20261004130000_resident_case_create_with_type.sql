-- New admissions: create the case AND its Type in ONE step (one database transaction), so a case can never be
-- left without a Type when the form required one. Additive: one new function; the existing create/update
-- functions are not changed (this works whichever version of them is installed).
begin;

create or replace function public.create_resident_admission_case_with_type(
  p_admit_date date, p_age_years smallint, p_sex text, p_diagnosis text,
  p_management text, p_operation text, p_unit_name text, p_status text, p_owner_id uuid,
  p_treatment_type text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  if p_treatment_type is null or p_treatment_type not in ('conservative', 'operative') then
    raise exception 'Treatment type is required (conservative or operative)';
  end if;
  -- Same checks, owner rules and audit fields as the normal create (named arguments resolve to the installed version).
  v_id := public.create_resident_admission_case(
    p_admit_date := p_admit_date, p_age_years := p_age_years, p_sex := p_sex, p_diagnosis := p_diagnosis,
    p_management := p_management, p_operation := p_operation, p_unit_name := p_unit_name,
    p_status := p_status, p_owner_id := p_owner_id
  );
  update public.resident_admission_cases set treatment_type = p_treatment_type where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.create_resident_admission_case_with_type(date, smallint, text, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.create_resident_admission_case_with_type(date, smallint, text, text, text, text, text, text, uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.create_resident_admission_case_with_type(date, smallint, text, text, text, text, text, text, uuid, text)'::regprocedure, 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.create_resident_admission_case_with_type(date, smallint, text, text, text, text, text, text, uuid, text)'::regprocedure, 'EXECUTE')
  then
    raise exception 'Create-with-type migration check failed';
  end if;
end $$;

commit;
