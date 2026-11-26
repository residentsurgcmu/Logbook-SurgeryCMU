begin;
set local lock_timeout = '5s';
create or replace function rc_hn_prod_private.web_export(p_operation text,p_case_ids uuid[],p_prefix text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_key text;
  v_allowed boolean;
  v_rows jsonb;
  v_revisions integer[];
begin
  if p_operation is null or p_operation not in ('status','list','list-day','download') then
    raise exception 'HN_EXPORT_BAD_OPERATION' using errcode='22023';
  end if;
  select key_id into v_key from rc_hn_prod_private.pilot_config where singleton and enabled for share;
  if found and v_actor is not null then
    select r.role::text into v_role from public.resident_user_roles r
      where r.user_id=v_actor and r.active for share;
    if found then
      perform 1 from public.resident_profiles p where p.user_id=v_actor and p.active for share;
    end if;
    if found and v_role is distinct from 'admin' then
      perform 1 from rc_hn_prod_private.web_export_operators o where o.user_id=v_actor for share;
    end if;
    v_allowed := found;
  end if;
  if v_allowed is distinct from true then
    if p_operation='status' then return null; end if;
    raise exception 'HN_EXPORT_UNAVAILABLE' using errcode='42501';
  end if;
  if p_operation='status' then return jsonb_build_object('allowed',true); end if;
  if p_operation in ('list','list-day') then
    if p_operation='list-day' then
      if p_prefix is null or p_prefix !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'HN_EXPORT_BAD_DATE' using errcode='22023';
      end if;
    elsif p_prefix is null or p_prefix !~ '^(ADM-)?[0-9]{0,5}$' then
      raise exception 'HN_EXPORT_BAD_PREFIX' using errcode='22023';
    end if;
    return (
      select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'code',q.case_code,'admitDate',q.admit_date)
        order by q.case_code desc,q.id desc),'[]'::jsonb)
      from (
        select c.id,c.case_code,c.admit_date from public.resident_admission_cases c
        join rc_hn_prod_private.pilot_cases pc on pc.case_id=c.id
        join rc_hn_prod_private.records r on r.case_id=c.id and r.key_id=v_key
        where c.deleted_at is null and case when p_operation='list-day'
          then c.admit_date=p_prefix::date
          else c.case_code like ('ADM-' || replace(p_prefix,'ADM-','') || '%') end
        order by c.case_code desc,c.id desc limit (case when p_operation='list-day' then 501 else 50 end)
      ) q
    );
  end if;
  if coalesce(cardinality(p_case_ids),0) not between 1 and 50
    or coalesce(array_ndims(p_case_ids),0) <> 1
    or (select count(distinct a.id) from unnest(p_case_ids) a(id))<>cardinality(p_case_ids) then
    raise exception 'HN_INVALID_EXPORT_LIST' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('format','rc-hn-prod-v1','type','record',
    'caseId', c.case_code, 'caseUuid',c.id, 'keyId',r.key_id,
    'ciphertext',replace(encode(r.ciphertext,'base64'),chr(10),''),
    'revision',r.revision) order by a.position),
    array_agg(r.revision order by a.position)
  into v_rows,v_revisions
  from unnest(p_case_ids) with ordinality a(id,position)
  join rc_hn_prod_private.pilot_cases pc on pc.case_id=a.id
  join rc_hn_prod_private.records r on r.case_id=a.id and r.key_id=v_key
  join public.resident_admission_cases c on c.id=a.id and c.deleted_at is null;
  if coalesce(jsonb_array_length(v_rows),0)<>cardinality(p_case_ids) then
    raise exception 'HN_EXPORT_NOT_READY' using errcode='22023';
  end if;
  insert into rc_hn_prod_private.web_export_log(operator_id,key_id,case_ids,revisions)
  values(v_actor,v_key,p_case_ids,v_revisions);
  return jsonb_build_object('format','rc-hn-prod-v1','type','bundle','keyId',v_key,'records',v_rows);
end;
$$;
commit;
