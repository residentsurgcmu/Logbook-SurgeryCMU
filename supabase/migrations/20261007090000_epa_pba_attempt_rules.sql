-- EPA/PBA attempt rules (decided with the department lead on 6-7 Oct 2569)
--   * EPA: at most 1 request per form per academic year (1 July, Bangkok time); lifetime limit 3 for EPA 1-6
--     (EPA 7 forms stay at 1); PBA topics are never repeated; EPA 8 is unchanged (unlimited).
--   * A Staff member can declare "not accepting assessments until <date>".
--   * Assessments an Admin recorded directly (historical) count toward the limits.
--   * An Admin can grant one extra attempt (with a reason) to one Resident for one form.
--   * get_my_epa_progress(): per EPA form, attempts used, the limit, and whether an assessment reached the level
--     (every criterion of that assessment at L4/L5, or M/E for the F/M/E forms).
-- Additive: new columns/tables/functions plus a replaced function; existing rows are not changed except the
-- two limit columns of the EPA forms. Safe to run again.

alter table public.resident_template_definitions
  add column if not exists max_attempts_per_year smallint
  check (max_attempts_per_year is null or max_attempts_per_year > 0);

update public.resident_template_definitions
  set max_attempts = 3, max_attempts_per_year = 1
  where template_code in ('EPA-1','EPA-2','EPA-3','EPA-4','EPA-5','EPA-6');
update public.resident_template_definitions
  set max_attempts_per_year = 1
  where template_code in ('EPA-7-L1-L2','EPA-7-L3');

create or replace function private.resident_academic_year_start(p_at timestamptz default clock_timestamp())
returns date language sql stable set search_path = pg_catalog as $$
  select make_date(
    extract(year from (p_at at time zone 'Asia/Bangkok'))::integer
      - case when extract(month from (p_at at time zone 'Asia/Bangkok')) < 7 then 1 else 0 end,
    7, 1)
$$;
revoke all on function private.resident_academic_year_start(timestamptz) from public, anon;
grant execute on function private.resident_academic_year_start(timestamptz) to authenticated;

-- Staff availability (read only through the functions below)
create table if not exists public.resident_staff_availability (
  staff_id uuid primary key references auth.users(id) on delete cascade,
  unavailable_until date not null,
  updated_at timestamptz not null default now()
);
alter table public.resident_staff_availability enable row level security;
revoke all on public.resident_staff_availability from public, anon, authenticated;

-- Extra attempts granted by an Admin (read only through the functions)
create table if not exists public.resident_attempt_grants (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid not null references public.resident_template_definitions(id) on delete cascade,
  granted_by uuid not null references auth.users(id),
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  created_at timestamptz not null default now()
);
create index if not exists resident_attempt_grants_lookup on public.resident_attempt_grants(resident_id, template_id);
alter table public.resident_attempt_grants enable row level security;
revoke all on public.resident_attempt_grants from public, anon, authenticated;

create or replace function public.set_my_resident_staff_availability(p_unavailable_until date)
returns date language plpgsql security definer set search_path = public, private, auth as $$
declare v_today date := (clock_timestamp() at time zone 'Asia/Bangkok')::date;
begin
  if not (select private.resident_role_is('staff')) then raise exception 'Active Staff role required'; end if;
  if p_unavailable_until is null then
    delete from public.resident_staff_availability where staff_id = (select auth.uid());
    return null;
  end if;
  if p_unavailable_until < v_today then raise exception 'Unavailable-until date is in the past'; end if;
  if p_unavailable_until > v_today + 365 then raise exception 'Unavailable-until date is too far ahead'; end if;
  insert into public.resident_staff_availability (staff_id, unavailable_until)
  values ((select auth.uid()), p_unavailable_until)
  on conflict (staff_id) do update set unavailable_until = excluded.unavailable_until, updated_at = now();
  return p_unavailable_until;
end;
$$;
revoke all on function public.set_my_resident_staff_availability(date) from public, anon;
grant execute on function public.set_my_resident_staff_availability(date) to authenticated;

drop function if exists public.list_registered_resident_staff();
create function public.list_registered_resident_staff()
returns table (user_id uuid, full_name text, unit_name text, unavailable_until date)
language plpgsql stable security definer set search_path = public, private, auth as $$
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
$$;
revoke all on function public.list_registered_resident_staff() from public, anon;
grant execute on function public.list_registered_resident_staff() to authenticated;

-- Who may grant extra attempts is one named capability so it can move from Admin to the course director later
-- without rewriting the function.
create or replace function private.resident_can_grant_extra_attempts()
returns boolean language sql stable security definer set search_path = public, private, auth as $$
  select private.resident_role_is('admin')
$$;
revoke all on function private.resident_can_grant_extra_attempts() from public, anon;
grant execute on function private.resident_can_grant_extra_attempts() to authenticated;

