-- Clinical fields for admission cases (present illness, vital signs, physical
-- examination) and permanent image deletion by Admin.
-- Backward compatible: the new RPC parameters have defaults, so the frontend
-- that is live while this runs keeps working. Editing from an old browser tab
-- never touches the clinical columns (p_set_clinical defaults to false).
-- Apply on its own: npx --yes supabase db query --linked --file <this file>
begin;

alter table public.resident_admission_cases
  add column if not exists present_illness text not null default '' check (char_length(present_illness) <= 2000),
  add column if not exists physical_exam text not null default '' check (char_length(physical_exam) <= 2000),
  add column if not exists bp_systolic smallint check (bp_systolic between 40 and 300),
  add column if not exists bp_diastolic smallint check (bp_diastolic between 20 and 200),
  add column if not exists heart_rate smallint check (heart_rate between 20 and 250),
  add column if not exists resp_rate smallint check (resp_rate between 4 and 80),
  add column if not exists body_temp numeric(4,1) check (body_temp between 30.0 and 45.0),
  add column if not exists spo2 smallint check (spo2 between 50 and 100);

alter table public.resident_admission_cases
  drop constraint if exists resident_admission_cases_bp_pair_check;
alter table public.resident_admission_cases
  add constraint resident_admission_cases_bp_pair_check
  check (bp_systolic is null or bp_diastolic is null or bp_diastolic < bp_systolic);

drop function if exists public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid);
drop function if exists public.update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid);

create or replace function public.create_resident_admission_case(
  p_admit_date date, p_age_years smallint, p_sex text, p_diagnosis text,
  p_management text, p_operation text, p_unit_name text, p_status text, p_owner_id uuid,
  p_present_illness text default '', p_physical_exam text default '',
  p_bp_systolic smallint default null, p_bp_diastolic smallint default null,
  p_heart_rate smallint default null, p_resp_rate smallint default null,
  p_body_temp numeric default null, p_spo2 smallint default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  perform private.resident_case_assert_owner(p_owner_id);
  insert into public.resident_admission_cases
    (admit_date, age_years, sex, diagnosis, management, operation, unit_name, status, owner_id, created_by, updated_by,
     present_illness, physical_exam, bp_systolic, bp_diastolic, heart_rate, resp_rate, body_temp, spo2)
  values
    (p_admit_date, p_age_years, p_sex, btrim(p_diagnosis), coalesce(p_management, ''), coalesce(p_operation, ''),
     p_unit_name, p_status, p_owner_id, auth.uid(), auth.uid(),
     coalesce(p_present_illness, ''), coalesce(p_physical_exam, ''), p_bp_systolic, p_bp_diastolic,
     p_heart_rate, p_resp_rate, p_body_temp, p_spo2)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_resident_admission_case(
  p_case_id uuid, p_expected_updated_at timestamptz,
  p_admit_date date, p_age_years smallint, p_sex text, p_diagnosis text,
  p_management text, p_operation text, p_unit_name text, p_status text, p_owner_id uuid,
  p_set_clinical boolean default false,
  p_present_illness text default '', p_physical_exam text default '',
  p_bp_systolic smallint default null, p_bp_diastolic smallint default null,
  p_heart_rate smallint default null, p_resp_rate smallint default null,
  p_body_temp numeric default null, p_spo2 smallint default null
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_case public.resident_admission_cases%rowtype;
  v_updated timestamptz;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  select * into v_case from public.resident_admission_cases
  where id = p_case_id and deleted_at is null for update;
  if not found then raise exception 'Case not found'; end if;
  if not (select private.resident_can_edit_case(p_case_id)) then
    raise exception 'You cannot edit this case';
  end if;
  if v_case.updated_at is distinct from p_expected_updated_at then
    raise exception 'CASE_CONFLICT: this case was changed by someone else';
  end if;
  if p_owner_id is distinct from v_case.owner_id then
    perform private.resident_case_assert_owner(p_owner_id);
  end if;
  update public.resident_admission_cases set
    admit_date = p_admit_date, age_years = p_age_years, sex = p_sex,
    diagnosis = btrim(p_diagnosis), management = coalesce(p_management, ''),
    operation = coalesce(p_operation, ''), unit_name = p_unit_name, status = p_status,
    owner_id = p_owner_id,
    present_illness = case when p_set_clinical then coalesce(p_present_illness, '') else present_illness end,
    physical_exam = case when p_set_clinical then coalesce(p_physical_exam, '') else physical_exam end,
    bp_systolic = case when p_set_clinical then p_bp_systolic else bp_systolic end,
    bp_diastolic = case when p_set_clinical then p_bp_diastolic else bp_diastolic end,
    heart_rate = case when p_set_clinical then p_heart_rate else heart_rate end,
    resp_rate = case when p_set_clinical then p_resp_rate else resp_rate end,
    body_temp = case when p_set_clinical then p_body_temp else body_temp end,
    spo2 = case when p_set_clinical then p_spo2 else spo2 end,
    updated_by = auth.uid(), updated_at = clock_timestamp()
  where id = p_case_id
  returning updated_at into v_updated;
  return v_updated;
end;
$$;

-- Admin only: removes the media row for good and returns the storage path so
-- the client can delete the file (the storage delete policy allows Admin).
create or replace function public.admin_purge_resident_case_media(p_media_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_path text;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  delete from public.resident_case_media where id = p_media_id returning storage_path into v_path;
  if v_path is null then raise exception 'Image not found'; end if;
  return v_path;
end;
$$;

revoke all on function public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid, text, text, smallint, smallint, smallint, smallint, numeric, smallint) from public, anon;
revoke all on function public.update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid, boolean, text, text, smallint, smallint, smallint, smallint, numeric, smallint) from public, anon;
revoke all on function public.admin_purge_resident_case_media(uuid) from public, anon;
grant execute on function public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid, text, text, smallint, smallint, smallint, smallint, numeric, smallint) to authenticated;
grant execute on function public.update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid, boolean, text, text, smallint, smallint, smallint, smallint, numeric, smallint) to authenticated;
grant execute on function public.admin_purge_resident_case_media(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.admin_purge_resident_case_media(uuid)'::regprocedure, 'EXECUTE')
    or has_function_privilege('anon', 'public.update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid, boolean, text, text, smallint, smallint, smallint, smallint, numeric, smallint)'::regprocedure, 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid, text, text, smallint, smallint, smallint, smallint, numeric, smallint)'::regprocedure, 'EXECUTE')
  then
    raise exception 'Resident case clinical grant regression';
  end if;
end;
$$;

commit;
