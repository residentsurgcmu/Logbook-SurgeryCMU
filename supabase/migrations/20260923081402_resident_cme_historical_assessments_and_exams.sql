begin;

-- CME QR is deliberately distinct from the short-lived attendance QR.  An
-- Admin uploads one private image for an already-open meeting session and
-- projects it; this application does not record CME scans.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resident-round-cme-qr',
  'resident-round-cme-qr',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.resident_round_cme_qr (
  session_id uuid primary key references public.resident_round_sessions(id) on delete cascade,
  storage_path text not null unique check (char_length(btrim(storage_path)) between 1 and 500),
  uploaded_by uuid not null references public.resident_profiles(user_id),
  uploaded_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.resident_round_cme_qr enable row level security;
revoke all on public.resident_round_cme_qr from public, anon, authenticated;
grant select on public.resident_round_cme_qr to authenticated;

create policy resident_round_cme_qr_admin_select on public.resident_round_cme_qr
  for select to authenticated using ((select private.resident_role_is('admin')));

drop policy if exists resident_round_cme_qr_admin_read on storage.objects;
create policy resident_round_cme_qr_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'resident-round-cme-qr' and (select private.resident_role_is('admin')));

drop policy if exists resident_round_cme_qr_admin_upload on storage.objects;
create policy resident_round_cme_qr_admin_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resident-round-cme-qr'
    and (select private.resident_role_is('admin'))
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists resident_round_cme_qr_admin_update on storage.objects;
create policy resident_round_cme_qr_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'resident-round-cme-qr' and (select private.resident_role_is('admin')))
  with check (bucket_id = 'resident-round-cme-qr' and (select private.resident_role_is('admin')));

drop policy if exists resident_round_cme_qr_admin_delete on storage.objects;
create policy resident_round_cme_qr_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'resident-round-cme-qr' and (select private.resident_role_is('admin')));

create or replace function public.set_resident_round_cme_qr(
  p_session_id uuid,
  p_storage_path text
) returns text
language plpgsql security definer set search_path = public, private, auth, storage as $$
declare
  v_previous_path text;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if p_session_id is null or nullif(btrim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'Meeting session and CME QR image are required';
  end if;
  if not exists (
    select 1 from public.resident_round_sessions
    where id = p_session_id
      and meeting_date = (clock_timestamp() at time zone 'Asia/Bangkok')::date
  ) then
    raise exception 'Open today''s meeting session before adding a CME QR';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'resident-round-cme-qr' and name = btrim(p_storage_path)
  ) then
    raise exception 'CME QR image upload was not found';
  end if;

  select storage_path into v_previous_path
  from public.resident_round_cme_qr where session_id = p_session_id;

  insert into public.resident_round_cme_qr (session_id, storage_path, uploaded_by, uploaded_at, updated_at)
  values (p_session_id, btrim(p_storage_path), (select auth.uid()), clock_timestamp(), clock_timestamp())
  on conflict (session_id) do update set
    storage_path = excluded.storage_path,
    uploaded_by = excluded.uploaded_by,
    uploaded_at = excluded.uploaded_at,
    updated_at = excluded.updated_at;
  return v_previous_path;
end;
$$;
revoke all on function public.set_resident_round_cme_qr(uuid, text) from public, anon;
grant execute on function public.set_resident_round_cme_qr(uuid, text) to authenticated;

create or replace function public.clear_resident_round_cme_qr(p_session_id uuid)
returns text
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_storage_path text;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  delete from public.resident_round_cme_qr
  where session_id = p_session_id
    and exists (
      select 1 from public.resident_round_sessions
      where id = p_session_id
        and meeting_date = (clock_timestamp() at time zone 'Asia/Bangkok')::date
    )
  returning storage_path into v_storage_path;
  if v_storage_path is null then raise exception 'CME QR for today''s meeting was not found'; end if;
  return v_storage_path;
