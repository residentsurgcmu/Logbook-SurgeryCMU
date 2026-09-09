begin;

-- RLS policies invoke these helpers as the requesting authenticated user.
-- Keep the functions in the private schema and callable only by the database
-- role that evaluates those policies; do not expose them to anon or PUBLIC.
revoke all on function private.resident_role_is(public.resident_system_role) from public, anon;
revoke all on function private.resident_can_evaluate(uuid) from public, anon;
grant execute on function private.resident_role_is(public.resident_system_role) to authenticated;
grant execute on function private.resident_can_evaluate(uuid) to authenticated;

-- Fail the migration if a future privilege change breaks RLS evaluation or
-- accidentally exposes the helpers outside authenticated database requests.
do $$
begin
  if not has_function_privilege('authenticated', 'private.resident_role_is(public.resident_system_role)'::regprocedure, 'EXECUTE')
    or not has_function_privilege('authenticated', 'private.resident_can_evaluate(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'Authenticated role must execute Resident RLS helpers';
  end if;

  if has_function_privilege('anon', 'private.resident_role_is(public.resident_system_role)'::regprocedure, 'EXECUTE')
    or has_function_privilege('anon', 'private.resident_can_evaluate(uuid)'::regprocedure, 'EXECUTE')
    or has_function_privilege('public', 'private.resident_role_is(public.resident_system_role)'::regprocedure, 'EXECUTE')
    or has_function_privilege('public', 'private.resident_can_evaluate(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'Resident RLS helpers must not be executable by anon or PUBLIC';
  end if;
end;
$$;

commit;
