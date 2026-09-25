-- Fix "column reference \"session_id\" is ambiguous" errors.
--
-- public.current_resident_round_qr() and public.check_in_resident_round()
-- both declare `returns table(session_id uuid, ...)`, which makes plpgsql
-- create an implicit output variable literally named `session_id`. Each
-- function also ran an `insert ... on conflict (session_id, ...)` against a
-- table that has a real `session_id` column, and Postgres cannot tell the
-- conflict target column apart from the plpgsql variable of the same name,
-- so it raises "column reference \"session_id\" is ambiguous" every time
-- either function runs. This is a well known plpgsql gotcha: a function
-- should never use a variable (including an implicit OUT column) whose name
-- collides with a column of a table referenced in the same function body.
--
-- The fix moves the `insert ... on conflict` statements into small private
-- helper functions that have no `session_id`-named variable in scope, so the
-- ON CONFLICT target list only ever resolves to the table column. The public
-- functions keep their exact signatures and output column names, so no
-- caller (residentApi.js) needs to change.

create or replace function private.claim_resident_round_qr_token(p_session_id uuid, p_minute timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.resident_round_qr_tokens(session_id, minute_start)
  values (p_session_id, p_minute)
  on conflict (session_id, minute_start) do nothing;
end;
$$;
revoke all on function private.claim_resident_round_qr_token(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.current_resident_round_qr()
returns table(session_id uuid, token uuid, server_now timestamptz, valid_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_session_id uuid;
begin
  if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
  if not private.resident_round_is_open(v_now) then return; end if;
  select s.id into v_session_id from public.resident_round_sessions s
  where s.meeting_date = (v_now at time zone 'Asia/Bangkok')::date and s.closed_at is null;
  if v_session_id is null then return; end if;
  perform private.claim_resident_round_qr_token(v_session_id, v_minute);
  return query select v_session_id, q.token, v_now, v_minute + interval '1 minute'
  from public.resident_round_qr_tokens q
  where q.session_id = v_session_id and q.minute_start = v_minute;
end;
$$;
revoke all on function public.current_resident_round_qr() from public, anon;
grant execute on function public.current_resident_round_qr() to authenticated;

create or replace function private.record_resident_round_check_in(
  p_session_id uuid,
  p_user_id uuid,
  p_role public.resident_system_role,
  p_checked_in_at timestamptz,
  out o_checked_in_at timestamptz,
  out o_already_checked_in boolean
) language plpgsql security definer set search_path = '' as $$
begin
  insert into public.resident_round_attendance(session_id, user_id, role_at_check_in, checked_in_at)
  values (p_session_id, p_user_id, p_role, p_checked_in_at)
  on conflict (session_id, user_id) do nothing
  returning checked_in_at into o_checked_in_at;
  if found then
    o_already_checked_in := false;
  else
    select a.checked_in_at into o_checked_in_at
    from public.resident_round_attendance a
    where a.session_id = p_session_id and a.user_id = p_user_id;
    o_already_checked_in := true;
  end if;
end;
$$;
revoke all on function private.record_resident_round_check_in(uuid, uuid, public.resident_system_role, timestamptz) from public, anon, authenticated;

create or replace function public.check_in_resident_round(p_token uuid)
returns table(session_id uuid, checked_in_at timestamptz, already_checked_in boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session_id uuid;
  v_checked_at timestamptz;
  v_already boolean;
  v_role public.resident_system_role;
begin
  select r.role into v_role from public.resident_user_roles r
    join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = auth.uid() and r.active and p.active and r.role in ('resident', 'staff');
  if v_role is null then raise exception 'Active Resident or Staff account required'; end if;
  if not private.resident_round_is_open(v_now) then raise exception 'Attendance is closed'; end if;
  select q.session_id into v_session_id
  from public.resident_round_qr_tokens q
  join public.resident_round_sessions s on s.id = q.session_id
  where q.token = p_token
    and private.resident_round_token_is_current(q.minute_start, v_now)
    and s.meeting_date = (v_now at time zone 'Asia/Bangkok')::date
    and s.closed_at is null;
  if v_session_id is null then raise exception 'QR has expired or is invalid. Scan the current QR again'; end if;
  select o_checked_in_at, o_already_checked_in
  into v_checked_at, v_already
  from private.record_resident_round_check_in(v_session_id, auth.uid(), v_role, v_now);
  return query select v_session_id, v_checked_at, v_already;
end;
$$;
revoke all on function public.check_in_resident_round(uuid) from public, anon;
grant execute on function public.check_in_resident_round(uuid) to authenticated;
