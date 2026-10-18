-- RC-02a-1 ROLLBACK (manual; run ONLY if the owner decides to undo migration 20261018090000).
-- Restores the 8 replaced functions to their exact previous text, the previous policies and the
-- previous table privileges, and removes the new functions. Run in the SQL Editor as one transaction.
-- The audit table resident_account_events is KEPT (it holds the record of what Admins did); drop it
-- separately only if the owner asks.
-- The pause switch is KEPT and stays ON: after the checks, run rc02a1_pause_off.sql (and, optionally,
-- rc02a1_pause_remove.sql). Account changes made while the new version was live are NOT undone.
-- After a rollback, deploy the previous Edge Function versions (git show ad896f1:supabase/functions/...).
begin;
set local lock_timeout = '15s';
do $$ begin
  if to_regprocedure('public.resident_accounts_paused()') is null or not (select public.resident_accounts_paused()) then
    raise exception 'Pause account writes first (rc02a1_pause_on.sql), then run this rollback';
  end if;
end $$;

-- 0. v3: the old Edge Function (restored before this file) writes the account tables directly as
--    service_role, so the permanent direct-write guard is switched off here. The pause stays ON.
update public.resident_maintenance_pause set block_client_direct_writes = false, changed_at = now() where scope = 'accounts';

-- 1. new functions
drop function if exists public.admin_list_accounts();
drop function if exists public.admin_preview_account_action(uuid, text);
drop function if exists public.admin_update_account(uuid, timestamptz, uuid, jsonb, text);
drop function if exists public.admin_set_account_active(uuid, boolean, timestamptz, uuid, text, jsonb);
drop function if exists public.admin_list_account_events(uuid);
drop function if exists public.admin_provision_account_internal(uuid, uuid, text, text, text, smallint, text);

-- 2. the 8 replaced functions, previous text (identical to the repo before 20261018090000)

