-- G33-B01: preserve the identity/PGY pair selected by the audience query.
-- Additive forward fix because v1 was already applied to staging. API/grants unchanged.
create or replace function public.save_resident_calendar_event(p_id uuid,p_expected_version integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid := private.calendar_require_actor(true); v_old public.resident_calendar_events%rowtype;
 v_targets uuid[]; v_target_pgys smallint[]; v_pgys integer[]; v_start timestamptz; v_end timestamptz; v_exam uuid; v_version integer; v_mode text;
begin
 if p_id is null or p_expected_version is null or p_expected_version<0 or jsonb_typeof(p_payload) is distinct from 'object'
 or not (p_payload ?& array['title','kind','starts_at','ends_at','location','description','status','audience_mode','pgys','user_ids','exam_id'])
 or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(array['title','kind','starts_at','ends_at','location','description','status','audience_mode','pgys','user_ids','exam_id'])) then
 raise exception 'CALENDAR_INVALID: Invalid event';end if;
 if exists(select 1 from unnest(array['title','kind','starts_at','ends_at','location','description','status','audience_mode']) k where jsonb_typeof(p_payload->k) is distinct from 'string')
 or jsonb_typeof(p_payload->'pgys') is distinct from 'array' or jsonb_typeof(p_payload->'user_ids') is distinct from 'array'
 or jsonb_typeof(p_payload->'exam_id') not in ('string','null') then raise exception 'CALENDAR_INVALID: Wrong field type';end if;
 if length(btrim(p_payload->>'title')) not between 2 and 160 or length(p_payload->>'location')>200 or length(p_payload->>'description')>2000
 or p_payload->>'kind' not in ('exam','activity') or p_payload->>'status' not in ('draft','published','cancelled') then raise exception 'CALENDAR_INVALID: Check event details';end if;
 v_mode:=p_payload->>'audience_mode';
 if v_mode not in ('all','pgy','selected') or jsonb_array_length(p_payload->'pgys')>5 or jsonb_array_length(p_payload->'user_ids')>200 then raise exception 'CALENDAR_INVALID: Invalid audience';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'pgys') x where jsonb_typeof(x)<>'number' or x::text !~ '^[1-5]$')
 or exists(select 1 from jsonb_array_elements(p_payload->'user_ids') x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') then raise exception 'CALENDAR_INVALID: Invalid audience values';end if;
 select coalesce(array_agg(x::integer),'{}') into v_pgys from jsonb_array_elements_text(p_payload->'pgys') x;
 if cardinality(v_pgys)<>(select count(distinct x) from unnest(v_pgys) x)
 or jsonb_array_length(p_payload->'user_ids')<>(select count(distinct x) from jsonb_array_elements_text(p_payload->'user_ids') x)
 or (v_mode='pgy' and cardinality(v_pgys)=0) or (v_mode<>'pgy' and cardinality(v_pgys)>0)
 or (v_mode='selected' and jsonb_array_length(p_payload->'user_ids')=0) or (v_mode<>'selected' and jsonb_array_length(p_payload->'user_ids')>0) then raise exception 'CALENDAR_INVALID: Inconsistent audience';end if;
 begin
 v_start:=(p_payload->>'starts_at')::timestamptz; v_end:=(p_payload->>'ends_at')::timestamptz; v_exam:=(p_payload->>'exam_id')::uuid;
 exception when others then raise exception 'CALENDAR_INVALID: Invalid date or exam';end;
 if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_end<=v_start or v_end>v_start+interval '14 days' then raise exception 'CALENDAR_INVALID: Check start and end';end if;
 if v_exam is not null and (p_payload->>'kind'<>'exam' or not exists(select 1 from public.resident_exam_events where id=v_exam and managed_by_rc04)) then raise exception 'CALENDAR_INVALID: Exam not found';end if;
 -- Serialize creation and updates for the same client-generated identity.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into v_old from public.resident_calendar_events where id=p_id for update;
 if found then
  if v_old.version=p_expected_version+1 and v_old.last_payload=p_payload then return jsonb_build_object('id',p_id,'version',v_old.version,'replayed',true);end if;
  if p_expected_version<>v_old.version then raise exception 'CALENDAR_CONFLICT: Reload before editing';end if;
  if v_old.last_payload=p_payload then return jsonb_build_object('id',p_id,'version',v_old.version,'unchanged',true);end if;
 elsif p_expected_version<>0 then raise exception 'CALENDAR_CONFLICT: Event not found';end if;
 -- Detail/status edits preserve the roster even if current accounts/PGY change.
 if v_old.id is not null and (v_old.last_payload->'audience_mode',v_old.last_payload->'pgys',v_old.last_payload->'user_ids') is not distinct from (p_payload->'audience_mode',p_payload->'pgys',p_payload->'user_ids') then
 select array_agg(user_id order by user_id) into v_targets from public.resident_calendar_participants where event_id=p_id;
 else
 -- Capture identity and PGY in ONE statement snapshot; never re-read profiles below.
 select coalesce(array_agg(p.user_id order by p.user_id),'{}'),
        coalesce(array_agg(p.pgy order by p.user_id),'{}') into v_targets,v_target_pgys
 from public.resident_profiles p join public.resident_user_roles r using(user_id)
 where p.active and r.active and r.role='resident' and
 (v_mode='all' or (v_mode='pgy' and p.pgy=any(v_pgys)) or (v_mode='selected' and p.user_id in(select x::uuid from jsonb_array_elements_text(p_payload->'user_ids') x)));
 if cardinality(v_targets) not between 1 and 200 or (v_mode='selected' and cardinality(v_targets)<>jsonb_array_length(p_payload->'user_ids')) then raise exception 'CALENDAR_INVALID: Select 1-200 active Residents';end if;
 end if;
 v_version:=coalesce(v_old.version,0)+1;
 insert into public.resident_calendar_events(id,version,title,kind,starts_at,ends_at,location,description,status,exam_id,audience_mode,audience_pgys,last_payload,created_by)
 values(p_id,v_version,btrim(p_payload->>'title'),p_payload->>'kind',v_start,v_end,p_payload->>'location',p_payload->>'description',p_payload->>'status',v_exam,v_mode,v_pgys,p_payload,v_actor)
 on conflict(id) do update set version=excluded.version,title=excluded.title,kind=excluded.kind,starts_at=excluded.starts_at,ends_at=excluded.ends_at,location=excluded.location,description=excluded.description,status=excluded.status,exam_id=excluded.exam_id,audience_mode=excluded.audience_mode,audience_pgys=excluded.audience_pgys,last_payload=excluded.last_payload,updated_at=now();
 if v_old.id is null or (v_old.last_payload->'audience_mode',v_old.last_payload->'pgys',v_old.last_payload->'user_ids') is distinct from (p_payload->'audience_mode',p_payload->'pgys',p_payload->'user_ids') then
 delete from public.resident_calendar_participants where event_id=p_id;
 insert into public.resident_calendar_participants(event_id,user_id,pgy_at_schedule) select p_id,s.user_id,s.pgy from unnest(v_targets,v_target_pgys) as s(user_id,pgy);
 end if;
 insert into public.resident_calendar_audit(event_id,actor_id,version,payload) values(p_id,v_actor,v_version,jsonb_build_object('event',p_payload,'participant_ids',v_targets));
 return jsonb_build_object('id',p_id,'version',v_version,'participant_count',cardinality(v_targets));
end $$;
