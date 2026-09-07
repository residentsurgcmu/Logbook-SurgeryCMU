-- Staff directory imported from "รายชื่ออาจารย์ ปี 4.xlsx".
-- The source workbook's final row is marked "test" and is intentionally
-- excluded from the production allowlist.
begin;

insert into public.user_directory (email, full_name, role, active)
values
  ('nchotiro@gmail.com', 'รศ.นพ.นเรนทร์ โชติรสนิรมิต', 'staff', true),
  ('kaweesak.chittaw@cmu.ac.th', 'ศ.ดร.นพ.กวีศักดิ์ จิตตวัฒนรัตน์', 'staff', true),
  ('kamtone@yahoo.com', 'ผศ.นพ.กำธน จันทร์แจ่ม', 'staff', true),
  ('teang063@gmail.com', 'ผศ.พญ.ธิดารัตน์ จิระพงศ์เจริญลาภ', 'staff', true),
  ('obuea.homchan@cmu.ac.th', 'อ.พญ.โอบเอื้อ หอมจันทร์', 'staff', true),
  ('chollakarn.v@cmu.ac.th', 'อ.นพ.ชลกานต์ วโรภาษ', 'staff', true),
  ('siyamada@yahoo.com', 'รศ.ดร.พญ.สิริกาญจน์ ลิมปกาญจน์', 'staff', true),
  ('namtaow@hotmail.com', 'รศ.นพ.มล.พันธุ์ภัทร์ จักรพันธุ์', 'staff', true),
  ('p_paan@hotmail.com', 'อ.พญ.ปีติชา ตันประเสริฐ', 'staff', true),
  ('pw3807@gmail.com', 'รศ.นพ.ปวิธ สุธารัตน์', 'staff', true),
  ('wwwit.it@gmail.com', 'อ.นพ.วรวิทย์ ฆังตระกูล', 'staff', true),
  ('sanmee_suwan@hotmail.com', 'ผศ.นพ.สุวรรณ แสนหมี่', 'staff', true),
  ('ekkarin06@gmail.com', 'ผศ.นพ.เอกรินทร์ ศุภตระกูล', 'staff', true),
  ('witcha.vip@cmu.ac.th', 'อ.นพ.วิชชา วิพุธอมร', 'staff', true),
  ('rerkase@gmail.com', 'ศ.(เชี่ยวชาญพิเศษ) ดร.นพ.กิตติพันธุ์ ฤกษ์เกษม', 'staff', true),
  ('supapong.arworn@gmail.com', 'รศ.นพ.ศุภพงษ์ อาวรณ์', 'staff', true),
  ('saranat.orrapin@cmu.ac.th', 'ผศ.นพ.สารนาถ ออรพินท์', 'staff', true),
  ('term_med@msn.com', 'ผศ.นพ.เติมพงศ์ เรียนแพง', 'staff', true),
  ('lordpoons@hotmail.com', 'อ.นพ.ปูรณ์ อภิชาติปิยกุล', 'staff', true),
  ('saemi971@gmail.com', 'อ.นพ.ชยาธร จันทร์สกาว', 'staff', true),
  ('achotiro@hotmail.com', 'รศ.นพ.อานนท์ โชติรสนิรมิต', 'staff', true),
  ('sunhawit.j@cmu.ac.th', 'รศ.นพ.สัณหวิชญ์ จันทร์รังสี', 'staff', true),
  ('worakitti.l@cmu.ac.th', 'รศ.นพ.วรกิตติ ลาภพิเศษพันธุ์', 'staff', true),
  ('asara.thep@cmu.ac.th', 'อ.พญ.อัษรา เทพบัญชรชัย', 'staff', true),
  ('asomwang@yahoo.com', 'อ.พญ.อารีวรรณ สมหวังประเสริฐ', 'staff', true),
  ('kvatchara@gmail.com', 'ผศ.นพ.กีรติ วัชราชันย์', 'staff', true),
  ('lleb_pn@hotmail.com', 'ผศ.พญ.ปัญจพร วงศ์มณีรุ่ง', 'staff', true),
  ('nansurg7@gmail.com', 'รศ.นพ.จักรกริช ดิษธรรม', 'staff', true),
  ('jajamedcmu@gmail.com', 'อ.พญ.จุฬารัตน์ ดวงแก้ว', 'staff', true),
  ('tengearneae@gmail.com', 'รศ.นพ.สมเจริญ แซ่เต็ง', 'staff', true),
  ('apichat.t@cmu.ac.th', 'รศ.ดร.นพ.อภิชาติ ตันตระวรศิลป์', 'staff', true),
  ('phonsiwachat@hotmail.com', 'ผศ.ดร.นพ.โสภณ ศิวชาติ', 'staff', true),
  ('atirut_s@hotmail.com', 'อ.นพ.อติรุจ ศุภพิพัฒน์', 'staff', true),
  ('trichaks@gmail.com', 'รศ.นพ.ไตรจักร ซันดู', 'staff', true)
on conflict (email) do update set
  full_name = excluded.full_name,
  role = excluded.role,
  active = excluded.active;

commit;
