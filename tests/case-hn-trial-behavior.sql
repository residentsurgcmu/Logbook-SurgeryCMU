begin;
do $$ begin if exists(select 1 from public.resident_profiles) then raise exception 'Refusing nonempty fixture database';end if;end $$;
update public.resident_maintenance_pause set paused=false where scope='accounts';
insert into auth.users(id,email)
select ('ac000000-0000-4000-8000-00000000000'||n)::uuid,'hn-'||n||'@fixture.test' from generate_series(1,5) n;
insert into public.resident_profiles(user_id,full_name,email,pgy)
select id,'HN trial fixture',email,case when email in ('hn-1@fixture.test','hn-2@fixture.test') then 1 end from auth.users;
insert into public.resident_user_roles(user_id,role)
select id,case when email in ('hn-1@fixture.test','hn-2@fixture.test') then 'resident'
  when email='hn-5@fixture.test' then 'admin' else 'staff' end::public.resident_system_role from auth.users;
insert into public.resident_admission_cases(id,admit_date,age_years,sex,diagnosis,unit_name,owner_id,created_by,updated_by)
select ('ac100000-0000-4000-8000-00000000000'||n)::uuid,current_date,40,'unspecified','Synthetic test case','Upper GI',
'ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000001'
from generate_series(1,2) n;

revoke usage on schema private from authenticated;
set local role authenticated;
set local request.jwt.claim.sub='ac000000-0000-4000-8000-000000000001';
do $$ begin
  if public.rc_hn_case_trial('ac100000-0000-4000-8000-000000000001','status') is not null then raise exception 'default enabled';end if;
end $$;
reset role;
insert into private.rc_hn_trial_config(public_spki) values (repeat('P',564));
insert into private.rc_hn_trial_cases values ('ac100000-0000-4000-8000-000000000001');
insert into private.rc_hn_trial_moderators values ('ac000000-0000-4000-8000-000000000003');
set local role authenticated;
do $$
declare c uuid:='ac100000-0000-4000-8000-000000000001'; r jsonb; kid text; u int;
begin
  r:=public.rc_hn_case_trial(c,'status');
  if (r->>'canWrite') is distinct from 'true' or (r->>'revision') is distinct from '0' or r ? 'ciphertext' then raise exception 'owner status';end if;
  kid:=r->'publicKey'->>'keyId';
  if kid is null then raise exception 'no configured key';end if;
  begin perform public.rc_hn_case_trial(c,'save',kid,'DEMO-123456',0);raise exception 'plaintext accepted';exception when invalid_parameter_value then null;end;
  begin perform public.rc_hn_case_trial(c,'save',repeat('0',64),repeat('A',512),0);raise exception 'wrong key accepted';exception when invalid_parameter_value then null;end;
  r:=public.rc_hn_case_trial(c,'save',kid,repeat('A',512),0);
  if (r->>'revision') is distinct from '1' or r ? 'ciphertext' then raise exception 'save result';end if;
  begin perform public.rc_hn_case_trial(c,'save',kid,repeat('B',512),0);raise exception 'stale write';exception when serialization_failure then null;end;
  r:=public.rc_hn_case_trial(c,'save',kid,repeat('B',512),1);
  if (r->>'revision') is distinct from '2' then raise exception 'replacement failed';end if;
  if public.rc_hn_case_trial('ac100000-0000-4000-8000-000000000002','status') is not null then raise exception 'unlisted case';end if;
  for u in 1..5 loop
    perform set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-00000000000'||u,true);
    begin
      r:=public.rc_hn_case_trial(c,'download');
      raise exception 'browser export allowed %',u;
    exception when insufficient_privilege then null;end;
    if u<>1 then
      begin perform public.rc_hn_case_trial(c,'save',kid,repeat('C',512),2);raise exception 'non-owner saved';exception when insufficient_privilege then null;end;
      r:=public.rc_hn_case_trial(c,'status');
      if (r->>'saved') is distinct from 'true' or r ? 'ciphertext' or r ? 'canDownload' or r->>'publicKey' is not null or r->>'revision' is not null then raise exception 'status leak';end if;
    end if;
  end loop;
  begin perform 1 from private.rc_hn_trial_records;raise exception 'direct authenticated read';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$
declare
  c uuid:='ac100000-0000-4000-8000-000000000001';
  other uuid:='ac100000-0000-4000-8000-000000000002';
  r jsonb;
begin
  r:=private.rc_hn_trial_export_bundle(array[c]);
  if r->>'type' is distinct from 'trial-bundle' or jsonb_array_length(r->'records')<>1
    or r->'records'->0->>'caseUuid' is distinct from c::text
    or r->'records'->0->>'ciphertext' is distinct from repeat('B',512) then raise exception 'wrong operator bundle';end if;
  begin perform private.rc_hn_trial_export_bundle(array[c,other]);raise exception 'partial export accepted';exception when invalid_parameter_value then null;end;
  begin perform private.rc_hn_trial_export_bundle(array[c,c]);raise exception 'duplicate case accepted';exception when invalid_parameter_value then null;end;
  begin perform private.rc_hn_trial_export_bundle(array[c,null]);raise exception 'null case accepted';exception when invalid_parameter_value then null;end;
  begin perform private.rc_hn_trial_export_bundle(null);raise exception 'empty list accepted';exception when invalid_parameter_value then null;end;
  begin perform private.rc_hn_trial_export_bundle(array_fill(c,array[51]));raise exception 'unbounded bundle accepted';exception when invalid_parameter_value then null;end;
  if exists(select 1 from (values ('anon'),('authenticated'),('service_role')) as roles(name)
    where has_function_privilege(name,'private.rc_hn_trial_export_bundle(uuid[])','execute')) then raise exception 'operator function privilege leak';end if;
end $$;
update public.resident_admission_cases set deleted_at=now() where id='ac100000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub='ac000000-0000-4000-8000-000000000001';
do $$ begin
  if public.rc_hn_case_trial('ac100000-0000-4000-8000-000000000001','status') is not null then raise exception 'deleted case visible';end if;
end $$;
reset role;
do $$ begin
  begin perform private.rc_hn_trial_export_bundle(array['ac100000-0000-4000-8000-000000000001'::uuid]);raise exception 'deleted case exported';exception when invalid_parameter_value then null;end;
end $$;
delete from public.resident_admission_cases where id='ac100000-0000-4000-8000-000000000001';
do $$ begin
  if exists(select 1 from private.rc_hn_trial_records) then raise exception 'purge left ciphertext';end if;
  if has_table_privilege('authenticated','private.rc_hn_trial_records','select')
    or has_table_privilege('service_role','private.rc_hn_trial_records','select')
    or has_function_privilege('anon','public.rc_hn_case_trial(uuid,text,text,text,integer)','execute') then raise exception 'excess grant';end if;
end $$;
rollback;
