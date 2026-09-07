begin;

-- Curriculum assignments reconciled against the supplied workbooks:
--   Year 4: `รายชื่ออาจารย์ ปี 4.xlsx` (34 production rows; excludes the
--           workbook's final row whose unit is explicitly marked `test`)
--   Year 5: `รายชื่อ อ ปี 5.xlsx` (33 rows)
create temporary table supplied_curriculum_staff (
  class_year smallint not null,
  email text not null,
  full_name text not null,
  unit_name text not null,
  primary key (class_year, email)
) on commit drop;

insert into supplied_curriculum_staff (class_year, email, full_name, unit_name)
values
  (4, 'nchotiro@gmail.com', 'รศ.นพ.นเรนทร์ โชติรสนิรมิต', 'Trauma'),
  (4, 'kaweesak.chittaw@cmu.ac.th', 'ศ.ดร.นพ.กวีศักดิ์ จิตตวัฒนรัตน์', 'Trauma'),
  (4, 'kamtone@yahoo.com', 'ผศ.นพ.กำธน จันทร์แจ่ม', 'Trauma'),
  (4, 'teang063@gmail.com', 'ผศ.พญ.ธิดารัตน์ จิระพงศ์เจริญลาภ', 'Trauma'),
  (4, 'obuea.homchan@cmu.ac.th', 'อ.พญ.โอบเอื้อ หอมจันทร์', 'Trauma'),
  (4, 'chollakarn.v@cmu.ac.th', 'อ.นพ.ชลกานต์ วโรภาษ', 'Trauma'),
  (4, 'siyamada@yahoo.com', 'รศ.ดร.พญ.สิริกาญจน์ ลิมปกาญจน์', 'Upper'),
  (4, 'namtaow@hotmail.com', 'รศ.นพ.มล.พันธุ์ภัทร์ จักรพันธุ์', 'Upper'),
  (4, 'p_paan@hotmail.com', 'อ.พญ.ปีติชา ตันประเสริฐ', 'Upper'),
  (4, 'pw3807@gmail.com', 'รศ.นพ.ปวิธ สุธารัตน์', 'Colo'),
  (4, 'wwwit.it@gmail.com', 'อ.นพ.วรวิทย์ ฆังตระกูล', 'Colo'),
  (4, 'sanmee_suwan@hotmail.com', 'ผศ.นพ.สุวรรณ แสนหมี่', 'Colo'),
  (4, 'ekkarin06@gmail.com', 'ผศ.นพ.เอกรินทร์ ศุภตระกูล', 'Colo'),
  (4, 'witcha.vip@cmu.ac.th', 'อ.นพ.วิชชา วิพุธอมร', 'Colo'),
  (4, 'rerkase@gmail.com', 'ศ.(เชี่ยวชาญพิเศษ) ดร.นพ.กิตติพันธุ์ ฤกษ์เกษม', 'Vascular'),
  (4, 'supapong.arworn@gmail.com', 'รศ.นพ.ศุภพงษ์ อาวรณ์', 'Vascular'),
  (4, 'saranat.orrapin@cmu.ac.th', 'ผศ.นพ.สารนาถ ออรพินท์', 'Vascular'),
  (4, 'term_med@msn.com', 'ผศ.นพ.เติมพงศ์ เรียนแพง', 'Vascular'),
  (4, 'lordpoons@hotmail.com', 'อ.นพ.ปูรณ์ อภิชาติปิยกุล', 'Vascular'),
  (4, 'saemi971@gmail.com', 'อ.นพ.ชยาธร จันทร์สกาว', 'Vascular'),
  (4, 'achotiro@hotmail.com', 'รศ.นพ.อานนท์ โชติรสนิรมิต', 'HBP'),
  (4, 'sunhawit.j@cmu.ac.th', 'รศ.นพ.สัณหวิชญ์ จันทร์รังสี', 'HBP'),
  (4, 'worakitti.l@cmu.ac.th', 'รศ.นพ.วรกิตติ ลาภพิเศษพันธุ์', 'HBP'),
  (4, 'asara.thep@cmu.ac.th', 'อ.พญ.อัษรา เทพบัญชรชัย', 'HBP'),
  (4, 'asomwang@yahoo.com', 'อ.พญ.อารีวรรณ สมหวังประเสริฐ', 'B&E'),
  (4, 'kvatchara@gmail.com', 'ผศ.นพ.กีรติ วัชราชันย์', 'B&E'),
  (4, 'lleb_pn@hotmail.com', 'ผศ.พญ.ปัญจพร วงศ์มณีรุ่ง', 'B&E'),
  (4, 'nansurg7@gmail.com', 'รศ.นพ.จักรกริช ดิษธรรม', 'B&E'),
  (4, 'jajamedcmu@gmail.com', 'อ.พญ.จุฬารัตน์ ดวงแก้ว', 'B&E'),
  (4, 'tengearneae@gmail.com', 'รศ.นพ.สมเจริญ แซ่เต็ง', 'Chest'),
  (4, 'apichat.t@cmu.ac.th', 'รศ.ดร.นพ.อภิชาติ ตันตระวรศิลป์', 'Chest'),
  (4, 'phonsiwachat@hotmail.com', 'ผศ.ดร.นพ.โสภณ ศิวชาติ', 'Chest'),
  (4, 'atirut_s@hotmail.com', 'อ.นพ.อติรุจ ศุภพิพัฒน์', 'Chest'),
  (4, 'trichaks@gmail.com', 'รศ.นพ.ไตรจักร ซันดู', 'HBP'),
  (5, 'kaweesak.chittaw@cmu.ac.th', 'ศ.ดร.นพ.กวีศักดิ์ จิตตวัฒนรัตน์', 'Trauma'),
  (5, 'kamtone@yahoo.com', 'ผศ.นพ.กำธน จันทร์แจ่ม', 'Trauma'),
  (5, 'teang063@gmail.com', 'ผศ.พญ.ธิดารัตน์ จิระพงศ์เจริญลาภ', 'Trauma'),
  (5, 'obuea.homchan@cmu.ac.th', 'อ.พญ.โอบเอื้อ หอมจันทร์', 'Trauma'),
  (5, 'ssriplak@hotmail.com', 'ผศ.นพ.ศุภณ ศรีพลากิจ', 'Urology'),
  (5, 'siwatphuriyaphan@gmail.com', 'อ.นพ.ศิวัฒม์ ภู่ริยะพันธ์', 'Urology'),
  (5, 'mahawongph@gmail.com', 'รศ.นพ.พิษณุ มหาวงศ์', 'Urology'),
  (5, 'pruitk@yahoo.com', 'ผศ.นพ.พฤทธ์ กิติรัตน์ตระการ', 'Urology'),
  (5, 'pop_akara@hotmail.com', 'ผศ.นพ.อัคร อมันตกุล', 'Urology'),
  (5, 'tathunya@gmail.com', 'ผศ.นพ.ธัญญา นรเศรษฐ์ธาดา', 'Neuro Surgery'),
  (5, 'jaraspong.vuthiwong@gmail.com', 'ผศ.ดร.นพ.จรัสพงศ์ วุฒิพงศ์', 'Urology'),
  (5, 'uroaesthetic@gmail.com', 'อ.ดร.นพ.ธีรภัทร แสงมีอานุภาพ', 'Urology'),
  (5, 'tanat.v@cmu.ac.th', 'ผศ.นพ.ธนัฐ วานิยะพงศ์', 'Neuro Surgery'),
  (5, 'doctorchumpon@gmail.com', 'รศ.นพ.ชุมพล เจตจำนงค์', 'Neuro Surgery'),
  (5, 'jvongsfak@gmail.com', 'ผศ.ดร.นพ.จิระพงศ์ วงศ์ฟัก', 'Neuro Surgery'),
  (5, 'ardious1011@gmail.com', 'อ.นพ.ชานน สีหะกุล', 'Neuro Surgery'),
  (5, 'opinchai65@gmail.com', 'อ.นพ.โอภาส พิณไชย', 'Plastic Surgery'),
  (5, 'dr.wimon.wim@gmail.com', 'รศ.พญ.วิมล ศิริมหาราช', 'Plastic Surgery'),
  (5, 'kkhwanngern@gmail.com', 'ผศ.นพ.กฤษณ์ ขวัญเงิน', 'Plastic Surgery'),
  (5, 'puttanoh@gmail.com', 'ผศ.พญ.พุดตาน วงศ์ตรีรัตนชัย', 'Plastic Surgery'),
  (5, 'sourputsa@hotmail.com', 'ผศ.ดร.พญ.จิรกานต์ เจริญวิชา', 'Plastic Surgery'),
  (5, 'thitipong_tepsuwan@yahoo.com', 'รศ.นพ.ธิติพงศ์ เทพสุวรรณ', 'CVT'),
  (5, 'drnoppon@hotmail.com', 'รศ.นพ.นพพล ทักษอุดม', 'CVT'),
  (5, 'armadillos176@gmail.com', 'ผศ.ดร.นพ.อมฤต โพธิกุล', 'CVT'),
  (5, 'jak.horsatidkul@gmail.com', 'อ.นพ.จักรพันธ์ หอสถิตย์กุล', 'CVT'),
  (5, 'drjesda@gmail.com', 'ผศ.นพ.เจษฎา สิงห์เวชกุล', 'Pediatric Surgery'),
  (5, 'nanji22@gmail.com', 'รศ.ดร.พญ.จิราภรณ์ โกรานา', 'Pediatric Surgery'),
  (5, 'kan_whan@yahoo.com', 'ผศ.พญ.กนกกาญจน์ เทพมาลัย', 'Pediatric Surgery'),
  (5, 'karnsire196@gmail.com', 'ผศ.ดร.พญ.สิรีกานต์ จันทขาว', 'Pediatric Surgery'),
  (5, 'todsapon.p@cmu.ac.th', 'อ.นพ.ทศพล ประภานุวัฒน์', 'Neuro Surgery'),
  (5, 'chollakarn.v@cmu.ac.th', 'อ.นพ.ชลกานต์ วโรภาษ', 'Trauma'),
  (5, 'mymii.ppw@gmail.com', 'อ.พญ.ปภาวี ศิริมหาราช', 'Plastic Surgery'),
  (5, 'yook14473@gmail.com', 'อ.นพ.สุกฤษฎิ์ สิทธิรังสรรค์', 'Pediatric Surgery');

insert into public.user_directory (email, full_name, role, active)
select distinct on (lower(trim(email)))
  lower(trim(email)), trim(full_name), 'staff', true
from supplied_curriculum_staff
order by lower(trim(email)), class_year desc
on conflict (email) do update set
  full_name = excluded.full_name,
  role = 'staff',
  active = true;

-- Reconcile current 2569 assignments with the two canonical source files.
update public.curriculum_staff_approvers assignment
set active = false
from public.curricula curriculum
where curriculum.id = assignment.curriculum_id
  and curriculum.academic_year = 2569
  and curriculum.class_year in (4, 5)
  and not exists (
    select 1
    from supplied_curriculum_staff supplied
    where supplied.class_year = curriculum.class_year
      and lower(trim(supplied.email)) = lower(assignment.staff_email)
  );

insert into public.curriculum_staff_approvers (
  curriculum_id, staff_email, unit_name, active
)
select
  curriculum.id,
  lower(trim(supplied.email)),
  trim(supplied.unit_name),
  true
from supplied_curriculum_staff supplied
join public.curricula curriculum
  on curriculum.class_year = supplied.class_year
 and curriculum.academic_year = 2569
 and curriculum.status = 'published'
on conflict (curriculum_id, staff_email) do update set
  unit_name = excluded.unit_name,
  active = true;

do $$
declare
  year4_count integer;
  year5_count integer;
begin
  select count(*) filter (where curriculum.class_year = 4),
         count(*) filter (where curriculum.class_year = 5)
    into year4_count, year5_count
  from public.curriculum_staff_approvers assignment
  join public.curricula curriculum on curriculum.id = assignment.curriculum_id
  where curriculum.academic_year = 2569
    and assignment.active = true;

  if year4_count <> 34 or year5_count <> 33 then
    raise exception 'Staff assignment reconciliation failed: Year 4 %, Year 5 %',
      year4_count, year5_count;
  end if;
end;
$$;

commit;
