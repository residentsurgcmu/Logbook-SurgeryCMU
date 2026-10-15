-- Exam MPL RPCs. Requires 20261015100000_exam_mpl_schema.sql. The legacy
-- create / save / publish functions are intentionally left as they are.
begin;

create or replace function public.create_resident_exam_event_mpl(
  p_exam_type text,
  p_exam_date date,
  p_title text,
  p_max_score numeric,
  p_parts jsonb,
  p_participant_ids jsonb
) returns uuid
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_event_id uuid;
  v_part jsonb;
  v_names jsonb := '[]'::jsonb;
  v_position integer := 0;
  v_max numeric;
  v_pgy integer;
  v_text text;
  v_part_id uuid;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if coalesce(jsonb_typeof(p_parts), '') <> 'array' then
    raise exception 'Parts must be an array';
  end if;
  if p_exam_type = 'mcq' and jsonb_array_length(p_parts) <> 1 then
    raise exception 'MCQ needs exactly one MPL row';
  end if;
  if p_exam_type = 'xray_anatomy' then
    for v_part in select value from jsonb_array_elements(p_parts) loop
      if jsonb_typeof(v_part) <> 'object' then raise exception 'Part is invalid'; end if;
      v_names := v_names || to_jsonb(coalesce(v_part->>'name', ''));
    end loop;
  end if;

  -- The legacy function validates type, date, title, participants, part names
  -- and the MCQ full score, and numbers the parts in array order.
  v_event_id := public.create_resident_exam_event(
    p_exam_type, p_exam_date, p_title, p_max_score, v_names, p_participant_ids);

  update public.resident_exam_events set scoring_mode = 'mpl' where id = v_event_id;
  update public.resident_exam_participants participant
  set pgy_at_exam = case when profile.pgy between 1 and 4 then profile.pgy end
  from public.resident_profiles profile
  where participant.event_id = v_event_id and profile.user_id = participant.resident_id;

  for v_part in select value from jsonb_array_elements(p_parts) loop
    v_position := v_position + 1;
    if p_exam_type = 'mcq' then
      v_max := p_max_score;
      v_part_id := null;
    else
      v_max := private.resident_exam_parse_number(v_part->>'maxScore', null, 'Part full score');
      if v_max <= 0 then raise exception 'Part full score must be greater than zero'; end if;
      update public.resident_exam_parts set max_score = v_max
      where event_id = v_event_id and sort_order = v_position
      returning id into v_part_id;
    end if;
    for v_pgy in 1..4 loop
      v_text := v_part->'mpl'->>(v_pgy::text);
      if coalesce(btrim(v_text), '') <> '' then
        insert into public.resident_exam_mpl(event_id, part_id, pgy, mpl)
        values (v_event_id, v_part_id, v_pgy, private.resident_exam_parse_number(v_text, v_max, 'MPL'));
      end if;
    end loop;
  end loop;
  return v_event_id;
end;
$$;
revoke all on function public.create_resident_exam_event_mpl(text, date, text, numeric, jsonb, jsonb) from public, anon;
grant execute on function public.create_resident_exam_event_mpl(text, date, text, numeric, jsonb, jsonb) to authenticated;