end;
$$;
revoke all on function public.clear_resident_round_cme_qr(uuid) from public, anon;
grant execute on function public.clear_resident_round_cme_qr(uuid) to authenticated;

-- Preserve who entered a historical EPA/PBA record without rewriting the
-- original Staff evaluator. Existing workflow-created records remain null.
alter table public.resident_assessments
  add column if not exists recorded_by uuid references public.resident_profiles(user_id),
  add column if not exists recorded_at timestamptz;

create or replace function public.admin_record_historical_resident_assessment(
  p_template_id uuid,
  p_resident_id uuid,
  p_evaluator_id uuid,
  p_assessment_date date,
  p_clinical_context text,
  p_procedure_or_activity text,
  p_overall_outcome text,
  p_overall_comment text,
  p_scores jsonb
) returns uuid
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_assessment_id uuid;
  v_template public.resident_template_definitions%rowtype;
  v_criterion public.resident_template_criteria%rowtype;
  v_score jsonb;
  v_pgy smallint;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if p_assessment_date is null or p_assessment_date > current_date then
    raise exception 'Assessment date is invalid';
  end if;
  if char_length(btrim(coalesce(p_procedure_or_activity, ''))) not between 1 and 240 then
    raise exception 'Activity is required';
  end if;
  if char_length(coalesce(p_clinical_context, '')) > 500 or char_length(coalesce(p_overall_comment, '')) > 2000 then
    raise exception 'Assessment text is too long';
  end if;
  if coalesce(jsonb_typeof(p_scores), '') <> 'array' then
    raise exception 'Scores must be an array';
  end if;

  select * into v_template from public.resident_template_definitions
  where id = p_template_id and active;
  if not found then raise exception 'Assessment template is unavailable'; end if;
  if not (v_template.outcome_options ? coalesce(p_overall_outcome, '')) then
    raise exception 'A valid overall outcome is required';
  end if;
  if jsonb_array_length(p_scores) <> (
    select count(*) from public.resident_template_criteria
    where template_id = p_template_id and active
  ) then
    raise exception 'Every active criterion requires one score';
  end if;

  select profile.pgy into v_pgy
  from public.resident_profiles profile
  join public.resident_user_roles role on role.user_id = profile.user_id
  where profile.user_id = p_resident_id and profile.active and role.active and role.role = 'resident';
  if v_pgy is null then raise exception 'Resident is inactive or unavailable'; end if;

  if not exists (
    select 1 from public.resident_staff_directory directory
    join public.resident_user_roles role on role.user_id = directory.auth_user_id
    join public.resident_profiles profile on profile.user_id = role.user_id
    where directory.auth_user_id = p_evaluator_id and directory.active
      and role.active and role.role = 'staff' and profile.active
  ) then
    raise exception 'Selected evaluator must be an active registered Staff account';
  end if;

  insert into public.resident_assessments (
    template_id, resident_id, evaluator_id, resident_pgy, assessment_date,
    clinical_context, procedure_or_activity, overall_outcome, overall_comment,
    signed_at, recorded_by, recorded_at
  ) values (
    p_template_id, p_resident_id, p_evaluator_id, v_pgy, p_assessment_date,
    coalesce(p_clinical_context, ''), btrim(p_procedure_or_activity), p_overall_outcome,
    coalesce(p_overall_comment, ''), clock_timestamp(), (select auth.uid()), clock_timestamp()
  ) returning id into v_assessment_id;

  for v_criterion in
    select * from public.resident_template_criteria
    where template_id = p_template_id and active order by sort_order
  loop
    select value into v_score
    from jsonb_array_elements(p_scores)
    where value->>'criterionId' = v_criterion.id::text
    limit 1;
    if v_score is null or not (v_template.score_options ? coalesce(v_score->>'score', '')) then
      raise exception 'Missing or invalid score for criterion %', v_criterion.criterion_code;
    end if;
    if char_length(coalesce(v_score->>'comment', '')) > 1000 then
      raise exception 'Criterion comment is too long';
    end if;
    insert into public.resident_assessment_scores (assessment_id, criterion_id, score, comment)
    values (v_assessment_id, v_criterion.id, v_score->>'score', coalesce(v_score->>'comment', ''));
  end loop;
  return v_assessment_id;
