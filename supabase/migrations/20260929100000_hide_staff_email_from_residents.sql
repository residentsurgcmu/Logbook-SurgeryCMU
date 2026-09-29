begin;

-- Staff email addresses must stay hidden from Residents (see
-- list_registered_resident_staff). The two "party" policies were symmetric, so
-- a Resident who had sent one request, or had one assessment, could read the
-- Staff member's whole resident_profiles row including email and qr_token:
--   select email from resident_profiles where user_id = '<staff id>';
-- RLS works per row, not per column, so keep only the Staff -> Resident
-- direction (Staff need the Resident's profile for the queue and history) and
-- give Residents the Staff names through a definer function without emails.

drop policy if exists resident_profiles_request_party_select on public.resident_profiles;
create policy resident_profiles_request_party_select
  on public.resident_profiles for select to authenticated
  using (
    exists (
      select 1 from public.resident_assessment_requests request
      where request.staff_id = (select auth.uid())
        and request.resident_id = user_id
    )
  );

drop policy if exists resident_profiles_assessment_party_select on public.resident_profiles;
create policy resident_profiles_assessment_party_select
  on public.resident_profiles for select to authenticated
  using (
    exists (
      select 1 from public.resident_assessments assessment
      where assessment.evaluator_id = (select auth.uid())
        and assessment.resident_id = user_id
    )
  );

-- Names (no email, no QR token) of every Staff member on the caller's own
-- requests or assessments, including Staff who were later deactivated, so a
-- Resident's history still shows who assessed them.
create or replace function public.list_resident_counterpart_staff()
returns table (user_id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.resident_user_roles role
    where role.user_id = (select auth.uid()) and role.active
  ) then
    raise exception 'Active Resident Surgery account required';
  end if;

  return query
  select profile.user_id, profile.full_name
  from public.resident_profiles profile
  where profile.user_id in (
    select request.staff_id from public.resident_assessment_requests request
    where request.resident_id = (select auth.uid())
    union
    select assessment.evaluator_id from public.resident_assessments assessment
    where assessment.resident_id = (select auth.uid())
  )
  order by profile.full_name, profile.user_id;
end;
$$;
revoke all on function public.list_resident_counterpart_staff() from public, anon;
grant execute on function public.list_resident_counterpart_staff() to authenticated;

commit;
