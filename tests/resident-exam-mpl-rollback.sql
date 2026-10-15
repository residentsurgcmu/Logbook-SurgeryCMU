-- Behaviour test for the exam MPL RPCs. ONE transaction, always ROLLBACK, so no
-- exam data is kept. Needs one active Admin and three active Residents.
-- Run on STAGING after both migrations:
-- npx --yes supabase db query --linked --file tests/resident-exam-mpl-rollback.sql
begin;

create function public.zz_act_as(p_user uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function public.zz_reset() returns void language plpgsql as $$
begin execute 'reset role'; end;
$$;
create function public.zz_fails(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end;
$$;

do $$
declare
  v_admin uuid; v_r1 uuid; v_r2 uuid; v_r3 uuid;
  v_event uuid; v_part uuid; v_outcome text; v_source text; v_count int; v_mpl numeric;
begin
  select user_id into v_admin from public.resident_user_roles where role = 'admin' and active limit 1;
  select user_id into v_r1 from public.resident_user_roles where role = 'resident' and active order by user_id limit 1;
  select user_id into v_r2 from public.resident_user_roles where role = 'resident' and active and user_id <> v_r1 order by user_id limit 1;
  select user_id into v_r3 from public.resident_user_roles where role = 'resident' and active and user_id not in (v_r1, v_r2) order by user_id limit 1;
  if v_admin is null or v_r1 is null or v_r2 is null or v_r3 is null then
    raise exception 'Need one active Admin and three active Resident accounts';
  end if;
  update public.resident_profiles set pgy = 1 where user_id = v_r1;
  update public.resident_profiles set pgy = 2 where user_id = v_r2;
  update public.resident_profiles set pgy = null where user_id = v_r3;

  perform public.zz_act_as(v_admin);
  perform public.save_resident_exam_standards(jsonb_build_array(
    jsonb_build_object('examType', 'xray_anatomy', 'partName', 'Anatomy', 'maxScore', '100',
      'mpl', jsonb_build_object('1', '60', '2', '65')),
    jsonb_build_object('examType', 'mcq', 'partName', 'MCQ', 'maxScore', '50', 'mpl', jsonb_build_object('1', '30'))));
  if (select count(*) from public.resident_exam_standards) <> 2 then raise exception 'standards not saved'; end if;
  if public.zz_fails($q$select public.save_resident_exam_standards(jsonb_build_array(
      jsonb_build_object('examType','mcq','partName','MCQ','maxScore','50','mpl',jsonb_build_object('1','51'))))$q$)
    is not true then raise exception 'MPL above full score must be refused'; end if;
  -- the refused call rolled itself back inside zz_fails; keep a known state for the next step
  perform public.save_resident_exam_standards(jsonb_build_array(
    jsonb_build_object('examType', 'xray_anatomy', 'partName', 'Anatomy', 'maxScore', '100',
      'mpl', jsonb_build_object('1', '60', '2', '65'))));

  v_event := public.create_resident_exam_event_mpl(
    'xray_anatomy', (now() at time zone 'Asia/Bangkok')::date, 'TEST exam', null,
    jsonb_build_array(jsonb_build_object('name', 'Anatomy', 'maxScore', '100',
      'mpl', jsonb_build_object('1', '60', '2', '65'))),
    jsonb_build_array(v_r1, v_r2, v_r3));
  select id into v_part from public.resident_exam_parts where event_id = v_event;
  if (select scoring_mode from public.resident_exam_events where id = v_event) <> 'mpl' then raise exception 'scoring_mode'; end if;
  if (select pgy_at_exam from public.resident_exam_participants where event_id = v_event and resident_id = v_r1) is distinct from 1 then raise exception 'pgy_at_exam r1'; end if;
  if (select pgy_at_exam from public.resident_exam_participants where event_id = v_event and resident_id = v_r3) is not null then raise exception 'pgy_at_exam r3 must be null'; end if;

  -- 60 vs MPL 60 passes (equal), 60 vs MPL 65 fails, no PGY -> null outcome
  perform public.save_resident_exam_scores(v_event, jsonb_build_array(
    jsonb_build_object('residentId', v_r1, 'partId', v_part, 'score', '60'),
    jsonb_build_object('residentId', v_r2, 'partId', v_part, 'score', '60'),
    jsonb_build_object('residentId', v_r3, 'partId', v_part, 'score', '99')));
  select outcome, outcome_source into v_outcome, v_source from public.resident_exam_results where event_id = v_event and resident_id = v_r1;
  if v_outcome <> 'pass' or v_source <> 'computed' then raise exception 'equal to MPL must pass, got %', v_outcome; end if;
  select outcome into v_outcome from public.resident_exam_results where event_id = v_event and resident_id = v_r2;
  if v_outcome <> 'remediation' then raise exception 'below MPL must fail, got %', v_outcome; end if;
  select outcome into v_outcome from public.resident_exam_results where event_id = v_event and resident_id = v_r3;
  if v_outcome is not null then raise exception 'no PGY must give a null outcome'; end if;

  -- refusals
  if public.zz_fails(format($q$select public.save_resident_exam_scores(%L, jsonb_build_array(
      jsonb_build_object('residentId', %L, 'partId', %L, 'score', '100.01')))$q$, v_event, v_r1, v_part)) is not true
    then raise exception 'score above full score must be refused'; end if;
  if public.zz_fails(format($q$select public.save_resident_exam_results(%L, jsonb_build_array(
      jsonb_build_object('residentId', %L, 'partId', %L, 'score', null, 'outcome', 'pass')))$q$, v_event, v_r1, v_part)) is not true
    then raise exception 'legacy save must be blocked on an MPL exam'; end if;
  if public.zz_fails(format($q$select public.save_resident_exam_results(%L, '[]'::jsonb)$q$, v_event)) is not true
    then raise exception 'legacy save with an empty payload must not delete computed results'; end if;
  if (select count(*) from public.resident_exam_results where event_id = v_event) <> 3
    then raise exception 'computed results must still be there after the blocked legacy save'; end if;

  -- editing MPL recomputes: lower PGY2 MPL to 55 -> r2 passes; clear PGY1 -> r1 null
  perform public.update_resident_exam_mpl(v_event, jsonb_build_array(
    jsonb_build_object('partId', v_part, 'pgy', 2, 'mpl', '55')));
  select outcome into v_outcome from public.resident_exam_results where event_id = v_event and resident_id = v_r2;
  if v_outcome <> 'pass' then raise exception 'recompute after MPL edit failed, got %', v_outcome; end if;
  select outcome into v_outcome from public.resident_exam_results where event_id = v_event and resident_id = v_r1;
  if v_outcome is not null then raise exception 'cleared MPL must give a null outcome'; end if;

  -- restore PGY1 MPL, publish, then a promotion must not change the published row
  perform public.update_resident_exam_mpl(v_event, jsonb_build_array(
    jsonb_build_object('partId', v_part, 'pgy', 1, 'mpl', '60'),
    jsonb_build_object('partId', v_part, 'pgy', 2, 'mpl', '55')));
  perform public.set_resident_exam_publication(v_event, true);
  if public.zz_fails(format($q$select public.update_resident_exam_mpl(%L, '[]'::jsonb)$q$, v_event)) is not true
    then raise exception 'MPL edit after publish must be refused'; end if;
  perform public.zz_reset();
  update public.resident_profiles set pgy = 3 where user_id = v_r1;
  perform public.zz_act_as(v_r1);
  select count(*) into v_count from public.list_resident_exam_records() where event_id = v_event;
  if v_count <> 1 then raise exception 'a Resident must see only their own row, got %', v_count; end if;
  select mpl into v_mpl from public.list_resident_exam_records() where event_id = v_event;
  if v_mpl is distinct from 60 then raise exception 'published MPL must stay the PGY-at-exam value, got %', v_mpl; end if;
  if (select pgy_at_exam from public.list_resident_exam_records() where event_id = v_event) is distinct from 1
    then raise exception 'pgy_at_exam must stay 1 after promotion'; end if;
  perform public.zz_reset();
  raise notice 'exam MPL behaviour: all checks passed';
end;
$$;

rollback;