end;
$$;
revoke all on function public.admin_record_historical_resident_assessment(uuid, uuid, uuid, date, text, text, text, text, jsonb) from public, anon;
grant execute on function public.admin_record_historical_resident_assessment(uuid, uuid, uuid, date, text, text, text, text, jsonb) to authenticated;

-- Examination records are separate from clinical EPA/PBA. A draft is visible
-- only to Admin; publishing is all-or-nothing for the scheduled participants.
create table public.resident_exam_events (
  id uuid primary key default gen_random_uuid(),
  exam_type text not null check (exam_type in ('xray_anatomy', 'mcq')),
  exam_date date not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  max_score numeric(10,2),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid not null references public.resident_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.resident_profiles(user_id),
  updated_at timestamptz not null default clock_timestamp(),
  published_by uuid references public.resident_profiles(user_id),
  published_at timestamptz,
  constraint resident_exam_event_type_score_check check (
    (exam_type = 'mcq' and max_score is not null and max_score > 0)
    or (exam_type = 'xray_anatomy' and max_score is null)
  )
);

create table public.resident_exam_participants (
  event_id uuid not null references public.resident_exam_events(id) on delete cascade,
  resident_id uuid not null references public.resident_profiles(user_id),
  primary key (event_id, resident_id)
);

create table public.resident_exam_parts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.resident_exam_events(id) on delete cascade,
  part_name text not null check (char_length(btrim(part_name)) between 1 and 120),
  sort_order smallint not null check (sort_order > 0),
  unique (event_id, sort_order)
);
create unique index resident_exam_parts_event_name_unique
  on public.resident_exam_parts(event_id, lower(part_name));

create table public.resident_exam_results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.resident_exam_events(id) on delete cascade,
  resident_id uuid not null references public.resident_profiles(user_id),
  part_id uuid references public.resident_exam_parts(id) on delete cascade,
  score numeric(10,2),
  outcome text not null check (outcome in ('pass', 'remediation')),
  updated_by uuid not null references public.resident_profiles(user_id),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index resident_exam_results_xray_unique
  on public.resident_exam_results(event_id, resident_id, part_id)
  where part_id is not null;
create unique index resident_exam_results_mcq_unique
  on public.resident_exam_results(event_id, resident_id)
  where part_id is null;

create index resident_exam_events_status_date_idx on public.resident_exam_events(status, exam_date desc);
create index resident_exam_participants_resident_idx on public.resident_exam_participants(resident_id, event_id);
create index resident_exam_results_resident_idx on public.resident_exam_results(resident_id, event_id);

alter table public.resident_exam_events enable row level security;
alter table public.resident_exam_participants enable row level security;
alter table public.resident_exam_parts enable row level security;
alter table public.resident_exam_results enable row level security;
revoke all on public.resident_exam_events, public.resident_exam_participants,
  public.resident_exam_parts, public.resident_exam_results from public, anon, authenticated;
grant select on public.resident_exam_events, public.resident_exam_participants,
  public.resident_exam_parts, public.resident_exam_results to authenticated;

create policy resident_exam_events_visible on public.resident_exam_events
  for select to authenticated using (
    (select private.resident_role_is('admin'))
    or (
      status = 'published' and (
        (select private.resident_role_is('staff'))
        or exists (
          select 1 from public.resident_exam_participants participant
          where participant.event_id = id and participant.resident_id = (select auth.uid())
        )
      )
    )
  );