create or replace function public.save_resident_exam_scores(
  p_event_id uuid,
  p_results jsonb
) returns void
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_event public.resident_exam_events%rowtype;
  v_result jsonb;
  v_resident_id uuid;
  v_part_id uuid;
  v_max numeric;
  v_score numeric;
  v_pgy smallint;
  v_mpl numeric;
  v_key text;
  v_seen text[] := array[]::text[];
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if coalesce(jsonb_typeof(p_results), '') <> 'array' then raise exception 'Results must be an array'; end if;
  select * into v_event from public.resident_exam_events where id = p_event_id for update;
  if not found then raise exception 'Exam was not found'; end if;
  if v_event.scoring_mode <> 'mpl' then raise exception 'This exam records outcomes by hand'; end if;
  if v_event.status <> 'draft' then raise exception 'Return the exam to Draft before editing results'; end if;

  perform set_config('app.exam_mpl_save', 'on', true);
  delete from public.resident_exam_results where event_id = p_event_id;
  for v_result in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(v_result) <> 'object'
      or coalesce(v_result->>'residentId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Exam result is invalid';
    end if;
    v_resident_id := (v_result->>'residentId')::uuid;
    select pgy_at_exam into v_pgy from public.resident_exam_participants
    where event_id = p_event_id and resident_id = v_resident_id;
    if not found then raise exception 'Exam result includes a Resident outside this exam'; end if;

    if v_event.exam_type = 'mcq' then
      if v_result->>'partId' is not null then raise exception 'MCQ result is invalid'; end if;
      v_part_id := null;
      v_max := v_event.max_score;
      v_key := v_resident_id::text;
    else
      if coalesce(v_result->>'partId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'X-ray or Anatomy result is invalid';
      end if;
      v_part_id := (v_result->>'partId')::uuid;
      select max_score into v_max from public.resident_exam_parts
      where id = v_part_id and event_id = p_event_id;
      if not found or v_max is null then raise exception 'X-ray or Anatomy part is invalid'; end if;
      v_key := v_resident_id::text || ':' || v_part_id::text;
    end if;
    if v_key = any(v_seen) then raise exception 'Exam result is duplicated'; end if;
    v_seen := array_append(v_seen, v_key);

    v_score := private.resident_exam_parse_number(v_result->>'score', v_max, 'Score');
    v_mpl := null;
    select mpl into v_mpl from public.resident_exam_mpl
    where event_id = p_event_id and part_id is not distinct from v_part_id and pgy = v_pgy;

    insert into public.resident_exam_results(
      event_id, resident_id, part_id, score, outcome, outcome_source, updated_by, updated_at)
    values (
      p_event_id, v_resident_id, v_part_id, v_score,
      case
        when v_mpl is null then null
        when v_score >= v_mpl then 'pass'
        else 'remediation'
      end,
      'computed', (select auth.uid()), clock_timestamp());
  end loop;
  update public.resident_exam_events
  set updated_by = (select auth.uid()), updated_at = clock_timestamp()
  where id = p_event_id;
end;
$$;
revoke all on function public.save_resident_exam_scores(uuid, jsonb) from public, anon;
grant execute on function public.save_resident_exam_scores(uuid, jsonb) to authenticated;

create or replace function public.update_resident_exam_mpl(
  p_event_id uuid,
  p_mpl jsonb
) returns void
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_event public.resident_exam_events%rowtype;
  v_item jsonb;
  v_part_id uuid;
  v_max numeric;
  v_pgy integer;
  v_key text;
  v_seen text[] := array[]::text[];
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if coalesce(jsonb_typeof(p_mpl), '') <> 'array' then raise exception 'MPL rows must be an array'; end if;
  select * into v_event from public.resident_exam_events where id = p_event_id for update;
  if not found then raise exception 'Exam was not found'; end if;
  if v_event.scoring_mode <> 'mpl' then raise exception 'This exam records outcomes by hand'; end if;
  if v_event.status <> 'draft' then raise exception 'Return the exam to Draft before editing MPL'; end if;

  delete from public.resident_exam_mpl where event_id = p_event_id;
  for v_item in select value from jsonb_array_elements(p_mpl) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item->>'pgy', '') !~ '^[1-4]$' then
      raise exception 'MPL row is invalid';
    end if;
    v_pgy := (v_item->>'pgy')::integer;
    if v_event.exam_type = 'mcq' then
      if v_item->>'partId' is not null then raise exception 'MPL row is invalid'; end if;
      v_part_id := null;
      v_max := v_event.max_score;
      v_key := v_pgy::text;
    else
      if coalesce(v_item->>'partId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'MPL row is invalid';
      end if;
      v_part_id := (v_item->>'partId')::uuid;
      select max_score into v_max from public.resident_exam_parts
      where id = v_part_id and event_id = p_event_id;
      if not found or v_max is null then raise exception 'MPL row is invalid'; end if;
      v_key := v_part_id::text || ':' || v_pgy::text;
    end if;
    if v_key = any(v_seen) then raise exception 'MPL row is duplicated'; end if;
    v_seen := array_append(v_seen, v_key);
    insert into public.resident_exam_mpl(event_id, part_id, pgy, mpl)
    values (p_event_id, v_part_id, v_pgy, private.resident_exam_parse_number(v_item->>'mpl', v_max, 'MPL'));
  end loop;

  update public.resident_exam_results result
  set outcome = (
        select case when result.score >= m.mpl then 'pass' else 'remediation' end
        from public.resident_exam_mpl m
        where m.event_id = result.event_id
          and m.part_id is not distinct from result.part_id
          and m.pgy = participant.pgy_at_exam
      ),
      outcome_source = 'computed',
      updated_by = (select auth.uid()),
      updated_at = clock_timestamp()
  from public.resident_exam_participants participant
  where result.event_id = p_event_id
    and participant.event_id = result.event_id
    and participant.resident_id = result.resident_id;

  update public.resident_exam_events
  set updated_by = (select auth.uid()), updated_at = clock_timestamp()
  where id = p_event_id;
end;
$$;
revoke all on function public.update_resident_exam_mpl(uuid, jsonb) from public, anon;
grant execute on function public.update_resident_exam_mpl(uuid, jsonb) to authenticated;

drop function public.list_resident_exam_records();
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
  result_updated_at timestamptz,
  scoring_mode text,
  part_max_score numeric,
  pgy_at_exam smallint,
  mpl numeric,
  outcome_source text
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
      part.id, part.part_name, part.sort_order, result.score, result.outcome, result.updated_at,
      event.scoring_mode, part.max_score, participant.pgy_at_exam, mpl_row.mpl, result.outcome_source
    from public.resident_exam_events event
    join public.resident_exam_participants participant on participant.event_id = event.id
    join public.resident_profiles profile on profile.user_id = participant.resident_id
    left join public.resident_exam_parts part on part.event_id = event.id
    left join public.resident_exam_results result
      on result.event_id = event.id and result.resident_id = participant.resident_id
        and result.part_id is not distinct from part.id
    left join public.resident_exam_mpl mpl_row
      on mpl_row.event_id = event.id and mpl_row.part_id is not distinct from part.id
        and mpl_row.pgy = participant.pgy_at_exam
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
