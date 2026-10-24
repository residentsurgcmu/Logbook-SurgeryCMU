-- Offline synthetic fixtures ONLY. Run after the complete migration chain.
begin;
do $$ begin
  if exists (select 1 from public.resident_profiles) then
    raise exception 'Refusing grants behavior test: Resident data already exists';
  end if;
end $$;
update public.resident_maintenance_pause set paused = false where scope = 'accounts';
insert into auth.users(id,email) values
  ('d0000000-0000-4000-8000-000000000001','grant-admin@fixture.test'),
  ('d0000000-0000-4000-8000-000000000002','grant-resident@fixture.test');
insert into public.resident_profiles(user_id,full_name,email,pgy) values
  ('d0000000-0000-4000-8000-000000000001','Grant Admin','grant-admin@fixture.test',null),
  ('d0000000-0000-4000-8000-000000000002','Grant Resident','grant-resident@fixture.test',1);
insert into public.resident_user_roles(user_id,role) values
  ('d0000000-0000-4000-8000-000000000001','admin'),
  ('d0000000-0000-4000-8000-000000000002','resident');
set local request.jwt.claim.sub = 'd0000000-0000-4000-8000-000000000001';
set local role authenticated;
insert into public.resident_template_definitions(template_code,template_type,title,source_file,source_hash,score_options)
values ('PBA-99','PBA','Grant fixture','fixture.docx',repeat('a',64),'["F","M","E"]');
update public.resident_template_definitions set title='Grant fixture updated' where template_code='PBA-99';
do $$ begin
  if not exists (select 1 from public.resident_template_definitions where title='Grant fixture updated') then
    raise exception 'Admin template write/read failed without defaults';
  end if;
end $$;
reset role;
set local request.jwt.claim.sub = 'd0000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin
  if (select count(*) from public.resident_profiles) <> 1 then raise exception 'Resident own-row RLS failed'; end if;
  if not exists (select 1 from public.resident_template_definitions where template_code='PBA-99') then raise exception 'Resident template read failed'; end if;
  begin
    insert into public.resident_template_definitions(template_code,template_type,title,source_file,source_hash,score_options)
    values ('PBA-98','PBA','Forbidden','fixture.docx',repeat('b',64),'["F","M","E"]');
    raise exception 'Resident unexpectedly wrote template';
  exception when insufficient_privilege then null; end;
  begin
    update public.resident_profiles set full_name='Forbidden';
    raise exception 'Resident unexpectedly wrote account';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.rc04_revision_results;
    raise exception 'Resident unexpectedly read internal scores';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
  if (select count(*) from public.resident_profiles) <> 2 then raise exception 'Edge profile read failed'; end if;
  if (select count(*) from public.resident_user_roles) <> 2 then raise exception 'Edge role read failed'; end if;
  perform 1 from public.resident_template_definitions;
  perform 1 from public.resident_staff_directory;
  perform 1 from public.resident_assessment_requests;
  update public.resident_assessment_email_deliveries set status='failed' where false;
  begin
    perform 1 from public.rc04_revision_results;
    raise exception 'Service role unexpectedly read internal scores';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
