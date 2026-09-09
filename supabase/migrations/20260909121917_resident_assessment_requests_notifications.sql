begin;

-- Resident-initiated assessment requests. Completed assessments remain in the
-- existing resident_assessments table so all historical reports stay intact.
create table public.resident_assessment_requests (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.resident_template_definitions(id),
  resident_id uuid not null references public.resident_profiles(user_id),
  staff_id uuid not null references public.resident_profiles(user_id),
  assessment_date date not null check (assessment_date <= current_date),
  clinical_context text not null default '' check (char_length(clinical_context) <= 500),
  procedure_or_activity text not null check (char_length(btrim(procedure_or_activity)) between 1 and 240),
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  submitted_at timestamptz not null default now(),
  assessed_at timestamptz,
  assessment_id uuid unique references public.resident_assessments(id),
  created_at timestamptz not null default now(),
  check (
    (status = 'completed' and assessed_at is not null and assessment_id is not null)
    or (status <> 'completed' and assessed_at is null and assessment_id is null)
  )
);

create table public.resident_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.resident_profiles(user_id) on delete cascade,
  request_id uuid not null references public.resident_assessment_requests(id) on delete cascade,
  notification_type text not null check (notification_type in ('assessment_requested', 'assessment_reminder', 'assessment_completed')),
  title text not null check (char_length(title) between 1 and 160),
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (request_id, recipient_id, notification_type)
);

create table public.resident_assessment_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.resident_assessment_requests(id) on delete cascade,
  delivery_type text not null check (delivery_type in ('initial', 'reminder')),
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  provider_message_id text,
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  error_message text check (char_length(error_message) <= 1000),
  unique (request_id, delivery_type)
);

create index resident_assessment_requests_staff_pending_idx
  on public.resident_assessment_requests(staff_id, submitted_at)
  where status = 'pending';
create index resident_assessment_requests_resident_idx
  on public.resident_assessment_requests(resident_id, submitted_at desc);
create index resident_notifications_recipient_idx
  on public.resident_notifications(recipient_id, read_at, created_at desc);

alter table public.resident_assessment_requests enable row level security;
alter table public.resident_notifications enable row level security;
alter table public.resident_assessment_email_deliveries enable row level security;

revoke all on table public.resident_assessment_requests from anon, authenticated;
revoke all on table public.resident_notifications from anon, authenticated;
revoke all on table public.resident_assessment_email_deliveries from anon, authenticated;
grant select on table public.resident_assessment_requests to authenticated;
grant select, update (read_at) on table public.resident_notifications to authenticated;

create policy resident_requests_party_select
  on public.resident_assessment_requests for select to authenticated
  using (
    resident_id = (select auth.uid())
    or staff_id = (select auth.uid())
    or (select private.resident_role_is('admin'))
  );

create policy resident_notifications_recipient_select
  on public.resident_notifications for select to authenticated
  using (recipient_id = (select auth.uid()) or (select private.resident_role_is('admin')));

create policy resident_notifications_recipient_update
  on public.resident_notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- A Staff member needs the requesting Resident's profile to render the queue;
-- a Resident needs the selected Staff profile to render request history.
create policy resident_profiles_request_party_select
  on public.resident_profiles for select to authenticated
  using (
    exists (
      select 1 from public.resident_assessment_requests request
      where (request.staff_id = (select auth.uid()) and request.resident_id = user_id)
         or (request.resident_id = (select auth.uid()) and request.staff_id = user_id)
    )
  );

-- Return only registered Staff names and units. Email addresses remain hidden
-- from Resident clients and are used only by the server-side email worker.
create or replace function public.list_registered_resident_staff()
returns table (user_id uuid, full_name text, unit_name text)
language plpgsql stable security definer set search_path = public, private, auth as $$
begin
  if not exists (
    select 1 from public.resident_user_roles
    where resident_user_roles.user_id = (select auth.uid()) and active
  ) then raise exception 'Active Resident Surgery account required'; end if;

  return query
  select directory.auth_user_id, directory.full_name, directory.unit_name
  from public.resident_staff_directory directory
  join public.resident_user_roles role on role.user_id = directory.auth_user_id
  join public.resident_profiles profile on profile.user_id = directory.auth_user_id
  where directory.active and role.active and role.role = 'staff' and profile.active
  order by directory.unit_name, directory.full_name;
end;
$$;
revoke all on function public.list_registered_resident_staff() from public, anon;
grant execute on function public.list_registered_resident_staff() to authenticated;

create or replace function public.submit_resident_assessment_request(
  p_template_id uuid,
  p_staff_id uuid,
  p_assessment_date date,
  p_clinical_context text,
  p_procedure_or_activity text
) returns uuid language plpgsql security definer set search_path = public, private, auth as $$
declare
  request_id uuid;
  resident_name text;
  template_code text;