create policy resident_exam_participants_visible on public.resident_exam_participants
  for select to authenticated using (
    (select private.resident_role_is('admin'))
    or (
      resident_id = (select auth.uid())
      and exists (select 1 from public.resident_exam_events event where event.id = event_id and event.status = 'published')
    )
    or (
      (select private.resident_role_is('staff'))
      and exists (select 1 from public.resident_exam_events event where event.id = event_id and event.status = 'published')
    )
  );

create policy resident_exam_parts_visible on public.resident_exam_parts
  for select to authenticated using (
    (select private.resident_role_is('admin'))
    or exists (
      select 1 from public.resident_exam_events event
      where event.id = event_id and event.status = 'published'
        and (
          (select private.resident_role_is('staff'))
          or exists (
            select 1 from public.resident_exam_participants participant
            where participant.event_id = event.id and participant.resident_id = (select auth.uid())
          )
        )
    )
  );

create policy resident_exam_results_visible on public.resident_exam_results
  for select to authenticated using (
    (select private.resident_role_is('admin'))
    or (
      exists (
        select 1 from public.resident_exam_events event
        where event.id = event_id and event.status = 'published'
      )
      and (
        (select private.resident_role_is('staff')) or resident_id = (select auth.uid())
      )
    )
  );

create or replace function public.create_resident_exam_event(
  p_exam_type text,
  p_exam_date date,
  p_title text,
  p_max_score numeric,
  p_part_names jsonb,
  p_participant_ids jsonb
) returns uuid
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_event_id uuid;
  v_part_name text;
  v_participant_id uuid;
  v_part_count integer;
  v_participant_count integer;
  v_unique_participant_count integer;
  v_position integer := 0;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if p_exam_type not in ('xray_anatomy', 'mcq') or p_exam_date is null
    or char_length(btrim(coalesce(p_title, ''))) not between 1 and 160 then
    raise exception 'Exam definition is invalid';
  end if;
  if coalesce(jsonb_typeof(p_participant_ids), '') <> 'array'
    or jsonb_array_length(p_participant_ids) = 0 then
    raise exception 'At least one Resident participant is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_participant_ids) item
    where item !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then raise exception 'Resident participant is invalid'; end if;
  select count(*), count(distinct item::uuid)
  into v_participant_count, v_unique_participant_count
  from jsonb_array_elements_text(p_participant_ids) item;
  if v_participant_count <> jsonb_array_length(p_participant_ids)
    or v_unique_participant_count <> v_participant_count then
    raise exception 'Resident participant is duplicated';
  end if;
  if (
    select count(*) from public.resident_profiles profile
    join public.resident_user_roles role on role.user_id = profile.user_id
    where profile.user_id in (select item::uuid from jsonb_array_elements_text(p_participant_ids) item)
      and profile.active and role.active and role.role = 'resident'
  ) <> jsonb_array_length(p_participant_ids) then
    raise exception 'Every participant must be an active Resident';
  end if;

  if p_exam_type = 'mcq' then
    if p_max_score is null or p_max_score <= 0 then raise exception 'MCQ full score must be greater than zero'; end if;
    if coalesce(jsonb_typeof(p_part_names), '') <> 'array' or jsonb_array_length(p_part_names) <> 0 then
      raise exception 'MCQ cannot contain X-ray or Anatomy parts';
    end if;
  else
    if p_max_score is not null then raise exception 'X-ray and Anatomy does not use a full score'; end if;
    if coalesce(jsonb_typeof(p_part_names), '') <> 'array' or jsonb_array_length(p_part_names) = 0 then
      raise exception 'At least one X-ray or Anatomy part is required';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(p_part_names) item
      where char_length(btrim(item)) not between 1 and 120
    ) then raise exception 'X-ray or Anatomy part is invalid'; end if;
    select count(*), count(distinct lower(btrim(item))) into v_part_count, v_unique_participant_count
    from jsonb_array_elements_text(p_part_names) item;
    if v_part_count <> v_unique_participant_count then raise exception 'X-ray or Anatomy part is duplicated'; end if;
  end if;

  insert into public.resident_exam_events (
    exam_type, exam_date, title, max_score, created_by, updated_by
  ) values (
    p_exam_type, p_exam_date, btrim(p_title), p_max_score, (select auth.uid()), (select auth.uid())
  ) returning id into v_event_id;

  for v_participant_id in select item::uuid from jsonb_array_elements_text(p_participant_ids) item loop
    insert into public.resident_exam_participants(event_id, resident_id)
    values (v_event_id, v_participant_id);
  end loop;
  if p_exam_type = 'xray_anatomy' then
    v_position := 0;
    for v_part_name in select btrim(item) from jsonb_array_elements_text(p_part_names) item loop
      v_position := v_position + 1;
      insert into public.resident_exam_parts(event_id, part_name, sort_order)
      values (v_event_id, v_part_name, v_position);
    end loop;
  end if;
  return v_event_id;
