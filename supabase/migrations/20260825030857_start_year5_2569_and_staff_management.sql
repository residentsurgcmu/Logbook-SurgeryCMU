begin;

-- Academic year 2569 starts with Year 5. The source is the supplied
-- `ปี 5เล่มเล็ก-2569.doc`; keep the activity codes stable because logbook
-- entries and exports use them as durable identifiers.
insert into public.curricula (
  code, class_year, academic_year, name, pass_percent, status, source_filename, version
) values (
  'surgery-y5-2569', 5, 2569, 'Surgery Logbook Year 5 · พ.ศศ.501', 80, 'draft', 'ปี 5เล่มเล็ก-2569.doc', 1
)
on conflict (code) do update set
  academic_year = excluded.academic_year,
  name = excluded.name,
  pass_percent = excluded.pass_percent,
  source_filename = excluded.source_filename;

insert into public.curriculum_activities (
  curriculum_id, activity_code, title_th, group_name, target_count, target_unit,
  sort_order, requires_patient, requires_procedure, requires_week,
  allowed_approver_roles, active
)
select curriculum.id, seed.activity_code, seed.title_th, seed.group_name,
       seed.target_count, seed.target_unit, seed.sort_order,
       seed.requires_patient, seed.requires_procedure, seed.requires_week,
       array['staff']::text[], true
from public.curricula curriculum
cross join (values
  ('ipd-patient-care', 'ผู้ป่วยที่ได้รับไว้ในความดูแลแบบ IPD หน่วยละ 2 ราย', 'การดูแลผู้ป่วย', 12, 'ราย', 1, true, false, true),
  ('opd-attendance', 'การเข้าเรียนที่ OPD', 'ผู้ป่วยนอก', 6, 'ครั้ง', 2, false, false, true),
  ('opd-examined-case', 'เคสที่ได้ตรวจเองที่ OPD ในสาย สายละอย่างน้อย 1 เคส', 'ผู้ป่วยนอก', 10, 'ราย', 3, true, false, false),
  ('major-operation-observe', 'สังเกตการผ่าตัดใหญ่ อย่างน้อยสัปดาห์ละ 1 ราย/หน่วย', 'การผ่าตัด', 6, 'ราย', 4, true, true, true),
  ('major-operation-assist', 'ช่วยการผ่าตัดใหญ่', 'การผ่าตัด', 1, 'ราย', 5, true, true, false),
  ('minor-operation', 'สังเกตหรือช่วยการผ่าตัดเล็ก (ไม่รวมเย็บแผล)', 'การผ่าตัด', 2, 'ราย', 6, true, true, false),
  ('major-trauma-first-aid', 'First aid in major trauma', 'หัตถการ', 2, 'ราย', 7, true, true, false),
  ('wound-suture', 'เย็บแผล', 'หัตถการ', 2, 'ราย', 8, true, true, false),
  ('foley-catheter', 'ใส่ Foley catheter', 'หัตถการ', 2, 'ราย', 9, true, false, false),
  ('cvp-measurement', 'วัด Central venous pressure (CVP)', 'หัตถการ', 1, 'ราย', 10, true, false, false),
  ('er-duty', 'อยู่เวรห้องฉุกเฉิน', 'เวรและกิจกรรมหน่วย', 3, 'ครั้ง', 11, false, false, false),
  ('resident-teaching', 'การสอนของแพทย์ประจำบ้าน', 'เวรและกิจกรรมหน่วย', 6, 'ครั้ง', 12, false, false, true)
) as seed(
  activity_code, title_th, group_name, target_count, target_unit, sort_order,
  requires_patient, requires_procedure, requires_week
)
where curriculum.code = 'surgery-y5-2569'
on conflict (curriculum_id, activity_code) do update set
  title_th = excluded.title_th,
  group_name = excluded.group_name,
  target_count = excluded.target_count,
  target_unit = excluded.target_unit,
  sort_order = excluded.sort_order,
  requires_patient = excluded.requires_patient,
  requires_procedure = excluded.requires_procedure,
  requires_week = excluded.requires_week,
  allowed_approver_roles = excluded.allowed_approver_roles,
  active = true;

