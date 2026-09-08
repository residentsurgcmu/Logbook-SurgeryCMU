begin;

-- "evaluator" was the original technical name for faculty assessors.  Rename
-- the enum value instead of replacing data so existing assignments stay valid.
do $$
begin
  if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'resident_system_role')
    and exists (
      select 1 from pg_enum enum_value
      join pg_type role_type on role_type.oid = enum_value.enumtypid
      where role_type.typnamespace = 'public'::regnamespace
        and role_type.typname = 'resident_system_role'
        and enum_value.enumlabel = 'evaluator'
    ) then
    alter type public.resident_system_role rename value 'evaluator' to 'staff';
  end if;
end;
$$;

create table if not exists public.resident_staff_directory (
  email text primary key check (email = lower(email)),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  unit_name text not null check (char_length(btrim(unit_name)) between 2 and 80),
  active boolean not null default true,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resident_staff_directory_active_idx
  on public.resident_staff_directory(active, unit_name, full_name);

-- Source: รายชื่ออาจารย์ ปี 4.xlsx.  The final workbook row is marked
-- "test", so it is retained for source traceability but cannot be invited.
insert into public.resident_staff_directory (unit_name, full_name, email, active)
values
  ('Trauma', 'รศ.นพ.นเรนทร์ โชติรสนิรมิต', 'nchotiro@gmail.com', true),
  ('Trauma', 'ศ.ดร.นพ.กวีศักดิ์ จิตตวัฒนรัตน์', 'kaweesak.chittaw@cmu.ac.th', true),
  ('Trauma', 'ผศ.นพ.กำธน จันทร์แจ่ม', 'kamtone@yahoo.com', true),
  ('Trauma', 'ผศ.พญ.ธิดารัตน์ จิระพงศ์เจริญลาภ', 'teang063@gmail.com', true),
  ('Trauma', 'อ.พญ.โอบเอื้อ หอมจันทร์', 'obuea.homchan@cmu.ac.th', true),
  ('Trauma', 'อ.นพ.ชลกานต์  วโรภาษ', 'chollakarn.v@cmu.ac.th', true),
  ('Upper', 'รศ.ดร.พญ.สิริกาญจน์  ลิมปกาญจน์', 'siyamada@yahoo.com', true),
  ('Upper', 'รศ.นพ.มล.พันธุ์ภัทร์ จักรพันธุ์', 'namtaow@hotmail.com', true),
  ('Upper', 'อ.พญ.ปีติชา ตันประเสริฐ', 'p_paan@hotmail.com', true),
  ('Colo', 'รศ.นพ.ปวิธ สุธารัตน์', 'pw3807@gmail.com', true),
  ('Colo', 'อ.นพ.วรวิทย์ ฆังตระกูล', 'wwwit.it@gmail.com', true),
  ('Colo', 'ผศ.นพ.สุวรรณ แสนหมี่', 'sanmee_suwan@hotmail.com', true),
  ('Colo', 'ผศ.นพ.เอกรินทร์ ศุภตระกูล', 'ekkarin06@gmail.com', true),
  ('Colo', 'อ.นพ.วิชชา  วิพุธอมร', 'witcha.vip@cmu.ac.th', true),
  ('Vascular', 'ศ.(เชี่ยวชาญพิเศษ) ดร.นพ.กิตติพันธุ์ ฤกษ์เกษม', 'rerkase@gmail.com', true),
  ('Vascular', 'รศ.นพ.ศุภพงษ์ อาวรณ์', 'supapong.arworn@gmail.com', true),
  ('Vascular', 'ผศ.นพ.สารนาถ ออรพินท์', 'saranat.orrapin@cmu.ac.th', true),
  ('Vascular', 'ผศ.นพ.เติมพงศ์ เรียนแพง', 'term_med@msn.com', true),
  ('Vascular', 'อ.นพ.ปูรณ์ อภิชาติปิยกุล', 'lordpoons@hotmail.com', true),
  ('Vascular', 'อ.นพ.ชยาธร จันทร์สกาว', 'saemi971@gmail.com', true),
  ('HBP', 'รศ.นพ.อานนท์ โชติรสนิรมิต', 'achotiro@hotmail.com', true),
  ('HBP', 'รศ.นพ.สัณหวิชญ์ จันทร์รังสี', 'sunhawit.j@cmu.ac.th', true),
  ('HBP', 'รศ.นพ.วรกิตติ ลาภพิเศษพันธุ์', 'worakitti.l@cmu.ac.th', true),
  ('HBP', 'อ.พญ.อัษรา เทพบัญชรชัย', 'asara.thep@cmu.ac.th', true),
  ('B&E', 'อ.พญ.อารีวรรณ สมหวังประเสริฐ', 'asomwang@yahoo.com', true),
  ('B&E', 'ผศ.นพ.กีรติ วัชราชันย์', 'kvatchara@gmail.com', true),
  ('B&E', 'ผศ.พญ.ปัญจพร วงศ์มณีรุ่ง', 'lleb_pn@hotmail.com', true),
  ('B&E', 'รศ.นพ.จักรกริช ดิษธรรม', 'nansurg7@gmail.com', true),
  ('B&E', 'อ.พญ.จุฬารัตน์  ดวงแก้ว', 'jajamedcmu@gmail.com', true),
  ('Chest', 'รศ.นพ.สมเจริญ แซ่เต็ง', 'tengearneae@gmail.com', true),
  ('Chest', 'รศ.ดร.นพ.อภิชาติ ตันตระวรศิลป์', 'apichat.t@cmu.ac.th', true),
  ('Chest', 'ผศ.ดร.นพ.โสภณ  ศิวชาติ', 'phonsiwachat@hotmail.com', true),
  ('Chest', 'อ.นพ.อติรุจ  ศุภพิพัฒน์', 'atirut_s@hotmail.com', true),
  ('HBP', 'รศ.นพ.ไตรจักร ซันดู', 'trichaks@gmail.com', true),
  ('test', 'เบบี๋', 'wichayakit.k@gmail.com', false)
on conflict (email) do update set
  unit_name = excluded.unit_name,
  full_name = excluded.full_name,
  active = excluded.active,
  updated_at = now();

-- Preserve access for faculty provisioned before the directory existed.
update public.resident_staff_directory directory
set auth_user_id = profile.user_id,
    invited_at = coalesce(directory.invited_at, profile.created_at),
    updated_at = now()
from public.resident_profiles profile
join public.resident_user_roles user_role on user_role.user_id = profile.user_id
where directory.email = profile.email
  and user_role.role = 'staff'
  and user_role.active;

create or replace function private.validate_resident_assignment()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (
    select 1 from public.resident_user_roles
    where user_id = new.evaluator_id and active and role in ('admin', 'staff')
  ) then raise exception 'Staff assignment requires an active staff member or admin'; end if;
  if not exists (
    select 1 from public.resident_user_roles
    where user_id = new.resident_id and active and role = 'resident'
  ) then raise exception 'Staff assignment requires an active resident'; end if;
  return new;
end;
$$;
revoke all on function private.validate_resident_assignment() from public, anon, authenticated;

alter table public.resident_staff_directory enable row level security;
revoke all on table public.resident_staff_directory from anon, authenticated;
grant select (email, full_name, unit_name, active, auth_user_id, invited_at)
  on public.resident_staff_directory to authenticated;

create policy resident_staff_directory_admin_select
  on public.resident_staff_directory for select to authenticated
  using ((select private.resident_role_is('admin')));

commit;
