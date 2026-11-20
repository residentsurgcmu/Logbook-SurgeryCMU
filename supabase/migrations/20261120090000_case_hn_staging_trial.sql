-- Disabled by default. Only a DB operator may enable a synthetic-data rehearsal,
-- pin a public key, and select trial cases and Staff moderators.
begin;

create table private.rc_hn_trial_config (
  singleton boolean primary key default true check (singleton),
  public_spki text not null check (length(public_spki) between 500 and 602 and public_spki ~ '^[A-Za-z0-9+/]+={0,2}$'),
  key_id text generated always as (encode(sha256(decode(public_spki, 'base64')), 'hex')) stored
);
create table private.rc_hn_trial_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table private.rc_hn_trial_cases (
  case_id uuid primary key references public.resident_admission_cases(id) on delete cascade
);
create table private.rc_hn_trial_records (
  case_id uuid primary key references private.rc_hn_trial_cases(case_id) on delete cascade,
  key_id text not null check (key_id ~ '^[0-9a-f]{64}$'),
  ciphertext text not null check (length(ciphertext) = 512 and ciphertext ~ '^[A-Za-z0-9+/]+$'),
  revision integer not null check (revision > 0)
);

alter table private.rc_hn_trial_config enable row level security;
alter table private.rc_hn_trial_moderators enable row level security;
alter table private.rc_hn_trial_cases enable row level security;
alter table private.rc_hn_trial_records enable row level security;
revoke all on private.rc_hn_trial_config, private.rc_hn_trial_moderators,
  private.rc_hn_trial_cases, private.rc_hn_trial_records
  from public, anon, authenticated, service_role;

create function private.rc_hn_trial(
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
  v_download boolean;
begin
  if v_actor is null or p_operation is null or p_operation not in ('status', 'save', 'download') then
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
  v_download := false;
  if v_role = 'staff' then
    perform 1 from private.rc_hn_trial_moderators where user_id = v_actor for share;
    v_download := found;
  end if;
  if (p_operation = 'save' and not v_write) or (p_operation = 'download' and not v_download) then
    raise exception 'HN_TRIAL_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_record from private.rc_hn_trial_records where case_id = p_case_id;
  if p_operation = 'status' then
    return jsonb_build_object(
      'publicKey', case when v_write then jsonb_build_object(
        'format','rc-hn-demo-v1','type','public','keyId',v_key_id,'spki',v_public_spki
      ) end,
      'saved', v_record.case_id is not null,
      'canWrite', v_write, 'canDownload', v_download,
      'revision', case when v_write then coalesce(v_record.revision, 0) end
    );
  end if;
  if p_operation = 'download' then
    if v_record.case_id is null then return null; end if;
    return jsonb_build_object(
      'format', 'rc-hn-demo-v1', 'type', 'trial-record', 'caseId', v_case.case_code,
      'caseUuid', v_case.id, 'keyId', v_record.key_id, 'ciphertext', v_record.ciphertext
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

create function public.rc_hn_case_trial(
  p_case_id uuid, p_operation text, p_key_id text default null,
  p_ciphertext text default null, p_revision integer default null
)
-- SQL-standard body binds the private function at creation. Clients do not
-- need USAGE on the private schema; the invoker still needs EXECUTE.
returns jsonb language sql security invoker set search_path = ''
return private.rc_hn_trial(p_case_id, p_operation, p_key_id, p_ciphertext, p_revision);

revoke all on function private.rc_hn_trial(uuid,text,text,text,integer),
  public.rc_hn_case_trial(uuid,text,text,text,integer) from public, anon, authenticated, service_role;
grant execute on function private.rc_hn_trial(uuid,text,text,text,integer),
  public.rc_hn_case_trial(uuid,text,text,text,integer) to authenticated;
commit;
