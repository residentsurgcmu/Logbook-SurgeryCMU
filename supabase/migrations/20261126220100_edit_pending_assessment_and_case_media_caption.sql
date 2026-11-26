begin;
set local lock_timeout = '5s';

create function public.edit_pending_resident_assessment_request(
  p_request_id uuid, p_assessment_date date, p_procedure_or_activity text,
  p_clinical_context text, p_expected jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_request public.resident_assessment_requests%rowtype;
  v_activity text := btrim(coalesce(p_procedure_or_activity, ''));
  v_context text := btrim(coalesce(p_clinical_context, ''));
begin
  perform 1 from public.resident_user_roles where user_id = auth.uid() for share;
  if not (select private.resident_role_is('resident')) then
    raise exception 'Active Resident role required' using errcode = '42501';
  end if;
  select * into v_request from public.resident_assessment_requests
    where id = p_request_id and resident_id = auth.uid() for update;
  if not found then raise exception 'Request not found' using errcode = '42501'; end if;
  if v_request.status <> 'pending' then raise exception 'REQUEST_NOT_PENDING'; end if;
  if jsonb_build_array(v_request.assessment_date, v_request.procedure_or_activity, v_request.clinical_context) is distinct from p_expected then
    raise exception 'REQUEST_EDIT_CONFLICT';
  end if;
  if p_assessment_date is null or p_assessment_date > (now() at time zone 'Asia/Bangkok')::date
    or length(v_activity) not between 1 and 240 or length(v_context) > 500 then
    raise exception 'REQUEST_EDIT_INVALID' using errcode = '22023';
  end if;
  update public.resident_assessment_requests set assessment_date = p_assessment_date,
    procedure_or_activity = v_activity, clinical_context = v_context where id = p_request_id;
end;
$$;

-- Compare the details the assessor saw while holding the same account/request
-- locks as the existing completion function. Older clients keep their existing RPC.
create function public.complete_current_resident_assessment_request(
  p_request_id uuid, p_overall_outcome text, p_overall_comment text, p_scores jsonb, p_expected jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_request public.resident_assessment_requests%rowtype;
begin
  select * into v_request from public.resident_assessment_requests where id = p_request_id and staff_id = auth.uid();
  if not found then raise exception 'Request not found' using errcode = '42501'; end if;
  perform 1 from public.resident_user_roles where user_id in (auth.uid(), v_request.resident_id)
    order by user_id for share;
  select * into v_request from public.resident_assessment_requests where id = p_request_id and staff_id = auth.uid() for update;
  if not found or not (select private.resident_role_is('staff')) then
    raise exception 'Only the selected active Staff may assess this request' using errcode = '42501';
  end if;
  if jsonb_build_array(v_request.assessment_date, v_request.procedure_or_activity, v_request.clinical_context) is distinct from p_expected then
    raise exception 'REQUEST_EDIT_CONFLICT';
  end if;
  return public.complete_resident_assessment_request(p_request_id,p_overall_outcome,p_overall_comment,p_scores);
end;
$$;

create function public.rename_resident_case_media(p_media_id uuid, p_expected_caption text, p_caption text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_caption text := btrim(coalesce(p_caption, ''));
begin
  perform 1 from public.resident_user_roles where user_id = auth.uid() for share;
  if length(v_caption) > 200 then raise exception 'Caption too long' using errcode = '22023'; end if;
  update public.resident_case_media m set caption = v_caption
  where m.id = p_media_id and m.deleted_at is null and m.caption is not distinct from p_expected_caption
    and (select private.resident_case_member())
    and (m.created_by = auth.uid() or (select private.resident_role_is('admin')))
    and exists (select 1 from public.resident_admission_cases c where c.id = m.case_id and c.deleted_at is null);
  if not found then raise exception 'Image unavailable, changed or cannot be edited'; end if;
end;
$$;

revoke all on function public.edit_pending_resident_assessment_request(uuid,date,text,text,jsonb),
  public.complete_current_resident_assessment_request(uuid,text,text,jsonb,jsonb),
  public.rename_resident_case_media(uuid,text,text) from public, anon, authenticator, service_role;
grant execute on function public.edit_pending_resident_assessment_request(uuid,date,text,text,jsonb),
  public.complete_current_resident_assessment_request(uuid,text,text,jsonb,jsonb),
  public.rename_resident_case_media(uuid,text,text) to authenticated;
commit;