-- private.resident_role_is
CREATE OR REPLACE FUNCTION private.resident_role_is(expected_role resident_system_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select exists (
    select 1 from public.resident_user_roles
    where user_id = (select auth.uid()) and role = expected_role and active
  );
$function$;

-- private.resident_can_evaluate
CREATE OR REPLACE FUNCTION private.resident_can_evaluate(target_resident uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select (select private.resident_role_is('admin')) or exists (
    select 1 from public.resident_evaluator_assignments
    where evaluator_id = (select auth.uid()) and resident_id = target_resident and active
  );
$function$;

-- public.submit_resident_assessment_request
CREATE OR REPLACE FUNCTION public.submit_resident_assessment_request(p_template_id uuid, p_staff_id uuid, p_assessment_date date, p_clinical_context text, p_procedure_or_activity text, p_self_outcome text, p_self_comment text, p_self_scores jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_template public.resident_template_definitions%rowtype;
  v_request_id uuid;
  v_attempt integer;
  v_previous_staff text;
  v_resident_name text;
  v_criterion public.resident_template_criteria%rowtype;
  v_score jsonb;
  v_today date := (clock_timestamp() at time zone 'Asia/Bangkok')::date;
  v_ay_start date;
  v_ay_start_at timestamptz;
  v_ay_end_at timestamptz;
  v_requests integer;
  v_max_request integer;
  v_hist integer;
  v_used integer;
  v_cap integer;
  v_year_used integer;
  v_unavailable_until date;
begin
  if not (select private.resident_role_is('resident')) then raise exception 'Active Resident role required'; end if;
  if p_assessment_date is null or p_assessment_date > (clock_timestamp() at time zone 'Asia/Bangkok')::date then raise exception 'Assessment date is invalid'; end if;
  if char_length(btrim(coalesce(p_procedure_or_activity, ''))) not between 1 and 240 then raise exception 'Activity is required'; end if;
  if char_length(coalesce(p_clinical_context, '')) > 500 then raise exception 'Clinical context is too long'; end if;
  if not exists (
    select 1 from public.resident_staff_directory directory
    join public.resident_user_roles role on role.user_id = directory.auth_user_id
    join public.resident_profiles profile on profile.user_id = role.user_id
    where directory.auth_user_id = p_staff_id and directory.active
      and role.active and role.role = 'staff' and profile.active
  ) then raise exception 'Selected Staff must match an active registered Staff account'; end if;
  select * into v_template from public.resident_template_definitions
    where id = p_template_id and active;
  if not found then raise exception 'Assessment template is unavailable'; end if;
  select full_name into v_resident_name from public.resident_profiles
    where user_id = (select auth.uid()) and active;
  if v_resident_name is null then raise exception 'Resident profile is unavailable'; end if;

  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text || p_template_id::text, 0));
  if exists (select 1 from public.resident_assessment_requests
             where resident_id = (select auth.uid()) and template_id = p_template_id and status = 'pending')
  then raise exception 'This assessment already has a pending request'; end if;
  -- A Staff member may declare a period in which they are not accepting assessments.
  select availability.unavailable_until into v_unavailable_until
  from public.resident_staff_availability availability
  where availability.staff_id = p_staff_id and availability.unavailable_until >= v_today;
  if v_unavailable_until is not null
  then raise exception 'Selected Staff is not accepting assessments until %', v_unavailable_until; end if;

  -- Attempts already used = non-cancelled requests + assessments an Admin recorded directly (historical).
  select count(*), coalesce(max(attempt_number), 0) into v_requests, v_max_request
  from public.resident_assessment_requests
  where resident_id = (select auth.uid()) and template_id = p_template_id and status <> 'cancelled';
  select count(*) into v_hist from public.resident_assessments assessment
  where assessment.resident_id = (select auth.uid()) and assessment.template_id = p_template_id
    and not exists (select 1 from public.resident_assessment_requests linked where linked.assessment_id = assessment.id);
  v_used := v_requests + v_hist;
  -- The number shown to the Resident is the true count + 1, even if an Admin recorded a historical assessment later.
  v_attempt := greatest(v_max_request, v_used) + 1;

  -- Lifetime limit (an Admin may grant extra attempts to one Resident for one form).
  if v_template.max_attempts is not null then
    v_cap := v_template.max_attempts + (select count(*) from public.resident_attempt_grants grants
      where grants.resident_id = (select auth.uid()) and grants.template_id = p_template_id);
    if v_used + 1 > v_cap then raise exception 'Assessment attempt limit reached'; end if;
  end if;

  -- PBA topics are never repeated.
  if v_template.template_type = 'PBA' and v_used > 0
  then raise exception 'This PBA topic was already requested'; end if;

  -- Per academic year limit (the academic year starts on 1 July, Bangkok time, counted from the request time).
  if v_template.max_attempts_per_year is not null then
    v_ay_start := private.resident_academic_year_start(clock_timestamp());
    v_ay_start_at := v_ay_start::timestamp at time zone 'Asia/Bangkok';
    v_ay_end_at := (v_ay_start + interval '1 year')::timestamp at time zone 'Asia/Bangkok';
    select (select count(*) from public.resident_assessment_requests request
              where request.resident_id = (select auth.uid()) and request.template_id = p_template_id
                and request.status <> 'cancelled'
                and request.submitted_at >= v_ay_start_at and request.submitted_at < v_ay_end_at)
         + (select count(*) from public.resident_assessments assessment
              where assessment.resident_id = (select auth.uid()) and assessment.template_id = p_template_id
                and assessment.assessment_date >= v_ay_start and assessment.assessment_date < (v_ay_start + interval '1 year')::date
                and not exists (select 1 from public.resident_assessment_requests linked where linked.assessment_id = assessment.id))
    into v_year_used;
    if v_year_used >= v_template.max_attempts_per_year
    then raise exception 'Assessment already requested this academic year'; end if;
  end if;

  select profile.full_name into v_previous_staff
  from public.resident_assessments previous
  join public.resident_profiles profile on profile.user_id = previous.evaluator_id
  where previous.resident_id = (select auth.uid()) and previous.template_id = p_template_id
  order by previous.assessment_date desc, previous.created_at desc limit 1;

  if v_template.requires_self_assessment then
    if jsonb_typeof(p_self_scores) <> 'array' or
       jsonb_array_length(p_self_scores) <> (select count(*) from public.resident_template_criteria
                                                where template_id = p_template_id and active)
    then raise exception 'Every self-assessment criterion requires one score'; end if;
    if not (v_template.outcome_options ? coalesce(p_self_outcome, ''))
    then raise exception 'A valid self-assessment outcome is required'; end if;
  elsif p_self_scores is not null and p_self_scores <> '[]'::jsonb then
    raise exception 'This form does not have Resident self-assessment';
  end if;

  insert into public.resident_assessment_requests (
    template_id, resident_id, staff_id, assessment_date, clinical_context,
    procedure_or_activity, attempt_number, previous_staff_name,
    self_overall_outcome, self_comment, self_submitted_at
  ) values (
    p_template_id, (select auth.uid()), p_staff_id, p_assessment_date,
    coalesce(p_clinical_context, ''), btrim(p_procedure_or_activity), v_attempt,
    v_previous_staff, case when v_template.requires_self_assessment then p_self_outcome else null end,
    case when v_template.requires_self_assessment then coalesce(p_self_comment, '') else '' end,
    case when v_template.requires_self_assessment then now() else null end
  ) returning id into v_request_id;

  if v_template.requires_self_assessment then
    for v_criterion in select * from public.resident_template_criteria
      where template_id = p_template_id and active order by sort_order
    loop
      select value into v_score from jsonb_array_elements(p_self_scores)
        where value->>'criterionId' = v_criterion.id::text;
      if v_score is null or not (v_template.score_options ? coalesce(v_score->>'score', ''))
      then raise exception 'Missing or invalid self-assessment score'; end if;
      insert into public.resident_self_assessment_scores (request_id, criterion_id, score, comment)
      values (v_request_id, v_criterion.id, v_score->>'score', coalesce(v_score->>'comment', ''));
    end loop;
  end if;

  insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message)
  values (p_staff_id, v_request_id, 'assessment_requested', 'มีคำขอประเมินใหม่',
          v_resident_name || ' ส่ง ' || v_template.template_code || ' ให้ประเมิน');
  return v_request_id;