begin
  if not (select private.resident_role_is('resident')) then
    raise exception 'Only an active Resident may submit an assessment request';
  end if;
  if p_assessment_date > current_date then raise exception 'Assessment date cannot be in the future'; end if;
  if nullif(btrim(coalesce(p_procedure_or_activity, '')), '') is null then
    raise exception 'Procedure or activity name is required';
  end if;
  if not exists (
    select 1
    from public.resident_staff_directory directory
    join public.resident_user_roles role on role.user_id = directory.auth_user_id
    join public.resident_profiles profile on profile.user_id = directory.auth_user_id
    where directory.auth_user_id = p_staff_id and directory.active
      and role.active and role.role = 'staff' and profile.active
  ) then raise exception 'Selected Staff must match an active registered Staff account'; end if;

  select definition.template_code into template_code
  from public.resident_template_definitions definition
  where definition.id = p_template_id and definition.active;
  if template_code is null then raise exception 'Assessment template is unavailable'; end if;

  select full_name into resident_name from public.resident_profiles
  where user_id = (select auth.uid()) and active;

  insert into public.resident_assessment_requests (
    template_id, resident_id, staff_id, assessment_date, clinical_context, procedure_or_activity
  ) values (
    p_template_id, (select auth.uid()), p_staff_id, p_assessment_date,
    coalesce(p_clinical_context, ''), btrim(p_procedure_or_activity)
  ) returning id into request_id;

  insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message)
  values (
    p_staff_id,
    request_id,
    'assessment_requested',
    'มีแบบประเมิน EPA/PBA ใหม่',
    coalesce(resident_name, 'Resident') || ' ส่ง ' || template_code || ' ให้ท่านประเมิน'
  );

  return request_id;
end;
$$;
revoke all on function public.submit_resident_assessment_request(uuid,uuid,date,text,text) from public, anon;
grant execute on function public.submit_resident_assessment_request(uuid,uuid,date,text,text) to authenticated;

create or replace function public.complete_resident_assessment_request(
  p_request_id uuid,
  p_overall_outcome text,
  p_overall_comment text,
  p_scores jsonb
) returns uuid language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_assessment_id uuid;
  request_row public.resident_assessment_requests%rowtype;
  template_row public.resident_template_definitions%rowtype;
  criterion_row public.resident_template_criteria%rowtype;
  score_row jsonb;
  score_value text;
  scored_criterion_count integer;
begin
  select * into request_row from public.resident_assessment_requests
  where id = p_request_id for update;
  if not found then raise exception 'Assessment request was not found'; end if;
  if request_row.staff_id <> (select auth.uid()) then raise exception 'Only the selected Staff may assess this request'; end if;
  if request_row.status <> 'pending' then raise exception 'Assessment request is no longer pending'; end if;
  if not (select private.resident_role_is('staff')) then raise exception 'Active Staff role required'; end if;

  select * into template_row from public.resident_template_definitions
  where id = request_row.template_id and active;
  if not found then raise exception 'Assessment template is unavailable'; end if;
  if jsonb_typeof(p_scores) <> 'array' then raise exception 'Scores must be an array'; end if;

  select count(*) into scored_criterion_count
  from public.resident_template_criteria criterion
  where criterion.template_id = request_row.template_id and criterion.active
    and not (template_row.template_type = 'EPA' and criterion.criterion_code in ('C1', 'C2', 'C3'));
  if scored_criterion_count <> jsonb_array_length(p_scores) then
    raise exception 'Every assessable criterion must have one score';
  end if;

  insert into public.resident_assessments (
    template_id, resident_id, evaluator_id, resident_pgy, assessment_date,
    clinical_context, procedure_or_activity, overall_outcome, overall_comment
  )
  select request_row.template_id, request_row.resident_id, request_row.staff_id, profile.pgy,
    request_row.assessment_date, request_row.clinical_context, request_row.procedure_or_activity,
    coalesce(p_overall_outcome, ''), coalesce(p_overall_comment, '')
  from public.resident_profiles profile
  where profile.user_id = request_row.resident_id and profile.active
  returning id into v_assessment_id;
  if v_assessment_id is null then raise exception 'Resident is inactive or unavailable'; end if;

  for criterion_row in
    select * from public.resident_template_criteria criterion
    where criterion.template_id = request_row.template_id and criterion.active
      and not (template_row.template_type = 'EPA' and criterion.criterion_code in ('C1', 'C2', 'C3'))
    order by criterion.sort_order
  loop
    select value into score_row from jsonb_array_elements(p_scores)
    where value->>'criterionId' = criterion_row.id::text limit 1;
    if score_row is null then raise exception 'A criterion score is missing'; end if;
    score_value := score_row->>'score';
    if score_value is null or not (template_row.score_options ? score_value) then
      raise exception 'Invalid score option';
    end if;
    insert into public.resident_assessment_scores (assessment_id, criterion_id, score, comment)
    values (v_assessment_id, criterion_row.id, score_value, coalesce(score_row->>'comment', ''));
  end loop;

  update public.resident_assessment_requests
  set status = 'completed', assessment_id = v_assessment_id, assessed_at = now()
  where id = request_row.id;

  insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message)
  values (
    request_row.resident_id,
    request_row.id,
    'assessment_completed',
    'Staff ประเมินเรียบร้อยแล้ว',
    template_row.template_code || ' ได้รับการประเมินและบันทึกผลในระบบแล้ว'
  );

  return v_assessment_id;
end;
$$;
revoke all on function public.complete_resident_assessment_request(uuid,text,text,jsonb) from public, anon;
grant execute on function public.complete_resident_assessment_request(uuid,text,text,jsonb) to authenticated;

-- The email worker uses the service role. Browser clients cannot read or write
-- delivery audit rows, recipient emails, or reminder state.
grant all on table public.resident_assessment_email_deliveries to service_role;
grant all on table public.resident_assessment_requests to service_role;
grant all on table public.resident_notifications to service_role;

commit;
