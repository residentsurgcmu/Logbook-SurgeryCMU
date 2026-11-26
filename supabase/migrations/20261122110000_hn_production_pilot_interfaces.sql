-- Adds interfaces only. Does not enroll cases, register keys, or enable the pilot.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table rc_hn_prod_private.export_log (
  id uuid primary key default gen_random_uuid(),
  exported_at timestamptz not null default clock_timestamp(),
  operator_login name not null,
  key_id text not null,
  case_ids uuid[] not null,
  revisions integer[] not null
);
alter table rc_hn_prod_private.export_log enable row level security;
revoke all on rc_hn_prod_private.export_log from public, anon, authenticated, service_role, authenticator;

create function rc_hn_prod_private.submit_case(
  p_case_id uuid, p_operation text, p_key_id text, p_ciphertext text, p_revision integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_key text;
  v_spki bytea;
  v_current integer;
  v_cipher bytea;
begin
  if v_actor is null or p_operation is null or p_operation not in ('status','save') then
    raise exception 'HN_PILOT_FORBIDDEN' using errcode='42501';
  end if;
  select cfg.key_id,k.spki into v_key,v_spki
  from rc_hn_prod_private.pilot_config cfg
  join rc_hn_prod_private.public_keys k using(key_id)
  where cfg.singleton and cfg.enabled for share of cfg;
  if not found then
    if p_operation='status' then return null; end if;
    raise exception 'HN_PILOT_CLOSED' using errcode='42501';
  end if;
  perform 1 from public.resident_user_roles r
    where r.user_id=v_actor and r.role='resident' and r.active for share;
  if found then
    perform 1 from public.resident_profiles p where p.user_id=v_actor and p.active for share;
  end if;
  if not found then
    if p_operation='status' then return null; end if;
    raise exception 'HN_PILOT_FORBIDDEN' using errcode='42501';
  end if;
  -- Same case lock for every save: the expected version protects first save and edits.
  perform 1 from public.resident_admission_cases c
  join rc_hn_prod_private.pilot_cases pc on pc.case_id=c.id
  where c.id=p_case_id and c.owner_id=v_actor and c.deleted_at is null for update of c for share of pc;
  if not found then
    if p_operation='status' then return null; end if;
    raise exception 'HN_PILOT_FORBIDDEN' using errcode='42501';
  end if;
  select revision into v_current from rc_hn_prod_private.records where case_id=p_case_id;
  if p_operation='status' then
    return jsonb_build_object('saved',v_current is not null,'revision',coalesce(v_current,0),
      'publicKey',jsonb_build_object('format','rc-hn-prod-v1','type','public',
       'keyId',v_key,'spki',replace(encode(v_spki,'base64'),chr(10),'')));
  end if;
  if p_key_id is distinct from v_key or p_ciphertext is null or length(p_ciphertext)<>512
    or p_ciphertext !~ '^[A-Za-z0-9+/]+$' then
    raise exception 'HN_PILOT_INVALID_ENVELOPE' using errcode='22023';
  end if;
  if p_revision is distinct from coalesce(v_current,0) then
    raise exception 'HN_PILOT_VERSION_CONFLICT' using errcode='40001';
  end if;
  v_cipher := decode(p_ciphertext,'base64');
  insert into rc_hn_prod_private.records(case_id,key_id,ciphertext,revision)
  values(p_case_id,v_key,v_cipher,coalesce(v_current,0)+1)
  on conflict(case_id) do update set key_id=excluded.key_id,ciphertext=excluded.ciphertext,revision=excluded.revision;
  return jsonb_build_object('saved',true,'revision',coalesce(v_current,0)+1);
end;
$$;

create function public.rc_hn_pilot_case(
  p_case_id uuid, p_operation text, p_key_id text default null,
  p_ciphertext text default null, p_revision integer default null
)
returns jsonb language sql security invoker set search_path = ''
return rc_hn_prod_private.submit_case(p_case_id,p_operation,p_key_id,p_ciphertext,p_revision);

revoke all on function rc_hn_prod_private.submit_case(uuid,text,text,text,integer),
  public.rc_hn_pilot_case(uuid,text,text,text,integer)
from public, anon, authenticated, service_role, authenticator;
grant execute on function rc_hn_prod_private.submit_case(uuid,text,text,text,integer),
  public.rc_hn_pilot_case(uuid,text,text,text,integer) to authenticated;

-- Private operator action. No applicant/web role is granted access by this migration.
create function rc_hn_prod_private.export_bundle(p_case_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_rows jsonb;
  v_revisions integer[];
begin
  if session_user in ('anon','authenticated','service_role','authenticator')
    or current_setting('role',true) in ('anon','authenticated','service_role','authenticator')
    or auth.uid() is not null then
    raise exception 'HN_EXPORT_FORBIDDEN' using errcode='42501';
  end if;
  if coalesce(cardinality(p_case_ids),0) not between 1 and 50
    or (select count(distinct a.id) from unnest(p_case_ids) a(id))<>cardinality(p_case_ids) then
    raise exception 'HN_INVALID_EXPORT_LIST' using errcode='22023';
  end if;
  select key_id into v_key from rc_hn_prod_private.pilot_config where singleton and enabled for share;
  if not found then raise exception 'HN_PILOT_CLOSED' using errcode='42501'; end if;
  select jsonb_agg(jsonb_build_object('format','rc-hn-prod-v1','type','record',
    'caseId', c.case_code, 'caseUuid',c.id, 'keyId',r.key_id,
    'ciphertext',replace(encode(r.ciphertext,'base64'),chr(10),''),
    'revision',r.revision) order by a.position),
    array_agg(r.revision order by a.position)
  into v_rows,v_revisions
  from unnest(p_case_ids) with ordinality a(id,position)
  join rc_hn_prod_private.records r on r.case_id=a.id and r.key_id=v_key
  join public.resident_admission_cases c on c.id=a.id and c.deleted_at is null;
  if coalesce(jsonb_array_length(v_rows),0)<>cardinality(p_case_ids) then
    raise exception 'HN_EXPORT_NOT_READY' using errcode='22023';
  end if;
  insert into rc_hn_prod_private.export_log(operator_login,key_id,case_ids,revisions)
  values(session_user,v_key,p_case_ids,v_revisions);
  return jsonb_build_object('format','rc-hn-prod-v1','type','bundle','keyId',v_key,'records',v_rows);
end;
$$;
revoke all on function rc_hn_prod_private.export_bundle(uuid[])
  from public, anon, authenticated, service_role, authenticator;
commit;