create or replace function public.admin_grant_resident_extra_attempt(p_resident_id uuid, p_template_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public, private, auth as $$
declare v_id uuid;
begin
  if not (select private.resident_can_grant_extra_attempts()) then raise exception 'Active Admin account required'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception 'A reason of 5-500 characters is required'; end if;
  if not exists (select 1 from public.resident_user_roles r join public.resident_profiles p on p.user_id = r.user_id
                 where r.user_id = p_resident_id and r.role = 'resident' and r.active and p.active)
  then raise exception 'Resident is inactive or unavailable'; end if;
  if not exists (select 1 from public.resident_template_definitions where id = p_template_id and active and max_attempts is not null)
  then raise exception 'This form has no attempt limit to extend'; end if;
  insert into public.resident_attempt_grants (resident_id, template_id, granted_by, reason)
  values (p_resident_id, p_template_id, (select auth.uid()), btrim(p_reason)) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.admin_grant_resident_extra_attempt(uuid, uuid, text) from public, anon;
grant execute on function public.admin_grant_resident_extra_attempt(uuid, uuid, text) to authenticated;

create or replace function public.get_my_epa_progress()
returns table (
  template_id uuid, template_code text, title text, counts_for_board boolean,
  attempts_used integer, attempts_cap integer, attempts_this_year integer,
  met boolean, latest_assessment_date date, latest_below jsonb
)
language plpgsql stable security definer set search_path = public, private, auth as $$
declare
  v_me uuid := (select auth.uid());
  v_ay_start date := private.resident_academic_year_start(clock_timestamp());
  v_ay_start_at timestamptz := v_ay_start::timestamp at time zone 'Asia/Bangkok';
  v_ay_end_at timestamptz := (v_ay_start + interval '1 year')::timestamp at time zone 'Asia/Bangkok';
begin
  if not (select private.resident_role_is('resident')) then raise exception 'Active Resident role required'; end if;
  return query
  with tpl as (
    select t.id, t.template_code, t.title, t.max_attempts, t.score_options,
           case when t.score_options ? 'L5' then 4 else 2 end as need_rank
    from public.resident_template_definitions t
    where t.active and t.template_type = 'EPA'
  ),
  graded as (
    select a.id as assessment_id, a.template_id, a.assessment_date, a.created_at,
           min(rank.ord) as min_rank
    from public.resident_assessments a
    join tpl on tpl.id = a.template_id
    join public.resident_assessment_scores s on s.assessment_id = a.id
    cross join lateral (
      select o.ord from jsonb_array_elements_text(tpl.score_options) with ordinality as o(val, ord)
      where o.val = s.score
    ) rank
    where a.resident_id = v_me
    group by a.id, a.template_id, a.assessment_date, a.created_at
  ),
  latest as (
    select distinct on (g.template_id) g.assessment_id, g.template_id, g.assessment_date
    from graded g order by g.template_id, g.assessment_date desc, g.created_at desc
  )
  select tpl.id, tpl.template_code, tpl.title, (tpl.template_code <> 'EPA-8'),
         ((select count(*) from public.resident_assessment_requests r
             where r.resident_id = v_me and r.template_id = tpl.id and r.status <> 'cancelled')
          + (select count(*) from public.resident_assessments a
               where a.resident_id = v_me and a.template_id = tpl.id
                 and not exists (select 1 from public.resident_assessment_requests l where l.assessment_id = a.id)))::integer,
         case when tpl.max_attempts is null then null
              else (tpl.max_attempts + (select count(*) from public.resident_attempt_grants g
                                         where g.resident_id = v_me and g.template_id = tpl.id))::integer end,
         ((select count(*) from public.resident_assessment_requests r
             where r.resident_id = v_me and r.template_id = tpl.id and r.status <> 'cancelled'
               and r.submitted_at >= v_ay_start_at and r.submitted_at < v_ay_end_at)
          + (select count(*) from public.resident_assessments a
               where a.resident_id = v_me and a.template_id = tpl.id
                 and a.assessment_date >= v_ay_start and a.assessment_date < (v_ay_start + interval '1 year')::date
                 and not exists (select 1 from public.resident_assessment_requests l where l.assessment_id = a.id)))::integer,
         exists (select 1 from graded g where g.template_id = tpl.id and g.min_rank >= tpl.need_rank),
         latest.assessment_date,
         case when latest.assessment_id is null then null else coalesce((
           select jsonb_agg(jsonb_build_object('criterion', c.criterion_text, 'score', s.score) order by c.sort_order)
           from public.resident_assessment_scores s
           join public.resident_template_criteria c on c.id = s.criterion_id
           where s.assessment_id = latest.assessment_id
             and (select o.ord from jsonb_array_elements_text(tpl.score_options) with ordinality as o(val, ord) where o.val = s.score) < tpl.need_rank
         ), '[]'::jsonb) end
  from tpl
  left join latest on latest.template_id = tpl.id
  order by tpl.template_code;
end;
$$;
revoke all on function public.get_my_epa_progress() from public, anon;
grant execute on function public.get_my_epa_progress() to authenticated;

create or replace function public.submit_resident_assessment_request(p_template_id uuid, p_staff_id uuid, p_assessment_date date, p_clinical_context text, p_procedure_or_activity text, p_self_outcome text, p_self_comment text, p_self_scores jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $fn$
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
$fn$;

revoke all on function public.submit_resident_assessment_request(uuid, uuid, date, text, text, text, text, jsonb) from public, anon;
grant execute on function public.submit_resident_assessment_request(uuid, uuid, date, text, text, text, text, jsonb) to authenticated;
