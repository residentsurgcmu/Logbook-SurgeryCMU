begin;

create table public.curricula (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{2,49}$'),
  class_year smallint not null check (class_year between 4 and 6),
  academic_year integer not null check (academic_year between 2500 and 2700),
  name text not null check (nullif(trim(name), '') is not null),
  pass_percent smallint not null default 80 check (pass_percent between 1 and 100),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  source_filename text,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_year, academic_year, version)
);

create table public.curriculum_activities (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curricula(id) on delete cascade,
  activity_code text not null check (activity_code ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title_th text not null check (nullif(trim(title_th), '') is not null),
  group_name text not null check (nullif(trim(group_name), '') is not null),
  target_count integer check (target_count is null or target_count > 0),
  target_unit text not null default 'ครั้ง',
  sort_order integer not null check (sort_order > 0),
  requires_patient boolean not null default false,
  requires_procedure boolean not null default false,
  requires_week boolean not null default false,
  allowed_approver_roles text[] not null default array['staff']::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (curriculum_id, activity_code),
  unique (curriculum_id, sort_order)
);

create table public.curriculum_staff_approvers (
  curriculum_id uuid not null references public.curricula(id) on delete cascade,
  staff_email text not null references public.user_directory(email) on update cascade,
  unit_name text not null check (nullif(trim(unit_name), '') is not null),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (curriculum_id, staff_email)
);

create table public.curriculum_rotations (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curricula(id) on delete cascade,
  group_code text not null check (nullif(trim(group_code), '') is not null),
  name text not null check (nullif(trim(name), '') is not null),
  start_date date not null,
  end_date date not null,
  status text not null default 'planned' check (status in ('planned', 'open', 'closed', 'archived')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint curriculum_rotation_dates check (end_date >= start_date),
  unique (curriculum_id, group_code)
);

create table public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  curriculum_id uuid not null references public.curricula(id),
  group_code text not null check (nullif(trim(group_code), '') is not null),
  rotation_id uuid references public.curriculum_rotations(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  activated_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, curriculum_id)
);

create unique index student_enrollments_one_active_idx
  on public.student_enrollments(student_id) where status = 'active';
create index student_enrollments_curriculum_group_idx
  on public.student_enrollments(curriculum_id, group_code, status);
create index student_enrollments_student_idx on public.student_enrollments(student_id, status);
create index student_enrollments_rotation_idx on public.student_enrollments(rotation_id) where rotation_id is not null;
create index student_enrollments_created_by_idx on public.student_enrollments(created_by) where created_by is not null;

create table public.student_promotion_audit (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  from_enrollment_id uuid not null references public.student_enrollments(id),
  to_enrollment_id uuid not null references public.student_enrollments(id),
  action text not null check (action in ('promote', 'rollback')),
  override_used boolean not null default false,
  reason text,
  actor_id uuid not null references public.profiles(id),
  related_promotion_id uuid references public.student_promotion_audit(id),
  created_at timestamptz not null default now(),
  constraint promotion_override_reason check (not override_used or nullif(trim(reason), '') is not null)
);

insert into public.curricula (code, class_year, academic_year, name, pass_percent, status, version)
select 'surgery-y4-' || coalesce(min(cohort_year), 2568)::text, 4, coalesce(min(cohort_year), 2568),
       'Surgery Logbook Year 4', 80, 'draft', 1
from public.profiles where role = 'student';

insert into public.curriculum_activities (
  curriculum_id, activity_code, title_th, group_name, target_count, target_unit, sort_order,
  requires_patient, requires_procedure, requires_week, allowed_approver_roles, active
)
select curriculum.id, definition.id, definition.title_th, definition.group_name, definition.target_count,
       definition.target_unit, definition.sort_order, definition.requires_patient,
       definition.requires_procedure, definition.requires_week, definition.allowed_approver_roles, definition.active
from public.year4_activity_definitions definition
cross join public.curricula curriculum
where curriculum.class_year = 4 and curriculum.version = 1;

update public.curricula set status = 'published'
where class_year = 4 and version = 1;

-- Import the supplied Year 5 source as draft data. It intentionally remains
-- unavailable for promotion until an Admin reviews and publishes it.
insert into public.curricula (
  code, class_year, academic_year, name, pass_percent, status, source_filename, version
) values (
  'surgery-y5-2569', 5, 2569, 'Surgery Logbook Year 5 · พ.ศศ.501', 80, 'draft', 'ปี 5เล่มเล็ก-2569.doc', 1
);

insert into public.curriculum_activities (
  curriculum_id, activity_code, title_th, group_name, target_count, target_unit, sort_order,
  requires_patient, requires_procedure, requires_week, allowed_approver_roles
)
select curriculum.id, seed.activity_code, seed.title_th, seed.group_name, seed.target_count,
       seed.target_unit, seed.sort_order, seed.requires_patient, seed.requires_procedure,
       seed.requires_week, array['staff']::text[]
from public.curricula curriculum
cross join (values
  ('ipd-patient-care', 'ผู้ป่วยที่ได้รับไว้ในความดูแลแบบ IPD หน่วยละ 2 ราย', 'การดูแลผู้ป่วย', 12, 'ราย', 1, true, false, true),
  ('opd-attendance', 'การเข้าเรียนที่ OPD', 'ผู้ป่วยนอก', 6, 'ครั้ง', 2, false, false, true),
  ('opd-examined-case', 'เคสที่ได้ตรวจเองที่ OPD ในสาย', 'ผู้ป่วยนอก', 10, 'ราย', 3, true, false, false),
  ('major-operation-observe', 'สังเกตการผ่าตัดใหญ่ อย่างน้อยสัปดาห์ละ 1 ราย/หน่วย', 'การผ่าตัด', 6, 'ราย', 4, true, true, true),
  ('major-operation-assist', 'ช่วยการผ่าตัดใหญ่', 'การผ่าตัด', 1, 'ราย', 5, true, true, false),
  ('minor-operation', 'สังเกตหรือช่วยการผ่าตัดเล็ก (ไม่รวมเย็บแผล)', 'การผ่าตัด', 2, 'ราย', 6, true, true, false),
  ('major-trauma-first-aid', 'First aid in major trauma', 'หัตถการ', 2, 'ราย', 7, true, true, false),
  ('wound-suture', 'เย็บแผล', 'หัตถการ', 2, 'ราย', 8, true, true, false),
  ('foley-catheter', 'ใส่ Foley catheter', 'หัตถการ', 2, 'ราย', 9, true, true, false),
  ('cvp-measurement', 'วัด Central venous pressure (CVP)', 'หัตถการ', 1, 'ราย', 10, true, true, false),
  ('er-duty', 'อยู่เวรห้องฉุกเฉิน', 'เวรและกิจกรรมหน่วย', 3, 'ครั้ง', 11, false, false, false),
  ('resident-teaching', 'การสอนของแพทย์ประจำบ้าน', 'เวรและกิจกรรมหน่วย', 6, 'ครั้ง', 12, false, false, true)
) as seed(activity_code,title_th,group_name,target_count,target_unit,sort_order,requires_patient,requires_procedure,requires_week)
where curriculum.code = 'surgery-y5-2569';

insert into public.user_directory(email,full_name,role,active)
values
  ('kaweesak.chittaw@cmu.ac.th','ศ.ดร.นพ.กวีศักดิ์ จิตตวัฒนรัตน์','staff',true),
  ('kamtone@yahoo.com','ผศ.นพ.กำธน จันทร์แจ่ม','staff',true),
  ('teang063@gmail.com','ผศ.พญ.ธิดารัตน์ จิระพงศ์เจริญลาภ','staff',true),
  ('obuea.homchan@cmu.ac.th','อ.พญ.โอบเอื้อ หอมจันทร์','staff',true),
  ('ssriplak@hotmail.com','ผศ.นพ.ศุภณ ศรีพลากิจ','staff',true),
  ('siwatphuriyaphan@gmail.com','อ.นพ.ศิวัฒม์ ภู่ริยะพันธ์','staff',true),
  ('mahawongph@gmail.com','รศ.นพ.พิษณุ มหาวงศ์','staff',true),
  ('pruitk@yahoo.com','ผศ.นพ.พฤทธ์ กิติรัตน์ตระการ','staff',true),
  ('pop_akara@hotmail.com','ผศ.นพ.อัคร อมันตกุล','staff',true),
  ('tathunya@gmail.com','ผศ.นพ.ธัญญา นรเศรษฐ์ธาดา','staff',true),
  ('jaraspong.vuthiwong@gmail.com','ผศ.ดร.นพ.จรัสพงศ์ วุฒิพงศ์','staff',true),
  ('uroaesthetic@gmail.com','อ.ดร.นพ.ธีรภัทร แสงมีอานุภาพ','staff',true),
  ('tanat.v@cmu.ac.th','ผศ.นพ.ธนัฐ วานิยะพงศ์','staff',true),
  ('doctorchumpon@gmail.com','รศ.นพ.ชุมพล เจตจำนงค์','staff',true),
  ('jvongsfak@gmail.com','ผศ.ดร.นพ.จิระพงศ์ วงศ์ฟัก','staff',true),
  ('ardious1011@gmail.com','อ.นพ.ชานน สีหะกุล','staff',true),
  ('opinchai65@gmail.com','อ.นพ.โอภาส พิณไชย','staff',true),
  ('dr.wimon.wim@gmail.com','รศ.พญ.วิมล ศิริมหาราช','staff',true),
  ('kkhwanngern@gmail.com','ผศ.นพ.กฤษณ์ ขวัญเงิน','staff',true),
  ('puttanoh@gmail.com','ผศ.พญ.พุดตาน วงศ์ตรีรัตนชัย','staff',true),
  ('sourputsa@hotmail.com','ผศ.ดร.พญ.จิรกานต์ เจริญวิชา','staff',true),
  ('thitipong_tepsuwan@yahoo.com','รศ.นพ.ธิติพงศ์ เทพสุวรรณ','staff',true),
  ('drnoppon@hotmail.com','รศ.นพ.นพพล ทักษอุดม','staff',true),
  ('armadillos176@gmail.com','ผศ.ดร.นพ.อมฤต โพธิกุล','staff',true),
  ('jak.horsatidkul@gmail.com','อ.นพ.จักรพันธ์ หอสถิตย์กุล','staff',true),
  ('drjesda@gmail.com','ผศ.นพ.เจษฎา สิงห์เวชกุล','staff',true),
  ('nanji22@gmail.com','รศ.ดร.พญ.จิราภรณ์ โกรานา','staff',true),
  ('kan_whan@yahoo.com','ผศ.พญ.กนกกาญจน์ เทพมาลัย','staff',true),
  ('karnsire196@gmail.com','ผศ.ดร.พญ.สิรีกานต์ จันทขาว','staff',true),
  ('todsapon.p@cmu.ac.th','อ.นพ.ทศพล ประภานุวัฒน์','staff',true),
  ('chollakarn.v@cmu.ac.th','อ.นพ.ชลกานต์ วโรภาษ','staff',true),
  ('mymii.ppw@gmail.com','อ.พญ.ปภาวี ศิริมหาราช','staff',true),
  ('yook14473@gmail.com','อ.นพ.สุกฤษฎิ์ สิทธิรังสรรค์','staff',true)
on conflict(email) do update set full_name=excluded.full_name,role='staff',active=true;

insert into public.curriculum_staff_approvers(curriculum_id,staff_email,unit_name)
select curriculum.id,seed.email,seed.unit_name
from public.curricula curriculum
cross join (values
  ('kaweesak.chittaw@cmu.ac.th','Trauma'),('kamtone@yahoo.com','Trauma'),('teang063@gmail.com','Trauma'),('obuea.homchan@cmu.ac.th','Trauma'),('chollakarn.v@cmu.ac.th','Trauma'),
  ('ssriplak@hotmail.com','Urology'),('siwatphuriyaphan@gmail.com','Urology'),('mahawongph@gmail.com','Urology'),('pruitk@yahoo.com','Urology'),('pop_akara@hotmail.com','Urology'),('jaraspong.vuthiwong@gmail.com','Urology'),('uroaesthetic@gmail.com','Urology'),
  ('tathunya@gmail.com','Neuro Surgery'),('tanat.v@cmu.ac.th','Neuro Surgery'),('doctorchumpon@gmail.com','Neuro Surgery'),('jvongsfak@gmail.com','Neuro Surgery'),('ardious1011@gmail.com','Neuro Surgery'),('todsapon.p@cmu.ac.th','Neuro Surgery'),
  ('opinchai65@gmail.com','Plastic Surgery'),('dr.wimon.wim@gmail.com','Plastic Surgery'),('kkhwanngern@gmail.com','Plastic Surgery'),('puttanoh@gmail.com','Plastic Surgery'),('sourputsa@hotmail.com','Plastic Surgery'),('mymii.ppw@gmail.com','Plastic Surgery'),
  ('thitipong_tepsuwan@yahoo.com','CVT'),('drnoppon@hotmail.com','CVT'),('armadillos176@gmail.com','CVT'),('jak.horsatidkul@gmail.com','CVT'),
  ('drjesda@gmail.com','Pediatric Surgery'),('nanji22@gmail.com','Pediatric Surgery'),('kan_whan@yahoo.com','Pediatric Surgery'),('karnsire196@gmail.com','Pediatric Surgery'),('yook14473@gmail.com','Pediatric Surgery')
) as seed(email,unit_name)
where curriculum.code='surgery-y5-2569';

insert into public.curriculum_staff_approvers(curriculum_id,staff_email,unit_name)
select curriculum.id,directory.email,'Year 4'
from public.curricula curriculum cross join public.user_directory directory
where curriculum.class_year=4 and directory.role='staff' and directory.active=true
on conflict(curriculum_id,staff_email) do nothing;

insert into public.student_enrollments (student_id, curriculum_id, group_code, status, activated_at)
select profile.id, curriculum.id, coalesce(nullif(profile.student_group, ''), '1'), 'active', profile.created_at
from public.profiles profile
join public.curricula curriculum on curriculum.class_year = 4 and curriculum.academic_year = profile.cohort_year and curriculum.version = 1
where profile.role = 'student' and profile.active = true;

-- Backfill system-managed foreign keys without invoking the legacy Year 4
-- review/certification guards. All user triggers are re-enabled below after
-- their functions have been replaced with the multi-curriculum versions.
alter table public.year4_logbook_entries disable trigger user;
alter table public.year4_approval_events disable trigger user;
alter table public.year4_logbook_certifications disable trigger user;

alter table public.year4_logbook_entries
  add column enrollment_id uuid references public.student_enrollments(id),
  add column curriculum_activity_id uuid references public.curriculum_activities(id),
  add column curriculum_rotation_id uuid references public.curriculum_rotations(id) on delete set null;

update public.year4_logbook_entries entry
set enrollment_id = enrollment.id,
    curriculum_activity_id = activity.id
from public.student_enrollments enrollment
join public.curriculum_activities activity on activity.curriculum_id = enrollment.curriculum_id
where enrollment.student_id = entry.student_id
  and activity.activity_code = entry.activity_type;

alter table public.year4_logbook_entries
  alter column enrollment_id set not null,
  alter column curriculum_activity_id set not null;

alter table public.year4_approval_events add column enrollment_id uuid references public.student_enrollments(id);
update public.year4_approval_events event
set enrollment_id = entry.enrollment_id
from public.year4_logbook_entries entry where entry.id = event.entry_id;
alter table public.year4_approval_events alter column enrollment_id set not null;

alter table public.year4_logbook_certifications
  add column enrollment_id uuid references public.student_enrollments(id),
  add column curriculum_rotation_id uuid references public.curriculum_rotations(id) on delete set null;
update public.year4_logbook_certifications certification
set enrollment_id = enrollment.id
from public.student_enrollments enrollment
where enrollment.student_id = certification.student_id
  and certification.academic_year = (select academic_year from public.curricula where id = enrollment.curriculum_id);
alter table public.year4_logbook_certifications alter column enrollment_id set not null;
alter table public.year4_logbook_certifications drop constraint year4_certification_unique;
alter table public.year4_logbook_certifications add constraint logbook_certification_enrollment_unique unique (enrollment_id);

create index logbook_entries_enrollment_status_idx on public.year4_logbook_entries(enrollment_id, status, activity_date desc);
create index logbook_entries_curriculum_activity_idx on public.year4_logbook_entries(curriculum_activity_id, status);
create index logbook_entries_curriculum_rotation_idx on public.year4_logbook_entries(curriculum_rotation_id) where curriculum_rotation_id is not null;
create index approval_events_enrollment_idx on public.year4_approval_events(enrollment_id, created_at desc);
create index certifications_enrollment_idx on public.year4_logbook_certifications(enrollment_id, status);
create index certifications_curriculum_rotation_idx on public.year4_logbook_certifications(curriculum_rotation_id) where curriculum_rotation_id is not null;
create index curriculum_activities_curriculum_idx on public.curriculum_activities(curriculum_id, active, sort_order);
create index curriculum_staff_approvers_email_idx on public.curriculum_staff_approvers(staff_email) where active;
create index curriculum_rotations_curriculum_idx on public.curriculum_rotations(curriculum_id, status, group_code);
create index curriculum_rotations_created_by_idx on public.curriculum_rotations(created_by) where created_by is not null;
create index curricula_created_by_idx on public.curricula(created_by) where created_by is not null;
create index promotion_audit_student_idx on public.student_promotion_audit(student_id, created_at desc);
create index promotion_audit_from_enrollment_idx on public.student_promotion_audit(from_enrollment_id);
create index promotion_audit_to_enrollment_idx on public.student_promotion_audit(to_enrollment_id);
create index promotion_audit_actor_idx on public.student_promotion_audit(actor_id);
create index promotion_audit_related_idx on public.student_promotion_audit(related_promotion_id) where related_promotion_id is not null;

create trigger curricula_touch_updated_at before update on public.curricula
for each row execute function private.touch_updated_at();
create trigger curriculum_rotations_touch_updated_at before update on public.curriculum_rotations
for each row execute function private.touch_updated_at();
create trigger student_enrollments_touch_updated_at before update on public.student_enrollments
for each row execute function private.touch_updated_at();

create or replace function private.is_active_enrollment(target_enrollment uuid, target_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.student_enrollments enrollment
    join public.curricula curriculum on curriculum.id = enrollment.curriculum_id
    where enrollment.id = target_enrollment and enrollment.student_id = target_student
      and enrollment.status = 'active' and curriculum.status = 'published'
  );
$$;
revoke all on function private.is_active_enrollment(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_active_enrollment(uuid, uuid) to authenticated;

create or replace function private.validate_curriculum_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if not exists (select 1 from public.curriculum_activities where curriculum_id = new.id and active = true) then
      raise exception 'Published curriculum must contain active activities';
    end if;
    if coalesce((select sum(target_count) from public.curriculum_activities where curriculum_id = new.id and active = true), 0) <= 0 then
      raise exception 'Published curriculum must contain measurable targets';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_curriculum_status() from public, anon, authenticated;
create trigger curricula_validate_status before update on public.curricula
for each row execute function private.validate_curriculum_status();

create or replace function private.enroll_waiting_year4_students()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='published' and new.class_year=4 and old.status is distinct from 'published' then
    insert into public.student_enrollments(student_id,curriculum_id,group_code,status,activated_at,created_by)
    select profile.id,new.id,coalesce(nullif(profile.student_group,''),'1'),'active',statement_timestamp(),new.created_by
    from public.profiles profile
    where profile.role='student' and profile.active=true and profile.cohort_year=new.academic_year
      and not exists(select 1 from public.student_enrollments where student_id=profile.id and status='active')
    on conflict(student_id,curriculum_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.enroll_waiting_year4_students() from public,anon,authenticated;
create trigger curricula_enroll_waiting_students after update on public.curricula
for each row execute function private.enroll_waiting_year4_students();

create or replace function private.enroll_new_student_if_curriculum_ready()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_curriculum uuid;
begin
  if new.role<>'student' or not new.active then return new; end if;
  select id into target_curriculum from public.curricula
  where class_year=4 and academic_year=new.cohort_year and status='published'
  order by version desc limit 1;
  if target_curriculum is not null then
    insert into public.student_enrollments(student_id,curriculum_id,group_code,status,activated_at)
    values(new.id,target_curriculum,coalesce(nullif(new.student_group,''),'1'),'active',statement_timestamp())
    on conflict(student_id,curriculum_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.enroll_new_student_if_curriculum_ready() from public,anon,authenticated;
create trigger profiles_enroll_new_student after insert on public.profiles
for each row execute function private.enroll_new_student_if_curriculum_ready();

create or replace function private.protect_published_curriculum_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_curriculum uuid;
begin
  target_curriculum = coalesce(new.curriculum_id, old.curriculum_id);
  if exists (select 1 from public.curricula where id = target_curriculum and status <> 'draft') then
    raise exception 'Only draft curriculum activities can be changed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.protect_published_curriculum_activity() from public, anon, authenticated;
create trigger curriculum_activities_protect before insert or update or delete on public.curriculum_activities
for each row execute function private.protect_published_curriculum_activity();

create or replace function private.assign_year4_entry_context()
returns trigger language plpgsql security definer set search_path = '' as $$
declare active_enrollment public.student_enrollments%rowtype;
begin
  select * into active_enrollment from public.student_enrollments
  where student_id = new.student_id and status = 'active' limit 1;
  if not found then raise exception 'Student has no active curriculum enrollment'; end if;
  new.enrollment_id = active_enrollment.id;
  select id into new.curriculum_activity_id from public.curriculum_activities
  where curriculum_id = active_enrollment.curriculum_id and activity_code = new.activity_type and active = true;
  if new.curriculum_activity_id is null then raise exception 'Activity is not available in active curriculum'; end if;
  new.academic_year = (select academic_year from public.curricula where id = active_enrollment.curriculum_id);
  select id into new.curriculum_rotation_id from public.curriculum_rotations
  where curriculum_id = active_enrollment.curriculum_id and group_code = active_enrollment.group_code
    and new.activity_date between start_date and end_date and status in ('open','closed')
  order by start_date desc limit 1;
  return new;
end;
$$;
revoke all on function private.assign_year4_entry_context() from public, anon, authenticated;
drop trigger year4_assign_entry_context on public.year4_logbook_entries;
create trigger year4_assign_entry_context before insert or update of student_id,activity_type on public.year4_logbook_entries
for each row execute function private.assign_year4_entry_context();

create or replace function private.validate_year4_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare definition public.curriculum_activities%rowtype; staff_name text; active_staff_profile_id uuid;
begin
  if new.status = 'draft' then new.submitted_at = null; new.approved_at = null; return new; end if;
  if tg_op = 'INSERT' and new.status = 'submitted' then new.submitted_at = statement_timestamp();
  elsif tg_op = 'UPDATE' then
    if new.status = 'submitted' and old.status is distinct from 'submitted' then new.submitted_at = statement_timestamp(); end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then new.approved_at = statement_timestamp(); end if;
  end if;
  select directory.full_name, profile.id into staff_name, active_staff_profile_id
  from public.user_directory directory left join public.profiles profile
    on profile.email = directory.email and profile.role = 'staff' and profile.active = true
  where directory.email = lower(new.selected_approver_email) and directory.role = 'staff' and directory.active = true;
  if staff_name is null then raise exception 'Selected approver must be on the active Staff allowlist'; end if;
  select * into definition from public.curriculum_activities where id = new.curriculum_activity_id and active = true;
  if not found then raise exception 'Activity definition is not active'; end if;
  if exists(select 1 from public.curriculum_staff_approvers where curriculum_id=definition.curriculum_id and active=true)
     and not exists(select 1 from public.curriculum_staff_approvers where curriculum_id=definition.curriculum_id and staff_email=lower(new.selected_approver_email) and active=true)
  then raise exception 'Selected approver is not assigned to this curriculum'; end if;
  new.selected_approver_email = lower(new.selected_approver_email); new.selected_approver_id = active_staff_profile_id;
  if nullif(trim(new.detail), '') is null then raise exception 'Activity detail is required before submission'; end if;
  if definition.requires_week and new.week_number is null then raise exception 'Week number is required for this activity'; end if;
  if definition.requires_patient and nullif(trim(new.patient_reference), '') is null then raise exception 'Patient reference is required for this activity'; end if;
  if definition.requires_procedure and nullif(trim(new.procedure_name), '') is null then raise exception 'Procedure is required for this activity'; end if;
  new.supervisor_name = staff_name; return new;
end;
$$;
revoke all on function private.validate_year4_submission() from public, anon, authenticated;

create or replace function private.protect_certified_year4_logbook()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select private.is_admin()) then return new; end if;
  if exists (select 1 from public.year4_logbook_certifications where enrollment_id = new.enrollment_id and status = 'certified') then
    raise exception 'Logbook is certified and locked';
  end if;
  if tg_op = 'UPDATE' and (new.enrollment_id is distinct from old.enrollment_id
     or (new.curriculum_activity_id is distinct from old.curriculum_activity_id and new.activity_type is not distinct from old.activity_type)) then
    raise exception 'Curriculum enrollment is system managed';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_certified_year4_logbook() from public, anon, authenticated;

create or replace function private.capture_year4_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.year4_approval_events (entry_id, student_id, enrollment_id, actor_id, from_status, to_status, comment, revision)
    values (new.id, new.student_id, new.enrollment_id, (select auth.uid()), old.status, new.status, new.approver_comment, new.revision);
  end if;
  return new;
end;
$$;
revoke all on function private.capture_year4_status_change() from public, anon, authenticated;

create or replace function private.validate_year4_certification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare required_total integer; completed_total integer; threshold integer;
begin
  if tg_op = 'INSERT' then
    if new.student_id <> (select auth.uid()) then raise exception 'Student can submit own certification only'; end if;
    select id into new.enrollment_id from public.student_enrollments where student_id = new.student_id and status = 'active';
    if new.enrollment_id is null then raise exception 'Student has no active enrollment'; end if;
    new.academic_year = (select curriculum.academic_year from public.student_enrollments enrollment join public.curricula curriculum on curriculum.id=enrollment.curriculum_id where enrollment.id=new.enrollment_id);
  elsif old.student_id = (select auth.uid()) then
    if old.status not in ('returned','reopened') or new.status <> 'submitted' then raise exception 'Invalid student certification transition'; end if;
  elsif (select private.is_staff()) then
    if not (select private.is_selected_staff(old.selected_certifier_email)) then raise exception 'Only selected Staff can certify'; end if;
    if old.status <> 'submitted' or new.status not in ('certified','returned') then raise exception 'Invalid certification transition'; end if;
    if new.status = 'certified' then new.certified_by=(select auth.uid()); new.certified_at=statement_timestamp(); else new.certified_by=null; new.certified_at=null; end if;
    return new;
  elsif (select private.is_admin()) then
    if new.status <> 'reopened' then raise exception 'Admin can reopen certification only'; end if;
    new.certified_by=null; new.certified_at=null; return new;
  else raise exception 'Certification update is not allowed'; end if;
  if not (select private.is_active_enrollment(new.enrollment_id,new.student_id)) then raise exception 'Certification requires active enrollment'; end if;
  if not (select private.is_active_staff_email(new.selected_certifier_email)) then raise exception 'Certifier must be active Staff'; end if;
  if exists(select 1 from public.curriculum_staff_approvers where curriculum_id=(select curriculum_id from public.student_enrollments where id=new.enrollment_id) and active=true)
     and not exists(select 1 from public.curriculum_staff_approvers where curriculum_id=(select curriculum_id from public.student_enrollments where id=new.enrollment_id) and staff_email=lower(new.selected_certifier_email) and active=true)
  then raise exception 'Certifier is not assigned to this curriculum'; end if;
  select coalesce(sum(activity.target_count),0), curriculum.pass_percent into required_total,threshold
  from public.student_enrollments enrollment join public.curricula curriculum on curriculum.id=enrollment.curriculum_id
  join public.curriculum_activities activity on activity.curriculum_id=curriculum.id and activity.active=true
  where enrollment.id=new.enrollment_id group by curriculum.pass_percent;
  select coalesce(sum(least(counted.activity_count,counted.target_count)),0) into completed_total from (
    select activity.target_count,count(entry.id)::integer activity_count from public.curriculum_activities activity
    left join public.year4_logbook_entries entry on entry.curriculum_activity_id=activity.id and entry.enrollment_id=new.enrollment_id and entry.status='approved'
    where activity.curriculum_id=(select curriculum_id from public.student_enrollments where id=new.enrollment_id) and activity.active=true and activity.target_count is not null
    group by activity.id,activity.target_count
  ) counted;
  if required_total=0 or completed_total < ceil(required_total*threshold/100.0) then raise exception 'Logbook progress must reach curriculum threshold'; end if;
  if exists(select 1 from public.year4_logbook_entries where enrollment_id=new.enrollment_id and status in ('submitted','rejected')) then raise exception 'Resolve pending or returned entries before certification'; end if;
  new.status='submitted'; new.submitted_at=statement_timestamp(); new.certified_by=null; new.certified_at=null; new.certifier_note=null; return new;
end;
$$;
revoke all on function private.validate_year4_certification() from public, anon, authenticated;

alter table public.year4_logbook_entries enable trigger user;
alter table public.year4_approval_events enable trigger user;
alter table public.year4_logbook_certifications enable trigger user;

alter table public.curricula enable row level security;
alter table public.curriculum_activities enable row level security;
alter table public.curriculum_staff_approvers enable row level security;
alter table public.curriculum_rotations enable row level security;
alter table public.student_enrollments enable row level security;
alter table public.student_promotion_audit enable row level security;

create policy curricula_select on public.curricula for select to authenticated using (
  (select private.is_staff()) or (select private.is_admin()) or (status='published' and exists(select 1 from public.student_enrollments where curriculum_id=curricula.id and student_id=(select auth.uid()) and status='active'))
);
create policy curricula_admin_insert on public.curricula for insert to authenticated with check ((select private.is_admin()) and created_by=(select auth.uid()));
create policy curricula_admin_update on public.curricula for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy curriculum_activities_select on public.curriculum_activities for select to authenticated using (
  (select private.is_staff()) or (select private.is_admin()) or exists(select 1 from public.student_enrollments where curriculum_id=curriculum_activities.curriculum_id and student_id=(select auth.uid()) and status='active')
);
create policy curriculum_activities_admin_insert on public.curriculum_activities for insert to authenticated with check ((select private.is_admin()));
create policy curriculum_activities_admin_update on public.curriculum_activities for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy curriculum_activities_admin_delete on public.curriculum_activities for delete to authenticated using ((select private.is_admin()));
create policy curriculum_staff_approvers_select on public.curriculum_staff_approvers for select to authenticated using (
  active and ((select private.is_staff()) or (select private.is_admin()) or exists(
    select 1 from public.student_enrollments where curriculum_id=curriculum_staff_approvers.curriculum_id and student_id=(select auth.uid()) and status='active'
  ))
);
create policy curriculum_staff_approvers_admin_insert on public.curriculum_staff_approvers for insert to authenticated with check ((select private.is_admin()));
create policy curriculum_staff_approvers_admin_update on public.curriculum_staff_approvers for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy curriculum_staff_approvers_admin_delete on public.curriculum_staff_approvers for delete to authenticated using ((select private.is_admin()));
create policy curriculum_rotations_select on public.curriculum_rotations for select to authenticated using (
  (select private.is_staff()) or (select private.is_admin()) or exists(select 1 from public.student_enrollments where curriculum_id=curriculum_rotations.curriculum_id and student_id=(select auth.uid()) and status='active')
);
create policy curriculum_rotations_admin_insert on public.curriculum_rotations for insert to authenticated with check ((select private.is_admin()));
create policy curriculum_rotations_admin_update on public.curriculum_rotations for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy curriculum_rotations_admin_delete on public.curriculum_rotations for delete to authenticated using ((select private.is_admin()));
create policy student_enrollments_select on public.student_enrollments for select to authenticated using (
  (student_id=(select auth.uid()) and status='active') or (select private.is_staff()) or (select private.is_admin())
);
create policy promotion_audit_admin_select on public.student_promotion_audit for select to authenticated using ((select private.is_admin()));

drop policy year4_entries_select on public.year4_logbook_entries;
create policy year4_entries_select on public.year4_logbook_entries for select to authenticated using (
  (student_id=(select auth.uid()) and (select private.is_active_enrollment(enrollment_id,student_id))) or (select private.is_staff()) or (select private.is_admin())
);
drop policy year4_entries_student_insert on public.year4_logbook_entries;
create policy year4_entries_student_insert on public.year4_logbook_entries for insert to authenticated with check (
  student_id=(select auth.uid()) and recorded_by=(select auth.uid()) and status in ('draft','submitted')
  and (select private.is_active_enrollment(enrollment_id,student_id)) and (select private.is_active_staff_email(selected_approver_email))
  and approved_by is null and approved_at is null and approver_comment is null and onedrive_sync_status='not_required'
);
drop policy year4_entries_student_update on public.year4_logbook_entries;
create policy year4_entries_student_update on public.year4_logbook_entries for update to authenticated using (
  student_id=(select auth.uid()) and status in ('draft','rejected') and (select private.is_active_enrollment(enrollment_id,student_id))
) with check (
  student_id=(select auth.uid()) and recorded_by=(select auth.uid()) and status in ('draft','submitted')
  and (select private.is_active_enrollment(enrollment_id,student_id)) and approved_by is null and approved_at is null and approver_comment is null
);
drop policy year4_events_select on public.year4_approval_events;
create policy year4_events_select on public.year4_approval_events for select to authenticated using (
  (student_id=(select auth.uid()) and (select private.is_active_enrollment(enrollment_id,student_id))) or (select private.is_staff()) or (select private.is_admin())
);
drop policy year4_certifications_select on public.year4_logbook_certifications;
create policy year4_certifications_select on public.year4_logbook_certifications for select to authenticated using (
  (student_id=(select auth.uid()) and (select private.is_active_enrollment(enrollment_id,student_id))) or (select private.is_staff()) or (select private.is_admin())
);

revoke all on public.curricula,public.curriculum_activities,public.curriculum_staff_approvers,public.curriculum_rotations,public.student_enrollments,public.student_promotion_audit from anon,authenticated;
grant select on public.curricula,public.curriculum_activities,public.curriculum_staff_approvers,public.curriculum_rotations,public.student_enrollments to authenticated;
grant insert,update on public.curricula to authenticated;
grant insert,update,delete on public.curriculum_activities,public.curriculum_rotations to authenticated;
grant insert,update,delete on public.curriculum_staff_approvers to authenticated;
grant select on public.student_promotion_audit to authenticated;

create or replace function public.admin_replace_curriculum_activities(p_curriculum_id uuid,p_activities jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare imported_count integer;
begin
  if not exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and active=true) then raise exception 'Admin authorization required'; end if;
  if not exists(select 1 from public.curricula where id=p_curriculum_id and status='draft') then raise exception 'Only draft curriculum can be imported'; end if;
  if jsonb_typeof(p_activities)<>'array' or jsonb_array_length(p_activities)=0 then raise exception 'Curriculum activities are required'; end if;
  delete from public.curriculum_activities where curriculum_id=p_curriculum_id;
  insert into public.curriculum_activities(
    curriculum_id,activity_code,title_th,group_name,target_count,target_unit,sort_order,
    requires_patient,requires_procedure,requires_week,allowed_approver_roles,active
  )
  select p_curriculum_id,trim(row.activity_code),trim(row.title_th),trim(row.group_name),row.target_count,
         coalesce(nullif(trim(row.target_unit),''),'ครั้ง'),row.sort_order,row.requires_patient,
         row.requires_procedure,row.requires_week,array['staff']::text[],true
  from jsonb_to_recordset(p_activities) as row(
    activity_code text,title_th text,group_name text,target_count integer,target_unit text,sort_order integer,
    requires_patient boolean,requires_procedure boolean,requires_week boolean
  );
  get diagnostics imported_count=row_count;
  return jsonb_build_object('ok',true,'importedCount',imported_count);
end;
$$;
revoke all on function public.admin_replace_curriculum_activities(uuid,jsonb) from public,anon;
grant execute on function public.admin_replace_curriculum_activities(uuid,jsonb) to authenticated;

create or replace function public.admin_promote_students(
  p_actor_id uuid,p_student_ids uuid[],p_destination_curriculum_id uuid,p_group_code text,p_rotation_id uuid default null,p_override boolean default false,p_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare destination public.curricula%rowtype; source public.student_enrollments%rowtype; student uuid; destination_enrollment uuid; promoted integer:=0;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin' and active=true) then raise exception 'Admin authorization required'; end if;
  select * into destination from public.curricula where id=p_destination_curriculum_id and status='published';
  if not found then raise exception 'Destination curriculum must be published'; end if;
  if nullif(trim(p_group_code),'') is null then raise exception 'Destination group is required'; end if;
  if p_rotation_id is not null and not exists(select 1 from public.curriculum_rotations where id=p_rotation_id and curriculum_id=destination.id) then raise exception 'Rotation does not belong to destination curriculum'; end if;
  if p_override and nullif(trim(p_reason),'') is null then raise exception 'Override reason is required'; end if;
  foreach student in array p_student_ids loop
    select enrollment.* into source from public.student_enrollments enrollment where enrollment.student_id=student and enrollment.status='active' for update;
    if not found then raise exception 'Student % has no active enrollment',student; end if;
    if destination.class_year <> (select class_year+1 from public.curricula where id=source.curriculum_id) then raise exception 'Destination curriculum must be next class year'; end if;
    if not exists(select 1 from public.year4_logbook_certifications where enrollment_id=source.id and status='certified') and not p_override then raise exception 'Student % logbook is not certified',student; end if;
    update public.student_enrollments set status='completed',completed_at=statement_timestamp() where id=source.id;
    insert into public.student_enrollments(student_id,curriculum_id,group_code,rotation_id,status,created_by)
    values(student,destination.id,trim(p_group_code),p_rotation_id,'active',p_actor_id)
    on conflict(student_id,curriculum_id) do update set group_code=excluded.group_code,rotation_id=excluded.rotation_id,status='active',completed_at=null,created_by=p_actor_id
    returning id into destination_enrollment;
    insert into public.student_promotion_audit(student_id,from_enrollment_id,to_enrollment_id,action,override_used,reason,actor_id)
    values(student,source.id,destination_enrollment,'promote',p_override,nullif(trim(p_reason),''),p_actor_id);
    promoted:=promoted+1;
  end loop;
  return jsonb_build_object('ok',true,'promotedCount',promoted);
end;
$$;
revoke all on function public.admin_promote_students(uuid,uuid[],uuid,text,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.admin_promote_students(uuid,uuid[],uuid,text,uuid,boolean,text) to service_role;

create or replace function public.admin_rollback_promotion(p_actor_id uuid,p_promotion_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare promotion public.student_promotion_audit%rowtype;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin' and active=true) then raise exception 'Admin authorization required'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Rollback reason is required'; end if;
  select * into promotion from public.student_promotion_audit where id=p_promotion_id and action='promote' for update;
  if not found then raise exception 'Promotion not found'; end if;
  if exists(select 1 from public.year4_logbook_entries where enrollment_id=promotion.to_enrollment_id) then raise exception 'Cannot rollback after destination logbook has entries'; end if;
  update public.student_enrollments set status='archived' where id=promotion.to_enrollment_id;
  update public.student_enrollments set status='active',completed_at=null where id=promotion.from_enrollment_id;
  insert into public.student_promotion_audit(student_id,from_enrollment_id,to_enrollment_id,action,reason,actor_id,related_promotion_id)
  values(promotion.student_id,promotion.from_enrollment_id,promotion.to_enrollment_id,'rollback',trim(p_reason),p_actor_id,promotion.id);
  return jsonb_build_object('ok',true,'studentId',promotion.student_id);
end;
$$;
revoke all on function public.admin_rollback_promotion(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_rollback_promotion(uuid,uuid,text) to service_role;

do $$
begin
  if (select count(*) from public.curriculum_activities activity join public.curricula curriculum on curriculum.id=activity.curriculum_id where curriculum.class_year=4)
     <> (select count(*) from public.year4_activity_definitions) then raise exception 'Activity reconciliation failed'; end if;
  if (select count(*) from public.curriculum_activities activity join public.curricula curriculum on curriculum.id=activity.curriculum_id where curriculum.code='surgery-y5-2569') <> 12 then raise exception 'Year 5 draft activity reconciliation failed'; end if;
  if (select count(*) from public.curriculum_staff_approvers approver join public.curricula curriculum on curriculum.id=approver.curriculum_id where curriculum.code='surgery-y5-2569' and approver.active) <> 33 then raise exception 'Year 5 approver reconciliation failed'; end if;
  if exists(select 1 from public.year4_logbook_entries where enrollment_id is null or curriculum_activity_id is null) then raise exception 'Entry reconciliation failed'; end if;
  if exists(select 1 from public.year4_approval_events where enrollment_id is null) then raise exception 'Approval event reconciliation failed'; end if;
  if exists(select 1 from public.year4_logbook_certifications where enrollment_id is null) then raise exception 'Certification reconciliation failed'; end if;
end;
$$;

commit;