end;
$function$;

-- public.complete_resident_assessment_request
CREATE OR REPLACE FUNCTION public.complete_resident_assessment_request(p_request_id uuid, p_overall_outcome text, p_overall_comment text, p_scores jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_request public.resident_assessment_requests%rowtype;
  v_template public.resident_template_definitions%rowtype;
  v_assessment_id uuid;
  v_criterion public.resident_template_criteria%rowtype;
  v_score jsonb;
begin
  select * into v_request from public.resident_assessment_requests where id = p_request_id for update;
  if not found then raise exception 'Assessment request was not found'; end if;
  if v_request.staff_id <> (select auth.uid()) or not (select private.resident_role_is('staff'))
  then raise exception 'Only the selected active Staff may assess this request'; end if;
  if v_request.status <> 'pending' then raise exception 'Assessment request is no longer pending'; end if;
  select * into v_template from public.resident_template_definitions
    where id = v_request.template_id and active;
  if not found then raise exception 'Assessment template is unavailable'; end if;
  if v_template.requires_self_assessment and (
    v_request.self_submitted_at is null or
    (select count(*) from public.resident_self_assessment_scores where request_id = p_request_id) <>
    (select count(*) from public.resident_template_criteria where template_id = v_request.template_id and active)
  ) then raise exception 'Resident self-assessment must be complete first'; end if;
  if not (v_template.outcome_options ? coalesce(p_overall_outcome, ''))
  then raise exception 'A valid overall outcome is required'; end if;
  if jsonb_typeof(p_scores) <> 'array' or
     jsonb_array_length(p_scores) <> (select count(*) from public.resident_template_criteria
                                      where template_id = v_request.template_id and active)
  then raise exception 'Every criterion requires one Staff score'; end if;

  insert into public.resident_assessments (
    template_id, resident_id, evaluator_id, resident_pgy, assessment_date,
    clinical_context, procedure_or_activity, overall_outcome, overall_comment
  ) select v_request.template_id, v_request.resident_id, v_request.staff_id,
           profile.pgy, v_request.assessment_date, v_request.clinical_context,
           v_request.procedure_or_activity, p_overall_outcome, coalesce(p_overall_comment, '')
    from public.resident_profiles profile where profile.user_id = v_request.resident_id and profile.active
    returning id into v_assessment_id;
  if v_assessment_id is null then raise exception 'Resident profile is unavailable'; end if;
  for v_criterion in select * from public.resident_template_criteria
    where template_id = v_request.template_id and active order by sort_order
  loop
    select value into v_score from jsonb_array_elements(p_scores)
      where value->>'criterionId' = v_criterion.id::text;
    if v_score is null or not (v_template.score_options ? coalesce(v_score->>'score', ''))
    then raise exception 'Missing or invalid Staff score'; end if;
    insert into public.resident_assessment_scores (assessment_id, criterion_id, score, comment)
    values (v_assessment_id, v_criterion.id, v_score->>'score', coalesce(v_score->>'comment', ''));
  end loop;
  update public.resident_assessment_requests
    set status = 'completed', assessment_id = v_assessment_id, assessed_at = now()
    where id = p_request_id;
  insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message)
  values (v_request.resident_id, p_request_id, 'assessment_completed', 'Staff ประเมินเรียบร้อยแล้ว',
          v_template.template_code || ' ได้รับการประเมินและบันทึกผลแล้ว');
  return v_assessment_id;
