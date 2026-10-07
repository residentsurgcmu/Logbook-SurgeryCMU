-- Editing a case and its Type in ONE step (one database transaction): if the Type cannot be saved, the edit is
-- not saved either, so there is no "half saved" case. Additive: one new function; the existing update and
-- set-Type functions are not changed. Works with whichever version of the update function is installed.
begin;

do $$
begin
  if to_regprocedure('public.set_resident_case_treatment_type(uuid, text, timestamptz)') is null then
    raise exception 'Run 20261004090000_resident_case_treatment_type.sql first';
  end if;
end $$;

create or replace function public.update_resident_admission_case_with_type(
  p_case_id uuid, p_expected_updated_at timestamptz,
  p_admit_date date, p_age_years smallint, p_sex text, p_diagnosis text,
  p_management text, p_operation text, p_unit_name text, p_status text, p_owner_id uuid,
  p_treatment_type text
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_updated timestamptz;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  -- An older case may have no Type, so clearing it (null) is allowed here; a wrong value is not.
  if p_treatment_type is not null and p_treatment_type not in ('conservative', 'operative') then
    raise exception 'Invalid treatment type';
  end if;
  v_updated := public.update_resident_admission_case(
    p_case_id := p_case_id, p_expected_updated_at := p_expected_updated_at,
    p_admit_date := p_admit_date, p_age_years := p_age_years, p_sex := p_sex, p_diagnosis := p_diagnosis,
    p_management := p_management, p_operation := p_operation, p_unit_name := p_unit_name,
    p_status := p_status, p_owner_id := p_owner_id
  );
  -- Same access rule and version check as the normal Type change; returns the final version.
  return public.set_resident_case_treatment_type(p_case_id, p_treatment_type, v_updated);
end;
$$;

revoke all on function public.update_resident_admission_case_with_type(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.update_resident_admission_case_with_type(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.update_resident_admission_case_with_type(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid, text)'::regprocedure, 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.update_resident_admission_case_with_type(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid, text)'::regprocedure, 'EXECUTE')
  then
    raise exception 'Update-with-type migration check failed';
  end if;
end $$;

commit;
