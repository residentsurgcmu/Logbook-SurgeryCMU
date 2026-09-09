-- A QR identifies only the Resident account. It never contains assessment or
-- patient data, and resolution is limited to an authenticated active Staff.
alter table public.resident_profiles
  add column if not exists qr_token uuid not null default gen_random_uuid();

create unique index if not exists resident_profiles_qr_token_idx
  on public.resident_profiles(qr_token);

create or replace function public.resolve_resident_assessment_qr(p_qr_token uuid)
returns table (user_id uuid, full_name text, pgy smallint, pending_count bigint)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not exists (
    select 1 from public.resident_user_roles role
    where role.user_id = (select auth.uid())
      and role.active
      and role.role = 'staff'
  ) then
    raise exception 'Active Staff account required';
  end if;

  return query
  select profile.user_id,
         profile.full_name,
         profile.pgy,
         count(request.id) filter (where request.status = 'pending')::bigint
  from public.resident_profiles profile
  join public.resident_user_roles role
    on role.user_id = profile.user_id
   and role.active
   and role.role = 'resident'
  left join public.resident_assessment_requests request
    on request.resident_id = profile.user_id
   and request.staff_id = (select auth.uid())
  where profile.active and profile.qr_token = p_qr_token
  group by profile.user_id, profile.full_name, profile.pgy;
end;
$$;

revoke all on function public.resolve_resident_assessment_qr(uuid) from public, anon;
grant execute on function public.resolve_resident_assessment_qr(uuid) to authenticated;