end;
$function$;

-- public.cancel_resident_assessment_request
CREATE OR REPLACE FUNCTION public.cancel_resident_assessment_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.resident_assessment_requests%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select * into v_request
  from public.resident_assessment_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Assessment request was not found';
  end if;
  if v_request.resident_id <> (select auth.uid())
     and not (select private.resident_role_is('admin')) then
    raise exception 'Only the Resident who sent this request or an Admin can cancel it';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a pending request can be cancelled';
  end if;

  update public.resident_assessment_requests
  set status = 'cancelled'
  where id = p_request_id;

  -- Staff must not be asked to open a request that no longer exists.
  delete from public.resident_notifications
  where request_id = p_request_id
    and notification_type in ('assessment_requested', 'assessment_reminder');
end;
$function$;

-- public.list_registered_resident_staff
CREATE OR REPLACE FUNCTION public.list_registered_resident_staff()
 RETURNS TABLE(user_id uuid, full_name text, unit_name text, unavailable_until date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare v_today date := (clock_timestamp() at time zone 'Asia/Bangkok')::date;
begin
  if not exists (
    select 1 from public.resident_user_roles
    where resident_user_roles.user_id = (select auth.uid()) and active
  ) then raise exception 'Active Resident Surgery account required'; end if;

  return query
  select directory.auth_user_id, directory.full_name, directory.unit_name,
         case when availability.unavailable_until >= v_today then availability.unavailable_until end
  from public.resident_staff_directory directory
  join public.resident_user_roles role on role.user_id = directory.auth_user_id
  join public.resident_profiles profile on profile.user_id = directory.auth_user_id
  left join public.resident_staff_availability availability on availability.staff_id = directory.auth_user_id
  where directory.active and role.active and role.role = 'staff' and profile.active
  order by directory.unit_name, directory.full_name;
end;
$function$;

-- public.list_resident_counterpart_staff
CREATE OR REPLACE FUNCTION public.list_resident_counterpart_staff()
 RETURNS TABLE(user_id uuid, full_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- public.resolve_resident_assessment_qr
CREATE OR REPLACE FUNCTION public.resolve_resident_assessment_qr(p_qr_token uuid)
 RETURNS TABLE(user_id uuid, full_name text, pgy smallint, pending_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
$function$;


-- 3. previous policies
drop policy if exists resident_notifications_recipient_update on public.resident_notifications;
create policy resident_notifications_recipient_update on public.resident_notifications
  for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
drop policy if exists resident_requests_party_select on public.resident_assessment_requests;
create policy resident_requests_party_select on public.resident_assessment_requests
  for select to authenticated
  using (resident_id = (select auth.uid()) or staff_id = (select auth.uid()) or (select private.resident_role_is('admin')));
drop policy if exists resident_assessments_select on public.resident_assessments;
create policy resident_assessments_select on public.resident_assessments
  for select to authenticated
  using (resident_id = (select auth.uid()) or evaluator_id = (select auth.uid()) or (select private.resident_role_is('admin')));
drop policy if exists resident_scores_select on public.resident_assessment_scores;
create policy resident_scores_select on public.resident_assessment_scores
  for select to authenticated
  using (exists (select 1 from public.resident_assessments
    where resident_assessments.id = resident_assessment_scores.assessment_id
      and (resident_assessments.resident_id = (select auth.uid()) or resident_assessments.evaluator_id = (select auth.uid())
           or (select private.resident_role_is('admin')))));
drop policy if exists resident_self_scores_party_select on public.resident_self_assessment_scores;
create policy resident_self_scores_party_select on public.resident_self_assessment_scores
  for select to authenticated
  using (exists (select 1 from public.resident_assessment_requests request
    where request.id = resident_self_assessment_scores.request_id
      and (request.resident_id = (select auth.uid()) or request.staff_id = (select auth.uid()) or (select private.resident_role_is('admin')))));
drop policy if exists resident_assignments_select on public.resident_evaluator_assignments;
create policy resident_assignments_select on public.resident_evaluator_assignments
  for select to authenticated
  using (evaluator_id = (select auth.uid()) or resident_id = (select auth.uid()) or (select private.resident_role_is('admin')));
drop policy if exists resident_profiles_assessment_party_select on public.resident_profiles;
create policy resident_profiles_assessment_party_select on public.resident_profiles
  for select to authenticated
  using (exists (select 1 from public.resident_assessments assessment
    where assessment.evaluator_id = (select auth.uid()) and assessment.resident_id = resident_profiles.user_id));
drop policy if exists resident_profiles_request_party_select on public.resident_profiles;
create policy resident_profiles_request_party_select on public.resident_profiles
  for select to authenticated
  using (exists (select 1 from public.resident_assessment_requests request
    where request.staff_id = (select auth.uid()) and request.resident_id = resident_profiles.user_id));
create policy resident_profiles_admin_write on public.resident_profiles
  for all to authenticated using ((select private.resident_role_is('admin'))) with check ((select private.resident_role_is('admin')));
create policy resident_roles_admin_write on public.resident_user_roles
  for all to authenticated using ((select private.resident_role_is('admin'))) with check ((select private.resident_role_is('admin')));

-- 4. previous table privileges (as found on production 2026-10-17)
grant all on table public.resident_profiles to anon, authenticated;
grant all on table public.resident_user_roles to anon, authenticated;

-- 5. new helpers (after the functions that used them are gone)
drop function if exists private.resident_account_active_admins();
drop function if exists private.resident_account_active_assignments(uuid);
drop function if exists private.resident_account_pending_requests(uuid);
drop function if exists private.resident_account_reason(text, boolean);
drop function if exists private.resident_account_replay(uuid, uuid, text[]);
drop function if exists private.resident_account_lock(uuid, uuid);
drop function if exists private.resident_account_is_active_admin(uuid);
drop function if exists private.resident_account_active();

commit;
