begin;
do $$ begin if exists(select 1 from public.resident_profiles) then raise exception 'Refusing nonempty fixture database';end if;end $$;
update public.resident_maintenance_pause set paused=false where scope='accounts';
insert into auth.users(id,email) values
('c0000000-0000-4000-8000-000000000001','cal-admin@fixture.test'),
('c0000000-0000-4000-8000-000000000002','cal-r1@fixture.test'),
('c0000000-0000-4000-8000-000000000003','cal-r2@fixture.test'),
('c0000000-0000-4000-8000-000000000004','cal-staff@fixture.test');
insert into public.resident_profiles(user_id,full_name,email,pgy) select id,'Calendar Fixture',email,case when email like 'cal-r%' then 1 else null end from auth.users;
insert into public.resident_user_roles(user_id,role) values
('c0000000-0000-4000-8000-000000000001','admin'),
('c0000000-0000-4000-8000-000000000002','resident'),
('c0000000-0000-4000-8000-000000000003','resident'),
('c0000000-0000-4000-8000-000000000004','staff');
set local request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
do $$
declare v_id uuid:='c1000000-0000-4000-8000-000000000001'; v_p jsonb:=jsonb_build_object('title','Anatomy test','kind','exam','starts_at','2027-01-02T09:00:00+07:00','ends_at','2027-01-02T12:00:00+07:00','location','Room A','description','Read instructions','status','draft','audience_mode','selected','pgys','[]'::jsonb,'user_ids','["c0000000-0000-4000-8000-000000000002"]'::jsonb,'exam_id',null); v_n integer; v_r jsonb;
begin
 perform public.save_resident_calendar_event(v_id,0,v_p);
 if (select count(*) from public.resident_calendar_participants where event_id=v_id)<>1 then raise exception 'selected roster';end if;
 if not (public.save_resident_calendar_event(v_id,0,v_p)->>'replayed')::boolean then raise exception 'create replay';end if;
 if (select count(*) from public.resident_calendar_audit)<>1 then raise exception 'duplicate audit';end if;
 begin perform public.save_resident_calendar_event(v_id,0,v_p||'{"title":"Different"}');raise exception 'stale accepted';exception when others then if sqlerrm not like 'CALENDAR_CONFLICT:%' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000002',true);
 if public.list_resident_calendar_events('2027-01-01','2027-02-01')<>'[]' then raise exception 'draft visible';end if;
 begin perform public.list_resident_calendar_events('2027-01-01','2027-02-01',true);raise exception 'resident admin read';exception when others then if sqlerrm not like 'CALENDAR_FORBIDDEN:%' then raise;end if;end;
 begin perform public.save_resident_calendar_event(v_id,1,v_p);raise exception 'resident saved';exception when others then if sqlerrm not like 'CALENDAR_FORBIDDEN:%' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
 v_p:=v_p||'{"status":"published"}';perform public.save_resident_calendar_event(v_id,1,v_p);
 if (public.save_resident_calendar_event(v_id,2,v_p)->>'version')::int<>2 then raise exception 'noop bumps version';end if;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000002',true);
 v_r:=public.list_resident_calendar_events('2027-01-01','2027-02-01');
 if jsonb_array_length(v_r)<>1 or v_r->0->'admin_payload'<>'null' then raise exception 'own read/payload leak';end if;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000003',true);
 if public.list_resident_calendar_events('2027-01-01','2027-02-01')<>'[]' then raise exception 'cross resident leak';end if;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000004',true);
 if jsonb_array_length(public.list_resident_calendar_events('2027-01-01','2027-02-01'))<>1 then raise exception 'staff published read';end if;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
 v_n:=(select count(*) from public.resident_calendar_audit);
 begin perform public.save_resident_calendar_event(v_id,2,v_p||'{"ends_at":"2027-01-01"}');raise exception 'invalid end';exception when others then if sqlerrm not like 'CALENDAR_INVALID:%' then raise;end if;end;
 begin perform public.save_resident_calendar_event(v_id,2,v_p||'{"audience_mode":"selected","user_ids":["c0000000-0000-4000-8000-000000000002","c0000000-0000-4000-8000-000000000002"]}');raise exception 'duplicate audience';exception when others then if sqlerrm not like 'CALENDAR_INVALID:%' then raise;end if;end;
 begin perform public.save_resident_calendar_event(v_id,2,v_p||'{"audience_mode":"selected","user_ids":["c0000000-0000-4000-8000-000000000004"]}');raise exception 'staff target';exception when others then if sqlerrm not like 'CALENDAR_INVALID:%' then raise;end if;end;
 if v_n<>(select count(*) from public.resident_calendar_audit) then raise exception 'partial audit committed';end if;
 v_p:=v_p||'{"audience_mode":"pgy","pgys":[1],"user_ids":[]}';perform public.save_resident_calendar_event(v_id,2,v_p);
 if (select count(*) from public.resident_calendar_participants where event_id=v_id)<>2 then raise exception 'pgy roster';end if;
 -- Do not let PGY/profile changes rewrite an established roster.
 update public.resident_profiles set pgy=2 where user_id='c0000000-0000-4000-8000-000000000003';
 v_p:=v_p||'{"location":"Room B"}';perform public.save_resident_calendar_event(v_id,3,v_p);
 if not exists(select 1 from public.resident_calendar_participants where event_id=v_id and user_id='c0000000-0000-4000-8000-000000000003' and pgy_at_schedule=1) then raise exception 'snapshot changed';end if;
 update public.resident_profiles set active=false where user_id='c0000000-0000-4000-8000-000000000002';
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000002',true);
 begin perform public.list_resident_calendar_events('2027-01-01','2027-02-01');raise exception 'inactive read';exception when others then if sqlerrm not like 'CALENDAR_FORBIDDEN:%' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
 v_p:=v_p||'{"status":"cancelled"}';perform public.save_resident_calendar_event(v_id,4,v_p);
 if (select status from public.resident_calendar_events where id=v_id)<>'cancelled' then raise exception 'cancel failed';end if;
 if has_table_privilege('authenticated','public.resident_calendar_events','SELECT') or has_table_privilege('service_role','public.resident_calendar_participants','INSERT') or has_function_privilege('anon','public.save_resident_calendar_event(uuid,integer,jsonb)','EXECUTE') then raise exception 'grant leak';end if;
 raise notice 'PASS calendar role / draft / audience / replay / stale / validation / snapshot / inactive / cancellation probes';
