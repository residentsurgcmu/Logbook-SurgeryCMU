-- Grand Rounds Moderator is an offline workstation duty, not an account.
-- The browser has no read path to ciphertext, including old download calls.
begin;
set local lock_timeout = '5s';

create or replace function private.rc_hn_trial(
  p_case_id uuid, p_operation text, p_key_id text, p_ciphertext text, p_revision integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role public.resident_system_role;
  v_case public.resident_admission_cases%rowtype;
  v_key_id text;
  v_public_spki text;
  v_record private.rc_hn_trial_records%rowtype;
  v_write boolean;
begin
  if v_actor is null or p_operation is null or p_operation not in ('status', 'save') then
    raise exception 'HN_TRIAL_FORBIDDEN' using errcode = '42501';
  end if;
  -- Same first row lock as the account lifecycle RPCs.
  select r.role into v_role from public.resident_user_roles r
    where r.user_id = v_actor and r.active for share;
  if v_role is null or not private.resident_case_member() then
    raise exception 'HN_TRIAL_FORBIDDEN' using errcode = '42501';
  end if;
  select key_id, public_spki into v_key_id, v_public_spki from private.rc_hn_trial_config where singleton for share;
  if v_key_id is not null then
    if p_operation = 'save' then
      select c.* into v_case from public.resident_admission_cases c
      join private.rc_hn_trial_cases t on t.case_id = c.id
      where c.id = p_case_id and c.deleted_at is null for update of c for share of t;
    else
      select c.* into v_case from public.resident_admission_cases c
      join private.rc_hn_trial_cases t on t.case_id = c.id
      where c.id = p_case_id and c.deleted_at is null for share of c, t;
    end if;
  end if;
  if v_case.id is null then
    if p_operation = 'status' then return null; end if;
    raise exception 'HN_TRIAL_FORBIDDEN' using errcode = '42501';
  end if;
  v_write := v_role = 'resident' and v_case.owner_id = v_actor;
  if p_operation = 'save' and not v_write then
    raise exception 'HN_TRIAL_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_record from private.rc_hn_trial_records where case_id = p_case_id;
  if p_operation = 'status' then
    return jsonb_build_object(
      'publicKey', case when v_write then jsonb_build_object(
        'format','rc-hn-demo-v1','type','public','keyId',v_key_id,'spki',v_public_spki
      ) end,
      'saved', v_record.case_id is not null,
      'canWrite', v_write,
      'revision', case when v_write then coalesce(v_record.revision, 0) end
    );
  end if;
  if p_key_id is distinct from v_key_id or p_ciphertext is null or length(p_ciphertext) <> 512
    or p_ciphertext !~ '^[A-Za-z0-9+/]+$' then
    raise exception 'HN_TRIAL_INVALID_ENVELOPE' using errcode = '22023';
  end if;
  if p_revision is distinct from coalesce(v_record.revision, 0) then
    raise exception 'HN_TRIAL_VERSION_CONFLICT' using errcode = '40001';
  end if;
  insert into private.rc_hn_trial_records as current (case_id,key_id,ciphertext,revision)
    values (p_case_id,p_key_id,p_ciphertext,1)
    on conflict (case_id) do update
    set key_id = excluded.key_id, ciphertext = excluded.ciphertext, revision = current.revision + 1;
  return jsonb_build_object('saved', true, 'revision', coalesce(v_record.revision, 0) + 1);
end;
$$;

-- Database operator only: build one narrow bundle from explicit, enrolled,
-- non-deleted synthetic cases, all under the current rehearsal key.
create function private.rc_hn_trial_export_bundle(p_case_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_key_id text;
  v_records jsonb;
begin
  if coalesce(cardinality(p_case_ids),0) not between 1 and 50
      or (select count(distinct u.id) from unnest(p_case_ids) as u(id)) <> cardinality(p_case_ids) then
    raise exception 'HN_TRIAL_INVALID_BUNDLE' using errcode = '22023';
  end if;
  select conf.key_id, jsonb_agg(jsonb_build_object(
      'format','rc-hn-demo-v1','type','trial-record','caseId',c.case_code,'caseUuid',c.id,
      'keyId',r.key_id,'ciphertext',r.ciphertext
    ) order by u.position)
    into v_key_id, v_records
  from private.rc_hn_trial_config conf
  cross join unnest(p_case_ids) with ordinality as u(id,position)
  join private.rc_hn_trial_cases t on t.case_id = u.id
  join public.resident_admission_cases c on c.id = t.case_id and c.deleted_at is null
  join private.rc_hn_trial_records r on r.case_id = t.case_id and r.key_id = conf.key_id
  where conf.singleton
  group by conf.key_id;
  if coalesce(jsonb_array_length(v_records),0) <> cardinality(p_case_ids) then
    raise exception 'HN_TRIAL_BUNDLE_NOT_READY' using errcode = '22023';
  end if;
  return jsonb_build_object('format','rc-hn-demo-v1','type','trial-bundle',
    'keyId',v_key_id,'records',v_records);
end;
$$;
revoke all on function private.rc_hn_trial_export_bundle(uuid[]) from public, anon, authenticated, service_role;
comment on table private.rc_hn_trial_moderators is
  'Retired compatibility table. No code reads assignments; Grand Rounds opens HN only on the offline workstation.';
commit;