end;
$$;
revoke all on function public.create_resident_exam_event(text, date, text, numeric, jsonb, jsonb) from public, anon;
grant execute on function public.create_resident_exam_event(text, date, text, numeric, jsonb, jsonb) to authenticated;

create or replace function public.save_resident_exam_results(
  p_event_id uuid,
  p_results jsonb
) returns void
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_event public.resident_exam_events%rowtype;
  v_result jsonb;
  v_resident_id uuid;
  v_part_id uuid;
  v_score numeric;
  v_key text;
  v_seen_keys text[] := array[]::text[];
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if coalesce(jsonb_typeof(p_results), '') <> 'array' then raise exception 'Results must be an array'; end if;
  select * into v_event from public.resident_exam_events where id = p_event_id for update;
  if not found then raise exception 'Exam was not found'; end if;
  if v_event.status <> 'draft' then raise exception 'Return the exam to Draft before editing results'; end if;

  for v_result in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(v_result) <> 'object'
      or coalesce(v_result->>'residentId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_result->>'outcome', '') not in ('pass', 'remediation') then
      raise exception 'Exam result is invalid';
    end if;
    v_resident_id := (v_result->>'residentId')::uuid;
    if not exists (
      select 1 from public.resident_exam_participants
      where event_id = p_event_id and resident_id = v_resident_id
    ) then raise exception 'Exam result includes a Resident outside this exam'; end if;

    if v_event.exam_type = 'mcq' then
      if v_result->>'partId' is not null
        or coalesce(v_result->>'score', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
        raise exception 'MCQ score is invalid';
      end if;
      v_score := (v_result->>'score')::numeric;
      if v_score < 0 or v_score > v_event.max_score then raise exception 'MCQ score must be between zero and full score'; end if;
      v_part_id := null;
      v_key := v_resident_id::text;
    else
      if coalesce(v_result->>'partId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or v_result->>'score' is not null then
        raise exception 'X-ray or Anatomy result is invalid';
      end if;
      v_part_id := (v_result->>'partId')::uuid;
      if not exists (select 1 from public.resident_exam_parts where id = v_part_id and event_id = p_event_id) then
        raise exception 'X-ray or Anatomy part is invalid';
      end if;
      v_score := null;
      v_key := v_resident_id::text || ':' || v_part_id::text;
    end if;
    if v_key = any(v_seen_keys) then raise exception 'Exam result is duplicated'; end if;
    v_seen_keys := array_append(v_seen_keys, v_key);
  end loop;

  delete from public.resident_exam_results where event_id = p_event_id;
  for v_result in select value from jsonb_array_elements(p_results) loop
    v_resident_id := (v_result->>'residentId')::uuid;
    if v_event.exam_type = 'mcq' then
      v_part_id := null;
      v_score := (v_result->>'score')::numeric;
    else
      v_part_id := (v_result->>'partId')::uuid;
      v_score := null;
    end if;
    insert into public.resident_exam_results(event_id, resident_id, part_id, score, outcome, updated_by, updated_at)
    values (p_event_id, v_resident_id, v_part_id, v_score, v_result->>'outcome', (select auth.uid()), clock_timestamp());
  end loop;
  update public.resident_exam_events
  set updated_by = (select auth.uid()), updated_at = clock_timestamp()
  where id = p_event_id;
end;
$$;
revoke all on function public.save_resident_exam_results(uuid, jsonb) from public, anon;
grant execute on function public.save_resident_exam_results(uuid, jsonb) to authenticated;

create or replace function public.set_resident_exam_publication(
  p_event_id uuid,
  p_publish boolean
) returns void
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_event public.resident_exam_events%rowtype;
  v_expected_count integer;
  v_result_count integer;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  select * into v_event from public.resident_exam_events where id = p_event_id for update;
  if not found then raise exception 'Exam was not found'; end if;
  if p_publish then
    if v_event.status <> 'draft' then raise exception 'Exam is already published'; end if;
    select count(*) into v_expected_count from public.resident_exam_participants where event_id = p_event_id;
    if v_event.exam_type = 'xray_anatomy' then
      v_expected_count := v_expected_count * (select count(*) from public.resident_exam_parts where event_id = p_event_id);
    end if;
    select count(*) into v_result_count from public.resident_exam_results where event_id = p_event_id;
    if v_result_count <> v_expected_count then
      raise exception 'Complete every scheduled Resident result before publishing';
    end if;
    update public.resident_exam_events
    set status = 'published', published_by = (select auth.uid()), published_at = clock_timestamp(),
      updated_by = (select auth.uid()), updated_at = clock_timestamp()
    where id = p_event_id;
  else
    if v_event.status <> 'published' then raise exception 'Exam is already Draft'; end if;
    update public.resident_exam_events
    set status = 'draft', updated_by = (select auth.uid()), updated_at = clock_timestamp()
    where id = p_event_id;
  end if;
end;
$$;
revoke all on function public.set_resident_exam_publication(uuid, boolean) from public, anon;
grant execute on function public.set_resident_exam_publication(uuid, boolean) to authenticated;

create or replace function public.list_resident_exam_records()
returns table (
  event_id uuid,
  exam_type text,
  exam_date date,
  title text,
  max_score numeric,
  status text,
  participant_id uuid,
  resident_name text,
  resident_pgy smallint,
  part_id uuid,
  part_name text,
  part_sort_order smallint,
  score numeric,
  outcome text,
  result_updated_at timestamptz
)
language plpgsql security definer set search_path = public, private, auth as $$
begin
  if not (
    (select private.resident_role_is('admin'))
    or (select private.resident_role_is('staff'))
    or (select private.resident_role_is('resident'))
  ) then raise exception 'Active Resident, Staff, or Admin account required'; end if;
  return query
    select event.id, event.exam_type, event.exam_date, event.title, event.max_score,
      event.status, participant.resident_id, profile.full_name, profile.pgy,
      part.id, part.part_name, part.sort_order, result.score, result.outcome, result.updated_at
    from public.resident_exam_events event
    join public.resident_exam_participants participant on participant.event_id = event.id
    join public.resident_profiles profile on profile.user_id = participant.resident_id
    left join public.resident_exam_parts part on part.event_id = event.id
    left join public.resident_exam_results result
      on result.event_id = event.id and result.resident_id = participant.resident_id
        and result.part_id is not distinct from part.id
    where (select private.resident_role_is('admin'))
      or (
        event.status = 'published'
        and (
          (select private.resident_role_is('staff'))
          or participant.resident_id = (select auth.uid())
        )
      )
    order by event.exam_date desc, event.created_at desc, profile.full_name, part.sort_order nulls first;
end;
$$;
revoke all on function public.list_resident_exam_records() from public, anon;
grant execute on function public.list_resident_exam_records() to authenticated;

commit;
