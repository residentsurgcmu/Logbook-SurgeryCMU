begin;

-- 1) Attendance QR grace period.
--    A token used to be valid only inside its own calendar minute, so a QR
--    scanned at hh:mm:50 (or by someone who had to sign in first) was already
--    "expired" when the phone reached the server. Keep the one-minute rotation
--    but accept a token for 60 seconds after its minute ends. The session's
--    starts_at/ends_at window is still enforced by check_in_resident_round.
create or replace function private.resident_round_token_is_current(p_minute timestamptz, p_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p_at >= p_minute and p_at < p_minute + interval '2 minutes';
$$;
revoke all on function private.resident_round_token_is_current(timestamptz, timestamptz) from public, anon, authenticated;

-- 2) Deleting a signed assessment must not leave a gap in attempt numbers.
--    Before: delete attempt 1 of 2 -> the next request became attempt 3 and hit
--    max_attempts although only one attempt remained. Renumber the Resident's
--    later attempts of the same template (ascending, one row at a time, so the
--    partial unique index on attempt_number is never violated).
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
  v_template_id uuid;
  v_attempt integer;
  v_row record;
begin
  if p_assessment_id is null or p_resident_id is null then
    raise exception 'Assessment and Resident are required';
  end if;

  delete from public.resident_assessment_requests
  where assessment_id = p_assessment_id
    and resident_id = p_resident_id
  returning template_id, attempt_number into v_template_id, v_attempt;

  delete from public.resident_assessments
  where id = p_assessment_id
    and resident_id = p_resident_id;
  get diagnostics deleted_count = row_count;

  if deleted_count <> 1 then
    raise exception 'Assessment was not found for the selected Resident';
  end if;

  if v_attempt is not null then
    for v_row in
      select id from public.resident_assessment_requests
      where resident_id = p_resident_id
        and template_id = v_template_id
        and status <> 'cancelled'
        and attempt_number > v_attempt
      order by attempt_number
    loop
      update public.resident_assessment_requests
      set attempt_number = attempt_number - 1
      where id = v_row.id;
    end loop;
  end if;

  return deleted_count;
end;
$$;
revoke all on function public.admin_delete_resident_assessment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_resident_assessment(uuid, uuid) to service_role;

-- 3) Fix the "Boarderline" typo in EPA outcome options and in stored results.
update public.resident_template_definitions
set outcome_options = (
  select jsonb_agg(case when item.value = 'Boarderline' then 'Borderline' else item.value end order by item.ordinality)
  from jsonb_array_elements_text(outcome_options) with ordinality as item(value, ordinality)
)
where outcome_options ? 'Boarderline';

update public.resident_assessments
set overall_outcome = 'Borderline'
where overall_outcome = 'Boarderline';

update public.resident_assessment_requests
set self_overall_outcome = 'Borderline'
where self_overall_outcome = 'Boarderline';

commit;
