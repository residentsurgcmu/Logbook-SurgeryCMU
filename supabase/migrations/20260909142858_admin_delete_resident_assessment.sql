begin;

-- The browser cannot execute this RPC. The resident-admin Edge Function calls
-- it with the service role only after verifying the caller's JWT, active Admin
-- role, and current password. Keeping the related deletes in one function makes
-- the operation atomic: an error restores the request and its audit rows.
create or replace function public.admin_delete_resident_assessment(
  p_assessment_id uuid,
  p_resident_id uuid
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if p_assessment_id is null or p_resident_id is null then
    raise exception 'Assessment and Resident are required';
  end if;

  -- A completed request points at the signed assessment. Deleting the request
  -- first also removes its notifications and email-delivery rows by cascade.
  delete from public.resident_assessment_requests
  where assessment_id = p_assessment_id
    and resident_id = p_resident_id;

  -- Scores are removed by resident_assessment_scores.assessment_id ON DELETE CASCADE.
  delete from public.resident_assessments
  where id = p_assessment_id
    and resident_id = p_resident_id;
  get diagnostics deleted_count = row_count;

  if deleted_count <> 1 then
    raise exception 'Assessment was not found for the selected Resident';
  end if;

  return deleted_count;
end;
$$;

revoke all on function public.admin_delete_resident_assessment(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_resident_assessment(uuid, uuid)
  to service_role;

commit;