end $$;
-- Exercise the real exam protocol: calendar publication must not release draft scores.
do $$
declare c jsonb; pv jsonb; r jsonb; ex uuid; rev uuid; part uuid;
 ev uuid:='c1000000-0000-4000-8000-000000000002'; p jsonb;
begin
 c:=public.rc04_create_managed_exam(gen_random_uuid(),'{"exam_type":"xray_anatomy","title":"Hidden score fixture","exam_date":"2027-01-03","academic_year":2570,"roster":[{"resident_id":"c0000000-0000-4000-8000-000000000003","pgy_at_exam":2}],"parts":[{"name":"Anatomy","sort_order":1,"max_score":100,"mpl":{"2":60}}]}');
 ex:=(c->>'exam_id')::uuid;rev:=(c->>'revision_id')::uuid;
 p:=jsonb_build_object('title','Public exam schedule','kind','exam','starts_at','2027-01-03T09:00:00+07:00','ends_at','2027-01-03T12:00:00+07:00','location','','description','','status','published','audience_mode','selected','pgys','[]'::jsonb,'user_ids','["c0000000-0000-4000-8000-000000000003"]'::jsonb,'exam_id',ex);
 perform public.save_resident_calendar_event(ev,0,p);
 if exists(select 1 from public.resident_exam_events where id=ex and (status<>'draft' or published_revision_id is not null)) then raise exception 'schedule published scores';end if;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000003',true);
 r:=public.list_resident_calendar_events('2027-01-01','2027-02-01');
 if not exists(select 1 from jsonb_array_elements(r) x where x->>'id'=ev::text and x->'exam_id'='null' and x->'participants'='null') then raise exception 'draft exam id/roster leak';end if;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
 select part_id into part from public.rc04_revision_parts where revision_id=rev;
 pv:=public.rc04_preview_import(ex,rev,1,jsonb_build_array(jsonb_build_object('resident_id','c0000000-0000-4000-8000-000000000003','part_id',part,'state','awaiting')));
 perform public.rc04_commit_import(gen_random_uuid(),(pv->>'preview_id')::uuid,1,pv->>'delta_fingerprint');
 perform public.rc04_mark_reviewed(gen_random_uuid(),ex,rev,2,'{"absent":0,"awaiting":1}');
 perform public.rc04_publish_revision(gen_random_uuid(),ex,rev,2,null,'{"absent":0,"awaiting":1}');
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000003',true);
 r:=public.list_resident_calendar_events('2027-01-01','2027-02-01');
 if not exists(select 1 from jsonb_array_elements(r) x where x->>'id'=ev::text and x->>'exam_id'=ex::text) then raise exception 'published exam link missing';end if;
 raise notice 'PASS linked exam draft remains private; published link becomes available without changing score protocol';
