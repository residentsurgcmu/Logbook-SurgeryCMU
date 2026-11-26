-- Read own export receipts without granting access to either private table.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function rc_hn_prod_private.export_history(p_before uuid default null, p_limit integer default 50)
returns table (
  export_id uuid, exported_at timestamptz, operator_login name, case_ids uuid[], revisions integer[]
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_before_at timestamptz;
begin
  if session_user in ('anon','authenticated','service_role','authenticator')
    or current_setting('role',true) in ('anon','authenticated','service_role','authenticator')
    or auth.uid() is not null then
    raise exception 'HN_EXPORT_FORBIDDEN' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'HN_INVALID_HISTORY_LIMIT' using errcode='22023';
  end if;
  if p_before is not null then
    select h.exported_at into v_before_at from rc_hn_prod_private.export_log h
    where h.operator_login=session_user and h.id=p_before;
    if not found then return; end if;
  end if;

  return query select h.id,h.exported_at,h.operator_login,h.case_ids,h.revisions
  from rc_hn_prod_private.export_log h
  where h.operator_login=session_user
    and (p_before is null or (h.exported_at,h.id)<(v_before_at,p_before))
  order by h.exported_at desc,h.id desc limit p_limit;
end;
$$;

revoke all on function rc_hn_prod_private.export_history(uuid,integer)
  from public, anon, authenticated, service_role, authenticator;
commit;