-- Canonical Year 5 approver directory imported from `รายชื่อ อ ปี 5.xlsx`.
with supplied_staff(email, full_name, unit_name) as (values
  ('kaweesak.chittaw@cmu.ac.th','ศ.ดร.นพ.กวีศักดิ์ จิตตวัฒนรัตน์','Trauma'),
  ('kamtone@yahoo.com','ผศ.นพ.กำธน จันทร์แจ่ม','Trauma'),
  ('teang063@gmail.com','ผศ.พญ.ธิดารัตน์ จิระพงศ์เจริญลาภ','Trauma'),
  ('obuea.homchan@cmu.ac.th','อ.พญ.โอบเอื้อ หอมจันทร์','Trauma'),
  ('ssriplak@hotmail.com','ผศ.นพ.ศุภณ ศรีพลากิจ','Urology'),
  ('siwatphuriyaphan@gmail.com','อ.นพ.ศิวัฒม์ ภู่ริยะพันธ์','Urology'),
  ('mahawongph@gmail.com','รศ.นพ.พิษณุ มหาวงศ์','Urology'),
  ('pruitk@yahoo.com','ผศ.นพ.พฤทธ์ กิติรัตน์ตระการ','Urology'),
  ('pop_akara@hotmail.com','ผศ.นพ.อัคร อมันตกุล','Urology'),
  ('tathunya@gmail.com','ผศ.นพ.ธัญญา นรเศรษฐ์ธาดา','Neuro Surgery'),
  ('jaraspong.vuthiwong@gmail.com','ผศ.ดร.นพ.จรัสพงศ์ วุฒิพงศ์','Urology'),
  ('uroaesthetic@gmail.com','อ.ดร.นพ.ธีรภัทร แสงมีอานุภาพ','Urology'),
  ('tanat.v@cmu.ac.th','ผศ.นพ.ธนัฐ วานิยะพงศ์','Neuro Surgery'),
  ('doctorchumpon@gmail.com','รศ.นพ.ชุมพล เจตจำนงค์','Neuro Surgery'),
  ('jvongsfak@gmail.com','ผศ.ดร.นพ.จิระพงศ์ วงศ์ฟัก','Neuro Surgery'),
  ('ardious1011@gmail.com','อ.นพ.ชานน สีหะกุล','Neuro Surgery'),
  ('opinchai65@gmail.com','อ.นพ.โอภาส พิณไชย','Plastic Surgery'),
  ('dr.wimon.wim@gmail.com','รศ.พญ.วิมล ศิริมหาราช','Plastic Surgery'),
  ('kkhwanngern@gmail.com','ผศ.นพ.กฤษณ์ ขวัญเงิน','Plastic Surgery'),
  ('puttanoh@gmail.com','ผศ.พญ.พุดตาน วงศ์ตรีรัตนชัย','Plastic Surgery'),
  ('sourputsa@hotmail.com','ผศ.ดร.พญ.จิรกานต์ เจริญวิชา','Plastic Surgery'),
  ('thitipong_tepsuwan@yahoo.com','รศ.นพ.ธิติพงศ์ เทพสุวรรณ','CVT'),
  ('drnoppon@hotmail.com','รศ.นพ.นพพล ทักษอุดม','CVT'),
  ('armadillos176@gmail.com','ผศ.ดร.นพ.อมฤต โพธิกุล','CVT'),
  ('jak.horsatidkul@gmail.com','อ.นพ.จักรพันธ์ หอสถิตย์กุล','CVT'),
  ('drjesda@gmail.com','ผศ.นพ.เจษฎา สิงห์เวชกุล','Pediatric Surgery'),
  ('nanji22@gmail.com','รศ.ดร.พญ.จิราภรณ์ โกรานา','Pediatric Surgery'),
  ('kan_whan@yahoo.com','ผศ.พญ.กนกกาญจน์ เทพมาลัย','Pediatric Surgery'),
  ('karnsire196@gmail.com','ผศ.ดร.พญ.สิรีกานต์ จันทขาว','Pediatric Surgery'),
  ('todsapon.p@cmu.ac.th','อ.นพ.ทศพล ประภานุวัฒน์','Neuro Surgery'),
  ('chollakarn.v@cmu.ac.th','อ.นพ.ชลกานต์ วโรภาษ','Trauma'),
  ('mymii.ppw@gmail.com','อ.พญ.ปภาวี ศิริมหาราช','Plastic Surgery'),
  ('yook14473@gmail.com','อ.นพ.สุกฤษฎิ์ สิทธิรังสรรค์','Pediatric Surgery')
)
insert into public.user_directory(email, full_name, role, active)
select lower(trim(email)), trim(full_name), 'staff', true from supplied_staff
on conflict(email) do update set
  full_name = excluded.full_name,
  role = 'staff',
  active = true;

