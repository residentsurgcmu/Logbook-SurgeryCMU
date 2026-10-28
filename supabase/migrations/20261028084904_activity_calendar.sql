-- Independent schedule: publishing a calendar item never publishes exam scores.
create table public.resident_calendar_events (
 id uuid primary key, version integer not null default 1 check(version>0),
 title text not null check(length(title) between 2 and 160),
 kind text not null check(kind in ('exam','activity')),
 starts_at timestamptz not null, ends_at timestamptz not null,
 location text not null default '' check(length(location)<=200),
 description text not null default '' check(length(description)<=2000),
 status text not null check(status in ('draft','published','cancelled')),
 exam_id uuid references public.resident_exam_events(id),
 audience_mode text not null check(audience_mode in ('all','pgy','selected')),
 audience_pgys integer[] not null default '{}',
 last_payload jsonb not null,
 created_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '14 days')
);
create table public.resident_calendar_participants (
 event_id uuid not null references public.resident_calendar_events(id),
 user_id uuid not null references auth.users(id),
 pgy_at_schedule smallint,
 primary key(event_id,user_id)
);
create index resident_calendar_participants_user on public.resident_calendar_participants(user_id,event_id);
create index resident_calendar_events_start on public.resident_calendar_events(starts_at,id);
create table public.resident_calendar_audit (
 id bigint generated always as identity primary key,
 event_id uuid not null references public.resident_calendar_events(id),
 actor_id uuid not null references auth.users(id), version integer not null,
 recorded_at timestamptz not null default now(), payload jsonb not null
);
alter table public.resident_calendar_events enable row level security;
alter table public.resident_calendar_participants enable row level security;
alter table public.resident_calendar_audit enable row level security;
revoke all on public.resident_calendar_events,public.resident_calendar_participants,public.resident_calendar_audit from public,anon,authenticated,service_role;
revoke all on sequence public.resident_calendar_audit_id_seq from public,anon,authenticated,service_role;

create function private.calendar_require_actor(p_admin boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid := auth.uid(); v_role text;
begin
 select r.role::text into v_role from public.resident_profiles p join public.resident_user_roles r using(user_id)
 where p.user_id=v_id and p.active and r.active order by p.user_id for share of p,r;
 if v_role is null or v_role not in ('admin','staff','resident') or (p_admin and v_role<>'admin') then
  raise exception 'CALENDAR_FORBIDDEN: Active account required'; end if;
 return v_id;
end $$;
revoke all on function private.calendar_require_actor(boolean) from public,anon,authenticated,service_role;

create function public.save_resident_calendar_event(p_id uuid,p_expected_version integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid := private.calendar_require_actor(true); v_old public.resident_calendar_events%rowtype;
 v_targets uuid[]; v_pgys integer[]; v_start timestamptz; v_end timestamptz; v_exam uuid; v_version integer; v_mode text;
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
 select coalesce(array_agg(p.user_id order by p.user_id),'{}') into v_targets
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
 insert into public.resident_calendar_participants(event_id,user_id,pgy_at_schedule) select p_id,user_id,pgy from public.resident_profiles where user_id=any(v_targets);
 end if;
 insert into public.resident_calendar_audit(event_id,actor_id,version,payload) values(p_id,v_actor,v_version,jsonb_build_object('event',p_payload,'participant_ids',v_targets));
 return jsonb_build_object('id',p_id,'version',v_version,'participant_count',cardinality(v_targets));
end $$;
revoke all on function public.save_resident_calendar_event(uuid,integer,jsonb) from public,anon,service_role;
grant execute on function public.save_resident_calendar_event(uuid,integer,jsonb) to authenticated;

create function public.list_resident_calendar_events(p_from timestamptz,p_to timestamptz,p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid := private.calendar_require_actor(p_admin); v_rows jsonb; v_staff boolean := private.resident_role_is('staff');
begin
 if p_admin is null or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to>p_from+interval '93 days' then raise exception 'CALENDAR_INVALID: Select at most 93 days';end if;
 select coalesce(jsonb_agg(q.data order by q.starts_at,q.id),'[]') into v_rows from (
 select e.id,e.starts_at, jsonb_build_object('id',e.id,'version',e.version,'title',e.title,'kind',e.kind,'starts_at',e.starts_at,'ends_at',e.ends_at,'location',e.location,'description',e.description,'status',e.status,
 'exam_id',case when exists(select 1 from public.resident_exam_events x where x.id=e.exam_id and ((x.managed_by_rc04 and x.published_revision_id is not null) or (not x.managed_by_rc04 and x.status='published'))) or p_admin then e.exam_id else null end,
 'participant_count',case when p_admin then (select count(*) from public.resident_calendar_participants p where p.event_id=e.id) else null end,
 'participants',case when p_admin then (select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'pgy_at_schedule',p.pgy_at_schedule) order by p.user_id),'[]') from public.resident_calendar_participants p where p.event_id=e.id) else null end,
 'admin_payload',case when p_admin then e.last_payload else null end) data
 from public.resident_calendar_events e where e.starts_at<p_to and e.ends_at>p_from and
 (p_admin or (e.status in ('published','cancelled') and (v_staff or exists(select 1 from public.resident_calendar_participants p where p.event_id=e.id and p.user_id=v_actor))))
 order by e.starts_at,e.id limit 501) q;
 if jsonb_array_length(v_rows)>500 then raise exception 'CALENDAR_LIMIT: Narrow the date range';end if;
 return v_rows;
end $$;
revoke all on function public.list_resident_calendar_events(timestamptz,timestamptz,boolean) from public,anon,service_role;
grant execute on function public.list_resident_calendar_events(timestamptz,timestamptz,boolean) to authenticated;
