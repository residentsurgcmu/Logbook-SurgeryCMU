-- Staff named as evaluator on an assessment (including historical records an
-- Admin entered without an evaluator assignment or request) could not read
-- that Resident's profile, so their history showed "—" instead of the name
-- and the Resident was missing from their filters. Let both parties of an
-- existing assessment read each other's profile, mirroring
-- resident_profiles_request_party_select.
drop policy if exists resident_profiles_assessment_party_select on public.resident_profiles;
create policy resident_profiles_assessment_party_select
  on public.resident_profiles for select to authenticated
  using (
    exists (
      select 1 from public.resident_assessments assessment
      where (assessment.evaluator_id = (select auth.uid()) and assessment.resident_id = user_id)
         or (assessment.resident_id = (select auth.uid()) and assessment.evaluator_id = user_id)
    )
  );

create index if not exists resident_assessments_party_idx
  on public.resident_assessments(evaluator_id, resident_id);
