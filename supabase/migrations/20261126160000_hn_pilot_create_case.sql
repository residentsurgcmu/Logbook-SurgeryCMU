-- Disabled unless the configured pilot is enabled and an active resident has an explicit invitation.
begin;
set local lock_timeout='5s';
create table rc_hn_prod_private.pilot_creators (
  user_id uuid primary key references public.resident_profiles(user_id) on delete cascade
);
create table rc_hn_prod_private.create_reservations (
  case_id uuid primary key,
  owner_id uuid not null references rc_hn_prod_private.pilot_creators(user_id) on delete cascade,
  case_code text not null unique,
  key_id text not null references rc_hn_prod_private.public_keys(key_id),
  expires_at timestamptz not null default (now() + interval '60 minutes'),
  committed_hash bytea
);
alter table rc_hn_prod_private.pilot_creators enable row level security;
alter table rc_hn_prod_private.create_reservations enable row level security;
revoke all on rc_hn_prod_private.pilot_creators,rc_hn_prod_private.create_reservations
  from public,anon,authenticated,service_role,authenticator;

create function rc_hn_prod_private.create_case(
  p_operation text, p_case_id uuid, p_fields jsonb, p_key_id text, p_ciphertext text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  k text;
  spki_bytes bytea;
  reservation rc_hn_prod_private.create_reservations%rowtype;
  payload_hash bytea;
  reservation_code text;
begin
  if actor is null or p_operation is null or p_operation not in ('status','reserve','save') then
    raise exception 'HN_CREATE_FORBIDDEN' using errcode='42501';
  end if;
  select cfg.key_id,pk.spki into k,spki_bytes
    from rc_hn_prod_private.pilot_config cfg join rc_hn_prod_private.public_keys pk using(key_id)
    where cfg.singleton and cfg.enabled for share of cfg;
  if found then
    perform 1 from public.resident_user_roles r
      where r.user_id=actor and r.role='resident' and r.active for share;
  end if;
  if found then
    perform 1 from public.resident_profiles p where p.user_id=actor and p.active for share;
  end if;
  if found then
    perform 1 from rc_hn_prod_private.pilot_creators pc where pc.user_id=actor for update;
  end if;
  if not found then
    if p_operation='status' then return null; end if;
    raise exception 'HN_CREATE_FORBIDDEN' using errcode='42501';
  end if;
  if p_operation='status' then return jsonb_build_object('eligible',true); end if;
  if p_case_id is null then raise exception 'HN_CREATE_INVALID_ID' using errcode='22023'; end if;
  -- Serialize retries of the same client-generated ID, including a retry after a lost reply.
  perform pg_advisory_xact_lock(hashtextextended(p_case_id::text, 621114));
  select * into reservation from rc_hn_prod_private.create_reservations where case_id=p_case_id;
  if not found and p_operation='reserve' then
    if exists(select from public.resident_admission_cases where id=p_case_id) then
      raise exception 'HN_CREATE_INVALID_ID' using errcode='22023';
    end if;
    if exists(select from rc_hn_prod_private.create_reservations r
      where r.owner_id=actor and r.committed_hash is null and r.expires_at>now() and r.case_id<>p_case_id
      group by r.owner_id having count(*)>=10) then
      raise exception 'HN_CREATE_TOO_MANY_PENDING' using errcode='22023';
    end if;
    reservation_code := nextval('public.resident_admission_case_seq')::text;
    if length(reservation_code)>5 then raise exception 'HN_CREATE_CODE_LIMIT' using errcode='22023'; end if;
    insert into rc_hn_prod_private.create_reservations(case_id,owner_id,case_code,key_id)
    values(p_case_id,actor,'ADM-'||lpad(reservation_code,5,'0'),k) returning * into reservation;
  end if;
  if reservation.owner_id is distinct from actor or reservation.key_id is distinct from k then
    raise exception 'HN_CREATE_FORBIDDEN' using errcode='42501';
  end if;
  if p_operation='reserve' then
    if reservation.committed_hash is not null or reservation.expires_at<=now() then
      raise exception 'HN_CREATE_EXPIRED' using errcode='22023';
    end if;
    return jsonb_build_object('caseCode',reservation.case_code,'publicKey',
      jsonb_build_object('format','rc-hn-prod-v1','type','public','keyId',k,
        'spki',replace(encode(spki_bytes,'base64'),chr(10),'')));
  end if;
  if p_key_id is distinct from k or p_ciphertext is null or length(p_ciphertext)<>512
    or p_ciphertext !~ '^[A-Za-z0-9+/]+$' or jsonb_typeof(p_fields) is distinct from 'object'
    or (p_fields->>'treatment_type') is null or (p_fields->>'treatment_type') not in ('conservative','operative')
    or (p_fields - array['admit_date','age_years','sex','diagnosis','management','operation','unit_name','status','treatment_type']) <> '{}'::jsonb
  then raise exception 'HN_CREATE_INVALID_FIELDS' using errcode='22023'; end if;
  payload_hash := sha256(convert_to(jsonb_build_array(p_fields,p_key_id,p_ciphertext)::text,'UTF8'));
  if reservation.committed_hash is not null then
    if reservation.committed_hash=payload_hash
      and exists(select from public.resident_admission_cases c where c.id=p_case_id and c.owner_id=actor and c.deleted_at is null)
    then return jsonb_build_object('id',p_case_id);
    end if;
    raise exception 'HN_CREATE_ALREADY_COMMITTED' using errcode='40001';
  end if;
  if reservation.expires_at<=now() then raise exception 'HN_CREATE_EXPIRED' using errcode='22023'; end if;
  insert into public.resident_admission_cases
    (id,case_code,admit_date,age_years,sex,diagnosis,management,operation,unit_name,status,treatment_type,owner_id,created_by,updated_by)
  values (p_case_id,reservation.case_code,(p_fields->>'admit_date')::date,(p_fields->>'age_years')::smallint,p_fields->>'sex',
    btrim(p_fields->>'diagnosis'),coalesce(p_fields->>'management',''),coalesce(p_fields->>'operation',''),p_fields->>'unit_name',
    p_fields->>'status',p_fields->>'treatment_type',actor,actor,actor);
  insert into rc_hn_prod_private.pilot_cases(case_id) values(p_case_id);
  insert into rc_hn_prod_private.records(case_id,key_id,ciphertext,revision)
    values(p_case_id,k,decode(p_ciphertext,'base64'),1);
  update rc_hn_prod_private.create_reservations set committed_hash=payload_hash where case_id=p_case_id;
  return jsonb_build_object('id',p_case_id);
end;
$$;

create function public.rc_hn_pilot_create_case(
  p_operation text, p_case_id uuid default null, p_fields jsonb default null,
  p_key_id text default null, p_ciphertext text default null
) returns jsonb language sql security invoker set search_path=''
return rc_hn_prod_private.create_case(p_operation,p_case_id,p_fields,p_key_id,p_ciphertext);
revoke all on function public.rc_hn_pilot_create_case(text,uuid,jsonb,text,text),
  rc_hn_prod_private.create_case(text,uuid,jsonb,text,text) from public,anon,authenticated,service_role,authenticator;
grant execute on function public.rc_hn_pilot_create_case(text,uuid,jsonb,text,text),
  rc_hn_prod_private.create_case(text,uuid,jsonb,text,text) to authenticated;
commit;
