begin;
do $$ begin if exists(select 1 from public.resident_profiles) then raise exception 'Refusing fixtures on a nonempty database'; end if; end $$;
update public.resident_maintenance_pause set paused=false where scope='accounts';
insert into auth.users(id,email) values ('e0000000-0000-4000-8000-000000000001','round-admin@fixture.test'),('e0000000-0000-4000-8000-000000000002','round-resident@fixture.test'),('e0000000-0000-4000-8000-000000000003','round-staff@fixture.test');
insert into public.resident_profiles(user_id,full_name,email,pgy) values ('e0000000-0000-4000-8000-000000000001','Round Admin','round-admin@fixture.test',null),('e0000000-0000-4000-8000-000000000002','Round Resident','round-resident@fixture.test',1),('e0000000-0000-4000-8000-000000000003','Round Staff','round-staff@fixture.test',null);
insert into public.resident_user_roles(user_id,role) values ('e0000000-0000-4000-8000-000000000001','admin'),('e0000000-0000-4000-8000-000000000002','resident'),('e0000000-0000-4000-8000-000000000003','staff');
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
do $$
declare v_id uuid; v_plain uuid; v_live uuid; v_tok uuid; v_day date := (clock_timestamp() at time zone 'Asia/Bangkok')::date; v_n int; v_before timestamptz; v_on timestamptz; v_speaker_path text; v_named uuid; v_parallel uuid; v_parallel_tok uuid;
begin
 v_id := public.schedule_resident_round(v_day+30,'09:00','12:00','09:00','12:00',true);
 if not exists(select 1 from public.resident_round_seat_config where session_id=v_id and on_time_at=((v_day+30+time '09:00') at time zone 'Asia/Bangkok')) then raise exception 'default seating/cutoff missing';end if;
 raise notice 'PASS atomic default QR + seat config';
 v_plain := public.schedule_resident_round(v_day+31,'09:00','12:00','09:00','12:00',false);
 if exists(select 1 from public.resident_round_seat_config where session_id=v_plain) then raise exception 'QR only ignored';end if;
 raise notice 'PASS explicit QR only';
 v_named := public.admin_save_named_round_conference(null, '  Upper GI Journal Club  ', 'opportunity-order',
   v_day+32, '09:00','12:00', '10:00','12:00');
 if not exists (
   select 1 from public.resident_round_sessions s
   join public.resident_round_seat_config c on c.session_id=s.id
   join public.resident_room_layouts l on l.id=c.layout_id
   where s.id=v_named and s.conference_name='Upper GI Journal Club'
     and l.name='ห้องประชุมจริง · 64 ที่ (2569-10)'
     and c.on_time_at=((v_day+32+time '10:00') at time zone 'Asia/Bangkok')
 ) then raise exception 'named conference did not use the existing room and activity cutoff'; end if;
 begin
   perform public.admin_save_named_round_conference(null,'Overlap','opportunity-order',v_day+32,'09:30','11:00',null,null);
   raise exception 'expected overlap rejection';
 exception when others then if sqlerrm not like '%overlaps%' then raise; end if; end;
 perform public.admin_save_named_round_conference(v_named,'Upper GI Case Review','opportunity-order',v_day+32,'09:00','12:00','10:00','12:00');
 if not exists (select 1 from public.resident_round_sessions where id=v_named and conference_name='Upper GI Case Review') then
   raise exception 'conference rename changed or removed the selected round';
 end if;
 begin
   perform public.admin_save_named_round_conference(v_id,'Cannot rename main','opportunity-order',v_day+30,'10:00','13:00',null,null);
   raise exception 'renamed an unnamed main round';
 exception when others then if sqlerrm <> 'Named conference not found' then raise; end if; end;
 raise notice 'PASS named conference, existing room, distinct schedule, and same round on rename';

 select count(*) into v_n from public.resident_round_sessions;
 update public.resident_room_layouts set active=false;
 begin
   perform public.schedule_resident_round(v_day+34,'09:00','12:00','09:00','12:00',true);
   raise exception 'expected layout error';
 exception when others then if sqlerrm not like '%Layout not found%' then raise;end if;end;
 if (select count(*) from public.resident_round_sessions)<>v_n then raise exception 'partial schedule survived';end if;
 update public.resident_room_layouts set active=true;
 raise notice 'PASS missing layout rolls back entire schedule';
 perform public.reschedule_resident_round(v_id,v_day+30,'10:00','13:00','10:00','13:00',true);
 if not exists(select 1 from public.resident_round_seat_config where session_id=v_id and on_time_at=((v_day+30+time '10:00') at time zone 'Asia/Bangkok')) then raise exception 'cutoff not moved';end if;
 raise notice 'PASS reschedule moves default cutoff';
 begin perform public.reschedule_resident_round(v_id,v_day+30,'10:00','13:00','10:00','13:00',false);raise exception 'disabled map';exception when others then if sqlerrm not like '%Cannot disable%' then raise;end if;end;
 raise notice 'PASS existing map cannot be silently disabled';
 -- A live window independent of midnight and time-of-day.
 insert into public.resident_round_sessions(meeting_date,starts_at,ends_at,opened_at,opened_by) values(v_day,clock_timestamp()-interval '30 minutes',clock_timestamp()+interval '30 minutes',clock_timestamp(),auth.uid()) returning id into v_live;
 insert into public.resident_round_qr_tokens(session_id,minute_start) values(v_live,date_trunc('minute',clock_timestamp())) returning token into v_tok;
 insert into public.resident_round_sessions(conference_name,meeting_date,starts_at,ends_at,opened_at,opened_by)
   select 'Overlapping unit conference',meeting_date,starts_at,ends_at,opened_at,opened_by
   from public.resident_round_sessions where id=v_live returning id into v_parallel;
 select token into v_parallel_tok from public.admin_list_current_resident_round_qrs() where session_id=v_parallel;
 if v_parallel_tok is null or v_parallel_tok=v_tok or not exists(
   select 1 from public.admin_list_current_resident_round_qrs() where session_id=v_live and token=v_tok
 ) then raise exception 'parallel sessions did not receive independent QR tokens'; end if;
 insert into storage.objects(bucket_id,name) values
   ('resident-round-cme-qr','fixture-attendee.png'),('resident-round-cme-qr','fixture-replacement.png');
 perform public.set_resident_round_cme_attendee_qr(v_live,'fixture-attendee.png','https://score.ccme.or.th/event/fixture/audience/join');
 v_speaker_path := auth.uid()::text || '/' || v_live::text || '/speaker/fixture.png';
 insert into storage.objects(bucket_id,name) values ('resident-round-cme-qr',v_speaker_path);
 perform public.admin_set_round_cme_speaker_qr(v_live,v_speaker_path,'https://score.ccme.or.th/event/fixture/speaker/join');
 if not exists (select 1 from public.admin_get_round_cme_speaker_qr(v_live) where storage_path=v_speaker_path) then raise exception 'Admin cannot find saved speaker QR'; end if;
 begin
   perform public.admin_set_round_cme_speaker_qr(v_live,v_speaker_path,'https://score.ccme.or.th/event/fixture/audience/join');
   raise exception 'attendee link unexpectedly accepted in speaker slot';
 exception when check_violation then null; end;
 begin
   perform public.set_resident_round_cme_attendee_qr(v_live,'fixture-replacement.png','https://score.ccme.or.th/event/fixture/speaker/join');
   raise exception 'speaker url unexpectedly accepted';
 exception when check_violation then null; end;
 if has_function_privilege('anon','public.get_my_resident_round_cme_url(uuid)','EXECUTE') then raise exception 'anonymous CME leak'; end if;
 perform set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000002',true);
 if exists(select 1 from public.admin_get_round_cme_speaker_qr(v_live)) then raise exception 'speaker QR leaked to Resident'; end if;
 begin
   perform public.admin_set_round_cme_speaker_qr(v_live,null,null);
   raise exception 'resident cleared speaker QR';
 exception when others then if sqlerrm not like '%Active Admin%' then raise;end if;end;
 if public.get_my_resident_round_cme_url(v_live) is not null then raise exception 'CME link visible before check-in'; end if;
 begin
   perform public.set_resident_round_cme_attendee_qr(v_live,'fixture-replacement.png',null);
   raise exception 'resident replaced QR';
 exception when others then if sqlerrm not like '%Active Admin%' then raise;end if;end;
 begin perform public.schedule_resident_round(v_day+33,'09:00','12:00');raise exception 'resident created session';exception when others then if sqlerrm not like '%Active Admin%' then raise;end if;end;
 begin
   perform public.admin_save_named_round_conference(null,'Resident cannot create','opportunity-order',v_day+33,'09:00','10:00',null,null);
   raise exception 'Resident created named conference';
 exception when others then if sqlerrm not like '%Active Admin%' then raise; end if; end;
 raise notice 'PASS Resident cannot schedule';
 perform public.check_in_resident_round(v_tok);
 if public.get_my_resident_round_cme_url(v_live) is distinct from 'https://score.ccme.or.th/event/fixture/audience/join' then raise exception 'own check-in did not reveal correct URL'; end if;
 if public.get_my_resident_round_cme_url(v_id) is not null then raise exception 'returned CME for another round'; end if;
 if not exists(select 1 from public.my_current_resident_conference() where session_id=v_live) then
   raise exception 'current conference status did not reflect check-in';
 end if;
 begin
   perform public.check_in_resident_round(v_parallel_tok);
   raise exception 'simultaneous check-in accepted';
 exception when others then if sqlerrm <> 'ROUND_ALREADY_IN_CONFERENCE' then raise; end if; end;
 if exists(select 1 from public.resident_round_attendance where session_id=v_parallel and user_id=auth.uid()) then
   raise exception 'parallel scan wrote attendance';
 end if;

 perform set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
 if public.get_my_resident_round_cme_url(v_live) is not null then raise exception 'speaker link visible before Staff check-in'; end if;
 perform public.check_in_resident_round(v_tok);
 if public.get_my_resident_round_cme_url(v_live) is distinct from 'https://score.ccme.or.th/event/fixture/speaker/join' then raise exception 'Staff did not receive speaker link'; end if;
 update public.resident_user_roles set active=false where user_id=auth.uid();
 if public.get_my_resident_round_cme_url(v_live) is not null then raise exception 'inactive Staff received a speaker link'; end if;
 update public.resident_user_roles set active=true where user_id=auth.uid();
 raise notice 'PASS Resident and Staff check-ins resolve to their own CCME link';

 perform set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
 if public.admin_set_round_cme_speaker_qr(v_live,null,null) is distinct from v_speaker_path then raise exception 'speaker QR delete returned wrong image'; end if;
 if not exists(select 1 from public.resident_round_cme_qr where session_id=v_live and attendee_url is not null) then raise exception 'deleting the speaker QR erased the attendee link'; end if;
 perform set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
 if public.get_my_resident_round_cme_url(v_live) is not null then raise exception 'missing speaker QR fell back to the attendee URL'; end if;
 perform set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);

 perform public.set_resident_round_cme_qr(v_live,'fixture-replacement.png');
 perform set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000002',true);
 if public.get_my_resident_round_cme_url(v_live) is not null then raise exception 'stale URL survived legacy image replacement'; end if;
 raise notice 'PASS CME link restricted to the checked-in user and QR replacement clears it';
 select checked_in_at into v_before from public.resident_round_attendance where session_id=v_live and user_id=auth.uid();
 perform public.check_in_resident_round(v_tok);
 if (select checked_in_at from public.resident_round_attendance where session_id=v_live and user_id=auth.uid())<>v_before then raise exception 'duplicate scan changed time';end if;
 raise notice 'PASS late scan accepted and original timestamp preserved';
 update public.resident_round_sessions set ends_at=v_before where id=v_live;
 begin perform public.check_in_resident_round(v_tok);raise exception 'after end accepted';exception when others then if sqlerrm not like '%expired or is invalid%' then raise;end if;end;
 raise notice 'PASS after end rejected without manual close';
 perform public.check_in_resident_round(v_parallel_tok);
 if not exists(select 1 from public.my_current_resident_conference()
   where session_id=v_parallel and conference_name='Overlapping unit conference') then
   raise exception 'next room not available once the other round ended';
 end if;
 raise notice 'PASS separate QR per simultaneous round, one active membership, and matching status';

 begin perform public.admin_record_missing_round_attendance(v_live,'e0000000-0000-4000-8000-000000000002',v_before,'confirmed attendance');raise exception 'resident corrected attendance';exception when others then if sqlerrm not like '%Active Admin%' then raise;end if;end;
 raise notice 'PASS Resident cannot record missing attendance';
 perform set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
 begin perform public.admin_record_missing_round_attendance(v_live,'e0000000-0000-4000-8000-000000000002',v_before,'confirmed attendance');raise exception 'overwrite allowed';exception when others then if sqlerrm not like '%Attendance already exists%' then raise;end if;end;
 raise notice 'PASS Admin cannot overwrite QR timestamp';
 -- Another past session supports an explicitly audited forgotten scan.
 v_plain := public.schedule_resident_round(v_day-2,'09:00','12:00','09:00','12:00',false);
 begin perform public.admin_record_missing_round_attendance(v_plain,'e0000000-0000-4000-8000-000000000002',((v_day-2+time '09:17') at time zone 'Asia/Bangkok'),'');raise exception 'blank reason';exception when others then if sqlerrm not like '%Reason must%' then raise;end if;end;
 raise notice 'PASS correction requires reason';
 begin perform public.admin_record_missing_round_attendance(v_plain,'e0000000-0000-4000-8000-000000000002',((v_day-2+time '13:00') at time zone 'Asia/Bangkok'),'confirmed attendance');raise exception 'outside activity';exception when others then if sqlerrm not like '%inside the activity%' then raise;end if;end;
 raise notice 'PASS correction bounded by activity';
 perform public.admin_record_missing_round_attendance(v_plain,'e0000000-0000-4000-8000-000000000002',((v_day-2+time '09:17') at time zone 'Asia/Bangkok'),'confirmed by meeting organizer');
 if (select count(*) from public.resident_round_attendance_adjustments where session_id=v_plain and actor_id=auth.uid() and reason='confirmed by meeting organizer')<>1 then raise exception 'audit missing';end if;
 raise notice 'PASS missing attendance has actor/time/reason audit';
 if has_table_privilege('authenticated','public.resident_round_attendance_adjustments','INSERT') or has_table_privilege('service_role','public.resident_round_attendance_adjustments','UPDATE') or has_function_privilege('anon','public.schedule_resident_round(date,time,time,time,time,boolean)','EXECUTE') then raise exception 'grant leak';end if;
 raise notice 'PASS no direct audit writes or anonymous scheduler';
end $$;
set local request.jwt.claim.sub='e0000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin if exists(select 1 from public.resident_round_attendance_adjustments) then raise exception 'audit RLS leak';end if;raise notice 'PASS Resident cannot read Admin audit';end $$;
reset role;
rollback;