with supplied_staff(email, unit_name) as (values
  ('kaweesak.chittaw@cmu.ac.th','Trauma'),('kamtone@yahoo.com','Trauma'),('teang063@gmail.com','Trauma'),('obuea.homchan@cmu.ac.th','Trauma'),
  ('ssriplak@hotmail.com','Urology'),('siwatphuriyaphan@gmail.com','Urology'),('mahawongph@gmail.com','Urology'),('pruitk@yahoo.com','Urology'),('pop_akara@hotmail.com','Urology'),
  ('tathunya@gmail.com','Neuro Surgery'),('jaraspong.vuthiwong@gmail.com','Urology'),('uroaesthetic@gmail.com','Urology'),
  ('tanat.v@cmu.ac.th','Neuro Surgery'),('doctorchumpon@gmail.com','Neuro Surgery'),('jvongsfak@gmail.com','Neuro Surgery'),('ardious1011@gmail.com','Neuro Surgery'),
  ('opinchai65@gmail.com','Plastic Surgery'),('dr.wimon.wim@gmail.com','Plastic Surgery'),('kkhwanngern@gmail.com','Plastic Surgery'),('puttanoh@gmail.com','Plastic Surgery'),('sourputsa@hotmail.com','Plastic Surgery'),
  ('thitipong_tepsuwan@yahoo.com','CVT'),('drnoppon@hotmail.com','CVT'),('armadillos176@gmail.com','CVT'),('jak.horsatidkul@gmail.com','CVT'),
  ('drjesda@gmail.com','Pediatric Surgery'),('nanji22@gmail.com','Pediatric Surgery'),('kan_whan@yahoo.com','Pediatric Surgery'),('karnsire196@gmail.com','Pediatric Surgery'),
  ('todsapon.p@cmu.ac.th','Neuro Surgery'),('chollakarn.v@cmu.ac.th','Trauma'),('mymii.ppw@gmail.com','Plastic Surgery'),('yook14473@gmail.com','Pediatric Surgery')
)
insert into public.curriculum_staff_approvers(curriculum_id, staff_email, unit_name, active)
select curriculum.id, lower(trim(staff.email)), staff.unit_name, true
from public.curricula curriculum cross join supplied_staff staff
where curriculum.code = 'surgery-y5-2569'
on conflict(curriculum_id, staff_email) do update set
  unit_name = excluded.unit_name,
  active = true;

-- New students select their starting class year. Academic year defaults to
-- 2569 and registration is rejected unless that curriculum is published.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  directory_entry public.user_directory%rowtype;
  submitted_name text;
  submitted_code text;
  submitted_group text;
  requested_role text;
  requested_class_year smallint;
  requested_academic_year integer;
  target_curriculum uuid;
begin
  select * into directory_entry
  from public.user_directory
  where email = lower(new.email) and active = true;

  if found then
    insert into public.profiles (
      id, email, full_name, role, active, student_code, cohort_year
    ) values (
      new.id, directory_entry.email, directory_entry.full_name,
      directory_entry.role, true, directory_entry.student_code,
      directory_entry.cohort_year
    );
    return new;
  end if;

  requested_role := coalesce(nullif(trim(new.raw_user_meta_data ->> 'requested_role'), ''), 'student');
  if requested_role <> 'student' then
    raise exception 'Staff and Admin must be allowlisted before activation';
  end if;

  submitted_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  submitted_code := nullif(trim(new.raw_user_meta_data ->> 'student_code'), '');
  submitted_group := nullif(trim(new.raw_user_meta_data ->> 'student_group'), '');
  requested_class_year := coalesce(nullif(new.raw_user_meta_data ->> 'class_year', '')::smallint, 5);
  requested_academic_year := coalesce(nullif(new.raw_user_meta_data ->> 'cohort_year', '')::integer, 2569);

  if submitted_name is null then raise exception 'Student full name is required'; end if;
  if submitted_code is null or submitted_code !~ '^[0-9]{6,20}$' then raise exception 'Student code must contain 6 to 20 digits'; end if;
  if submitted_group is null or submitted_group !~ '^[0-9]{1,3}$' then raise exception 'Student group must contain 1 to 3 digits'; end if;
  if requested_class_year not between 4 and 6 then raise exception 'Starting class year is invalid'; end if;
  if requested_academic_year not between 2500 and 2700 then raise exception 'Academic year is invalid'; end if;

  select id into target_curriculum
  from public.curricula
  where class_year = requested_class_year
    and academic_year = requested_academic_year
    and status = 'published'
  order by version desc
  limit 1;
  if target_curriculum is null then
    raise exception 'No published curriculum for requested class year and academic year';
  end if;

  insert into public.profiles (
    id, email, full_name, role, active, student_code, student_group, cohort_year
  ) values (
    new.id, lower(new.email), submitted_name, 'student', true,
    submitted_code, submitted_group, requested_academic_year
  );

  insert into public.student_enrollments (
    student_id, curriculum_id, group_code, status, activated_at
  ) values (
    new.id, target_curriculum, submitted_group, 'active', statement_timestamp()
  ) on conflict(student_id, curriculum_id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

-- Publish only after the source activities and approver list have been loaded.
update public.curricula
set status = 'published'
where code = 'surgery-y5-2569' and status = 'draft';

do $$
declare activity_count integer; target_total integer; approver_count integer;
begin
  select count(*), coalesce(sum(target_count), 0)
    into activity_count, target_total
  from public.curriculum_activities
  where curriculum_id = (select id from public.curricula where code='surgery-y5-2569')
    and active = true;
  select count(*) into approver_count
  from public.curriculum_staff_approvers
  where curriculum_id = (select id from public.curricula where code='surgery-y5-2569')
    and active = true;
  if activity_count <> 12 or target_total <> 53 or approver_count <> 33 then
    raise exception 'Year 5 reconciliation failed: activities %, target %, approvers %', activity_count, target_total, approver_count;
  end if;
end;
$$;

commit;