end $$;
set local role authenticated;
do $$ begin
 begin perform 1 from public.resident_calendar_events;raise exception 'direct read allowed';exception when insufficient_privilege then null;end;
 begin insert into public.resident_calendar_audit(event_id,actor_id,version,payload) values(gen_random_uuid(),auth.uid(),1,'{}');raise exception 'direct audit write allowed';exception when insufficient_privilege then null;end;
 if jsonb_array_length(public.list_resident_calendar_events('2027-01-01','2027-02-01'))<>2 then raise exception 'HTTP role read failed';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.list_resident_calendar_events('2027-01-01','2027-02-01');raise exception 'anonymous call allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- G33-B01 deterministic interleaving: event INSERT is between audience capture
-- and participants INSERT. Change account data at that exact boundary.
set local request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
update public.resident_profiles set pgy=1 where user_id='c0000000-0000-4000-8000-000000000003';
create function pg_temp.calendar_interleave() returns trigger language plpgsql as $$
begin
 if new.id='c1000000-0000-4000-8000-000000000099' then
  update public.resident_profiles set pgy=2 where user_id='c0000000-0000-4000-8000-000000000003';
 end if;
 return new;
end $$;
create trigger calendar_test_interleave before insert on public.resident_calendar_events
 for each row execute function pg_temp.calendar_interleave();
do $$
declare v_id uuid:='c1000000-0000-4000-8000-000000000099'; p jsonb:='{"title":"Snapshot interleave","kind":"activity","starts_at":"2027-02-02T09:00:00+07:00","ends_at":"2027-02-02T10:00:00+07:00","location":"A","description":"","status":"published","audience_mode":"pgy","pgys":[1],"user_ids":[],"exam_id":null}';
begin
 perform public.save_resident_calendar_event(v_id,0,p);
 if (select pgy from public.resident_profiles where user_id='c0000000-0000-4000-8000-000000000003')<>2 then raise exception 'G33 fault did not execute';end if;
 if not exists(select 1 from public.resident_calendar_participants where event_id=v_id and user_id='c0000000-0000-4000-8000-000000000003' and pgy_at_schedule=1) then raise exception 'G33-B01: mixed roster/PGY snapshot';end if;
 perform public.save_resident_calendar_event(v_id,1,p||'{"location":"B"}');
 if not exists(select 1 from public.resident_calendar_participants where event_id=v_id and user_id='c0000000-0000-4000-8000-000000000003' and pgy_at_schedule=1) then raise exception 'G33 detail edit changed snapshot';end if;
 raise notice 'PASS G33-B01 identity/PGY captured together despite intervening account edit; details preserve snapshot';
end $$;
drop trigger calendar_test_interleave on public.resident_calendar_events;
rollback;
