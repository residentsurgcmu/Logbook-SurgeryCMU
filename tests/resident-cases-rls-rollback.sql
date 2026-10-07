-- Behaviour test for the Resident case RPCs. Everything runs in ONE transaction
-- that always ends in ROLLBACK, so no case/note data is kept (a sequence number
-- is consumed; that gap is harmless). Needs at least one active Admin, Staff and
-- Resident account. The owner runs it after the migration:
-- npx --yes supabase db query --linked --file tests/resident-cases-rls-rollback.sql
begin;

create function public.zz_act_as(p_user uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function public.zz_reset() returns void language plpgsql as $$
begin
  execute 'reset role';
end;
$$;

create function public.zz_upd(p_case uuid, p_ts timestamptz, p_dx text, p_owner uuid)
returns timestamptz language sql as $$
  select public.update_resident_admission_case(
    p_case, p_ts, (now() at time zone 'Asia/Bangkok')::date, 60::smallint, 'male',
    p_dx, 'mgmt', '', 'Upper GI', 'admit', p_owner);
$$;

do $$
declare
  v_admin uuid; v_staff uuid; v_res uuid; v_res2 uuid;
  v_case uuid; v_ts timestamptz; v_ts2 timestamptz; v_ts3 timestamptz;
  v_note uuid; v_count int; v_paths text[];
begin
  select user_id into v_admin from public.resident_user_roles where role = 'admin' and active limit 1;
  select user_id into v_staff from public.resident_user_roles where role = 'staff' and active limit 1;
  select user_id into v_res from public.resident_user_roles where role = 'resident' and active limit 1;
  select user_id into v_res2 from public.resident_user_roles where role = 'resident' and active and user_id <> v_res limit 1;
  if v_admin is null or v_staff is null or v_res is null then
    raise exception 'Need one active Admin, Staff and Resident account to run this test';
  end if;

  -- Resident creates a case and edits it.
  perform public.zz_act_as(v_res);
  v_case := public.create_resident_admission_case_with_type(
    (now() at time zone 'Asia/Bangkok')::date, 64::smallint, 'female', 'TEST dx', 'mgmt', '', 'Upper GI', 'admit', v_res, 'operative');
  select updated_at into v_ts from public.resident_admission_cases where id = v_case;
  v_ts2 := public.zz_upd(v_case, v_ts, 'TEST dx 2', v_res);
  if v_ts2 <= v_ts then raise exception 'updated_at must advance'; end if;

  -- Stale save is refused (two windows editing the same case).
  begin
    perform public.zz_upd(v_case, v_ts, 'stale', v_res);
    raise exception 'EXPECTED FAILURE: stale update succeeded';
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    if sqlerrm not like 'CASE_CONFLICT%' then raise exception 'wrong error for stale update: %', sqlerrm; end if;
  end;

  -- Direct table writes are not possible.
  begin
    insert into public.resident_admission_cases (admit_date, age_years, sex, diagnosis, unit_name, owner_id, created_by, updated_by)
    values (current_date, 1, 'male', 'direct', 'HBP', v_res, v_res, v_res);
    raise exception 'EXPECTED FAILURE: direct insert succeeded';
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    if sqlerrm not like '%permission denied%' then raise exception 'wrong error for direct insert: %', sqlerrm; end if;
  end;

  -- Another Resident (not creator, not owner) cannot edit.
  if v_res2 is not null then
    perform public.zz_act_as(v_res2);
    begin
      perform public.zz_upd(v_case, v_ts2, 'hijack', v_res);
      raise exception 'EXPECTED FAILURE: other resident edited';
    exception when others then
      if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
      if sqlerrm not like '%cannot edit%' then raise exception 'wrong error for other resident: %', sqlerrm; end if;
    end;
    perform public.zz_act_as(v_res);
  end if;

  -- Staff can edit any case but cannot delete it.
  perform public.zz_act_as(v_staff);
  v_ts3 := public.zz_upd(v_case, v_ts2, 'edited by staff', v_res);
  begin
    perform public.soft_delete_resident_admission_case(v_case, v_ts3);
    raise exception 'EXPECTED FAILURE: staff deleted a case';
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    if sqlerrm not like '%cannot delete%' then raise exception 'wrong error for staff delete: %', sqlerrm; end if;
  end;

  -- Notes: both authors add; only the author edits; admin may delete any.
  perform public.add_resident_case_note(v_case, 'staff note');
  perform public.zz_act_as(v_res);
  v_note := public.add_resident_case_note(v_case, 'resident note');
  select count(*) into v_count from public.resident_case_notes where case_id = v_case;
  if v_count <> 2 then raise exception 'expected 2 notes, got %', v_count; end if;
  perform public.zz_act_as(v_staff);
  begin
    perform public.edit_resident_case_note(v_note, 'tamper');
    raise exception 'EXPECTED FAILURE: staff edited resident note';
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    if sqlerrm not like '%cannot change%' then raise exception 'wrong error for note edit: %', sqlerrm; end if;
  end;
  perform public.zz_act_as(v_admin);
  perform public.delete_resident_case_note(v_note);

  -- Resident (creator) soft-deletes: hidden from Residents, still visible to Admin.
  perform public.zz_act_as(v_res);
  select updated_at into v_ts from public.resident_admission_cases where id = v_case;
  perform public.soft_delete_resident_admission_case(v_case, v_ts);
  select count(*) into v_count from public.resident_admission_cases where id = v_case;
  if v_count <> 0 then raise exception 'soft-deleted case still visible to Resident'; end if;
  perform public.zz_act_as(v_admin);
  select count(*) into v_count from public.resident_admission_cases where id = v_case;
  if v_count <> 1 then raise exception 'Admin should still see the soft-deleted case'; end if;

  -- Only Admin purges.
  perform public.zz_act_as(v_staff);
  begin
    perform public.admin_purge_resident_admission_case(v_case);
    raise exception 'EXPECTED FAILURE: staff purged';
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    if sqlerrm not like '%Admin account required%' then raise exception 'wrong error for purge: %', sqlerrm; end if;
  end;
  perform public.zz_act_as(v_admin);
  v_paths := public.admin_purge_resident_admission_case(v_case);
  select count(*) into v_count from public.resident_admission_cases where id = v_case;
  if v_count <> 0 then raise exception 'purge left the case behind'; end if;

  perform public.zz_reset();
  raise notice 'resident cases behaviour checks passed';
end;
$$;

rollback;
