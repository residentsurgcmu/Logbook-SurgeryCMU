-- Surgery Logbook Year 4 — standalone production schema.
-- This file is intentionally independent from the Breast/Fellow Training schema.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.user_directory (
  email text primary key,
  full_name text not null,
  role text not null default 'staff' check (role in ('staff', 'admin')),
  active boolean not null default true,
  student_code text,
  cohort_year integer,
  created_at timestamptz not null default now(),
  constraint user_directory_email_lowercase check (email = lower(email))
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('staff', 'student', 'admin')),
  active boolean not null default true,
  student_code text,
  student_group text,
  cohort_year integer,
  qr_token uuid not null default gen_random_uuid(),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_lowercase check (email = lower(email)),
  constraint profiles_student_fields check (
    role <> 'student'
    or (
      student_code ~ '^[0-9]{6,20}$'
      and student_group ~ '^[0-9]{1,3}$'
      and cohort_year is not null
    )
  )
);

create unique index profiles_student_code_unique
  on public.profiles(student_code) where student_code is not null;
create unique index profiles_qr_token_unique on public.profiles(qr_token);
create index profiles_role_active_idx on public.profiles(role, active);

create or replace function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = (select auth.uid()) and active = true
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.current_user_role()) = 'staff', false)
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.current_user_role()) = 'admin', false)
$$;

create or replace function private.is_active_staff(candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = candidate_id and role = 'staff' and active = true
  )
$$;

create or replace function private.is_active_staff_email(candidate_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_directory
    where email = lower(candidate_email) and role = 'staff' and active = true
  )
$$;

create or replace function private.is_selected_staff(candidate_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'staff'
      and active = true
      and email = lower(candidate_email)
  )
$$;

revoke all on function private.current_user_role() from public, anon;
revoke all on function private.is_staff() from public, anon;
revoke all on function private.is_admin() from public, anon;
revoke all on function private.is_active_staff(uuid) from public, anon;
revoke all on function private.is_active_staff_email(text) from public, anon;
revoke all on function private.is_selected_staff(text) from public, anon;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_active_staff(uuid) to authenticated;
grant execute on function private.is_active_staff_email(text) to authenticated;
grant execute on function private.is_selected_staff(text) to authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

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
  submitted_cohort integer;
begin
  select * into directory_entry
  from public.user_directory
  where email = lower(new.email) and active = true;

  if found then
    insert into public.profiles (
      id, email, full_name, role, active, student_code, cohort_year
    ) values (
      new.id,
      directory_entry.email,
      directory_entry.full_name,
      directory_entry.role,
      true,
      null,
      null
    );
    return new;
  end if;

  submitted_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  submitted_code := nullif(trim(new.raw_user_meta_data ->> 'student_code'), '');
  submitted_group := nullif(trim(new.raw_user_meta_data ->> 'student_group'), '');
  submitted_cohort := coalesce(
    nullif(new.raw_user_meta_data ->> 'cohort_year', '')::integer,
    2568
  );

  if submitted_name is null then
    raise exception 'Student full name is required';
  end if;
  if submitted_code is null or submitted_code !~ '^[0-9]{6,20}$' then
    raise exception 'Student code must contain 6 to 20 digits';
  end if;
  if submitted_group is null or submitted_group !~ '^[0-9]{1,3}$' then
    raise exception 'Student group must contain 1 to 3 digits';
  end if;

  insert into public.profiles (
    id, email, full_name, role, active, student_code, student_group, cohort_year
  ) values (
    new.id,
    lower(new.email),
    submitted_name,
    'student',
    true,
    submitted_code,
    submitted_group,
    submitted_cohort
  );
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

create table public.year4_activity_definitions (
  id text primary key,
  title_th text not null,
  group_name text not null,
  target_count integer check (target_count is null or target_count > 0),
  target_unit text not null default 'ครั้ง',
  sort_order integer not null check (sort_order > 0),
  requires_patient boolean not null default false,
  requires_procedure boolean not null default false,
  requires_week boolean not null default false,
  allowed_approver_roles text[] not null default array['staff']::text[],
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.year4_logbook_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  recorded_by uuid not null references public.profiles(id),
  activity_type text not null references public.year4_activity_definitions(id),
  activity_date date not null,
  week_number smallint check (week_number between 1 and 8),
  unit_name text,
  patient_reference text,
  diagnosis text,
  procedure_name text,
  participation text,
  activity_title text,
  supervisor_name text,
  selected_approver_id uuid references public.profiles(id),
  selected_approver_email text not null references public.user_directory(email),
  detail text,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  approver_comment text,
  revision integer not null default 1 check (revision > 0),
  onedrive_sync_status text not null default 'not_required'
    check (onedrive_sync_status in ('not_required', 'pending', 'synced', 'failed')),
  onedrive_item_id text,
  onedrive_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint year4_submitted_complete check (
    status = 'draft'
    or (
      submitted_at is not null
      and selected_approver_email is not null
      and nullif(trim(detail), '') is not null
    )
  ),
  constraint year4_approved_complete check (
    status <> 'approved' or (approved_at is not null and approved_by is not null)
  ),
  constraint year4_rejected_has_reason check (
    status <> 'rejected' or nullif(trim(approver_comment), '') is not null
  )
);

create table public.year4_approval_events (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.year4_logbook_entries(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  from_status text,
  to_status text not null,
  comment text,
  revision integer not null,
  created_at timestamptz not null default now()
);

create index year4_entries_student_date_idx
  on public.year4_logbook_entries(student_id, activity_date desc);
create index year4_entries_status_idx
  on public.year4_logbook_entries(status, submitted_at desc);
create index year4_entries_activity_idx
  on public.year4_logbook_entries(activity_type, status);
create index year4_entries_recorded_by_idx
  on public.year4_logbook_entries(recorded_by);
create index year4_entries_approved_by_idx
  on public.year4_logbook_entries(approved_by)
  where approved_by is not null;
create index year4_entries_selected_approver_idx
  on public.year4_logbook_entries(selected_approver_id, status, submitted_at desc);
create index year4_entries_selected_approver_email_idx
  on public.year4_logbook_entries(selected_approver_email, status, submitted_at desc);
create index year4_events_entry_idx
  on public.year4_approval_events(entry_id, created_at desc);
create index year4_events_actor_idx on public.year4_approval_events(actor_id);
create index year4_events_student_idx on public.year4_approval_events(student_id);

create trigger year4_logbook_touch_updated_at
before update on public.year4_logbook_entries
for each row execute function private.touch_updated_at();

create or replace function private.validate_year4_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition public.year4_activity_definitions%rowtype;
  staff_name text;
  active_staff_profile_id uuid;
begin
  if new.status = 'draft' then
    new.submitted_at = null;
    new.approved_at = null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'submitted' then
      new.submitted_at = statement_timestamp();
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status = 'submitted' and old.status is distinct from 'submitted' then
      new.submitted_at = statement_timestamp();
    end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then
      new.approved_at = statement_timestamp();
    end if;
  end if;

  select * into definition
  from public.year4_activity_definitions
  where id = new.activity_type and active = true;
  if not found then
    raise exception 'Activity definition is not active';
  end if;

  select directory.full_name, profile.id
  into staff_name, active_staff_profile_id
  from public.user_directory directory
  left join public.profiles profile
    on profile.email = directory.email
    and profile.role = 'staff'
    and profile.active = true
  where directory.email = lower(new.selected_approver_email)
    and directory.role = 'staff'
    and directory.active = true;
  if staff_name is null then
    raise exception 'Selected approver must be on the active Staff allowlist';
  end if;
  new.selected_approver_email = lower(new.selected_approver_email);
  new.selected_approver_id = active_staff_profile_id;
  if nullif(trim(new.detail), '') is null then
    raise exception 'Activity detail is required before submission';
  end if;
  if definition.requires_week and new.week_number is null then
    raise exception 'Week number is required for this activity';
  end if;
  if definition.requires_patient and nullif(trim(new.patient_reference), '') is null then
    raise exception 'Patient reference is required for this activity';
  end if;
  if definition.requires_procedure and nullif(trim(new.procedure_name), '') is null then
    raise exception 'Procedure is required for this activity';
  end if;

  new.supervisor_name = staff_name;
  return new;
end;
$$;
revoke all on function private.validate_year4_submission() from public, anon, authenticated;

create trigger year4_validate_submission
before insert or update on public.year4_logbook_entries
for each row execute function private.validate_year4_submission();

create or replace function private.protect_year4_review_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select private.is_staff()) then
    if new.student_id is distinct from old.student_id
      or new.recorded_by is distinct from old.recorded_by
      or new.activity_type is distinct from old.activity_type
      or new.activity_date is distinct from old.activity_date
      or new.week_number is distinct from old.week_number
      or new.unit_name is distinct from old.unit_name
      or new.patient_reference is distinct from old.patient_reference
      or new.diagnosis is distinct from old.diagnosis
      or new.procedure_name is distinct from old.procedure_name
      or new.participation is distinct from old.participation
      or new.activity_title is distinct from old.activity_title
      or new.supervisor_name is distinct from old.supervisor_name
      or new.selected_approver_id is distinct from old.selected_approver_id
      or new.selected_approver_email is distinct from old.selected_approver_email
      or new.detail is distinct from old.detail
      or new.revision is distinct from old.revision
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Staff can update review fields only';
    end if;
  else
    if new.approved_by is not null
      or new.approved_at is not null
      or new.approver_comment is not null
      or new.onedrive_sync_status <> 'not_required'
      or new.onedrive_item_id is not null
      or new.onedrive_synced_at is not null
    then
      raise exception 'Student cannot update review or backup fields';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_year4_review_update() from public, anon, authenticated;

create trigger year4_protect_review_update
before update on public.year4_logbook_entries
for each row execute function private.protect_year4_review_update();

create or replace function private.capture_year4_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.year4_approval_events (
      entry_id, student_id, actor_id, from_status, to_status, comment, revision
    ) values (
      new.id,
      new.student_id,
      (select auth.uid()),
      old.status,
      new.status,
      new.approver_comment,
      new.revision
    );
  end if;
  return new;
end;
$$;
revoke all on function private.capture_year4_status_change() from public, anon, authenticated;

create trigger year4_logbook_capture_status
after update of status on public.year4_logbook_entries
for each row execute function private.capture_year4_status_change();

alter table public.user_directory enable row level security;
alter table public.profiles enable row level security;
alter table public.year4_activity_definitions enable row level security;
alter table public.year4_logbook_entries enable row level security;
alter table public.year4_approval_events enable row level security;

create policy user_directory_staff_options_select on public.user_directory
for select to authenticated
using (role = 'staff' and active = true);

create policy profiles_select_authorized on public.profiles
for select to authenticated
using (
  (select auth.uid()) = id
  or (select private.is_staff())
  or (select private.is_admin())
  or (role = 'staff' and active = true)
);

create policy profiles_student_avatar_update on public.profiles
for update to authenticated
using ((select auth.uid()) = id and role = 'student')
with check ((select auth.uid()) = id and role = 'student');

create policy year4_definitions_select on public.year4_activity_definitions
for select to authenticated using (active = true);

create policy year4_entries_select on public.year4_logbook_entries
for select to authenticated
using ((select auth.uid()) = student_id or (select private.is_staff()) or (select private.is_admin()));

create policy year4_entries_student_insert on public.year4_logbook_entries
for insert to authenticated
with check (
  (select auth.uid()) = student_id
  and recorded_by = (select auth.uid())
  and status in ('draft', 'submitted')
  and (select private.is_active_staff_email(selected_approver_email))
  and approved_by is null
  and approved_at is null
  and approver_comment is null
  and onedrive_sync_status = 'not_required'
);

create policy year4_entries_student_update on public.year4_logbook_entries
for update to authenticated
using (
  (select auth.uid()) = student_id
  and status in ('draft', 'rejected')
)
with check (
  (select auth.uid()) = student_id
  and recorded_by = (select auth.uid())
  and status in ('draft', 'submitted')
  and (select private.is_active_staff_email(selected_approver_email))
  and approved_by is null
  and approved_at is null
  and approver_comment is null
  and onedrive_sync_status = 'not_required'
);

create policy year4_entries_staff_update on public.year4_logbook_entries
for update to authenticated
using (
  (select private.is_staff())
  and (select private.is_selected_staff(selected_approver_email))
  and status = 'submitted'
)
with check (
  (select private.is_staff())
  and (select private.is_selected_staff(selected_approver_email))
  and status in ('approved', 'rejected')
);

create policy year4_events_select on public.year4_approval_events
for select to authenticated
using ((select auth.uid()) = student_id or (select private.is_staff()) or (select private.is_admin()));

revoke all on public.user_directory,
  public.profiles,
  public.year4_activity_definitions,
  public.year4_logbook_entries,
  public.year4_approval_events from anon, authenticated;

grant select on public.profiles,
  public.year4_activity_definitions,
  public.year4_logbook_entries,
  public.year4_approval_events to authenticated;
grant insert, update on public.year4_logbook_entries to authenticated;
grant update (avatar_path) on public.profiles to authenticated;
grant select (email, full_name) on public.user_directory to authenticated;
grant usage, select on sequence public.year4_approval_events_id_seq to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-avatars',
  'student-avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy student_avatars_select on storage.objects
for select to authenticated
using (
  bucket_id = 'student-avatars'
  and (
    owner_id = (select auth.uid()::text)
    or (select private.is_staff())
    or (select private.is_admin())
  )
);

create policy student_avatars_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'student-avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and (select private.current_user_role()) = 'student'
);

create policy student_avatars_update on storage.objects
for update to authenticated
using (
  bucket_id = 'student-avatars'
  and owner_id = (select auth.uid()::text)
)
with check (
  bucket_id = 'student-avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

insert into public.user_directory (email, full_name, role)
values
  ('nchotiro@gmail.com', 'รศ.นพ.นเรนทร์ โชติรสนิรมิต', 'staff'),
  ('kaweesak.chittaw@cmu.ac.th', 'ศ.ดร.นพ.กวีศักดิ์ จิตตวัฒนรัตน์', 'staff'),
  ('kamtone@yahoo.com', 'ผศ.นพ.กำธน จันทร์แจ่ม', 'staff'),
  ('teang063@gmail.com', 'ผศ.พญ.ธิดารัตน์ จิระพงศ์เจริญลาภ', 'staff'),
  ('chollakarn.v@cmu.ac.th', 'อ.นพ.ชลกานต์ วโรภาษ', 'staff'),
  ('siyamada@yahoo.com', 'รศ.ดร.พญ.สิริกาญจน์ ลิมปกาญจน์', 'staff'),
  ('namtaow@hotmail.com', 'รศ.นพ.มล.พันธุ์ภัทร์ จักรพันธุ์', 'staff'),
  ('p_paan@hotmail.com', 'อ.พญ.ปีติชา ตันประเสริฐ', 'staff'),
  ('pw3807@gmail.com', 'รศ.นพ.ปวิธ สุธารัตน์', 'staff'),
  ('wwwit.it@gmail.com', 'อ.นพ.วรวิทย์ ฆังตระกูล', 'staff'),
  ('sanmee_suwan@hotmail.com', 'ผศ.นพ.สุวรรณ แสนหมี่', 'staff'),
  ('ekkarin06@gmail.com', 'ผศ.นพ.เอกรินทร์ ศุภตระกูล', 'staff'),
  ('witcha.vip@cmu.ac.th', 'อ.นพ.วิชชา วิพุธอมร', 'staff'),
  ('rerkase@gmail.com', 'ศ.(เชี่ยวชาญพิเศษ) ดร.นพ.กิตติพันธุ์ ฤกษ์เกษม', 'staff'),
  ('supapong.arworn@gmail.com', 'รศ.นพ.ศุภพงษ์ อาวรณ์', 'staff'),
  ('saranat.orrapin@cmu.ac.th', 'ผศ.นพ.สารนาถ ออรพินท์', 'staff'),
  ('term_med@msn.com', 'ผศ.นพ.เติมพงศ์ เรียนแพง', 'staff'),
  ('lordpoons@hotmail.com', 'อ.นพ.ปูรณ์ อภิชาติปิยกุล', 'staff'),
  ('saemi971@gmail.com', 'อ.นพ.ชยาธร จันทร์สกาว', 'staff'),
  ('achotiro@hotmail.com', 'รศ.นพ.อานนท์ โชติรสนิรมิต', 'staff'),
  ('sunhawit.j@cmu.ac.th', 'รศ.นพ.สัณหวิชญ์ จันทร์รังสี', 'staff'),
  ('worakitti.l@cmu.ac.th', 'รศ.นพ.วรกิตติ ลาภพิเศษพันธุ์', 'staff'),
  ('asara.thep@cmu.ac.th', 'อ.พญ.อัษรา เทพบัญชรชัย', 'staff'),
  ('asomwang@yahoo.com', 'อ.พญ.อารีวรรณ สมหวังประเสริฐ', 'staff'),
  ('kvatchara@gmail.com', 'ผศ.นพ.กีรติ วัชราชันย์', 'staff'),
  ('lleb_pn@hotmail.com', 'ผศ.พญ.ปัญจพร วงศ์มณีรุ่ง', 'staff'),
  ('jajamedcmu@gmail.com', 'อ.พญ.จุฬารัตน์ ดวงแก้ว', 'staff'),
  ('tengearneae@gmail.com', 'รศ.นพ.สมเจริญ แซ่เต็ง', 'staff'),
  ('apichat.t@cmu.ac.th', 'รศ.ดร.นพ.อภิชาติ ตันตระวรศิลป์', 'staff'),
  ('phonsiwachat@hotmail.com', 'ผศ.ดร.นพ.โสภณ ศิวชาติ', 'staff'),
  ('atirut_s@hotmail.com', 'อ.นพ.อติรุจ ศุภพิพัฒน์', 'staff'),
  ('trichaks@gmail.com', 'รศ.นพ.ไตรจักร ซันดู', 'staff'),
  ('nansurg7@gmail.com', 'รศ.นพ.จักรกริช ดิษธรรม', 'staff'),
  ('nanji22@gmail.com', 'nanji22@gmail.com', 'staff'),
  ('obuea.homchan@cmu.ac.th', 'อ.พญ.โอบเอื้อ หอมจันทร์', 'staff'),
  ('edusurgcmu@gmail.com', 'Surgery CMU Year 4 Admin', 'admin'),
  ('surgerycmuyear4@hotmail.com', 'Surgery CMU Year 4 Admin', 'admin')
on conflict (email) do update set
  full_name = excluded.full_name,
  role = excluded.role,
  active = true;

insert into public.year4_activity_definitions
  (id, title_th, group_name, target_count, target_unit, sort_order, requires_patient, requires_procedure, requires_week, allowed_approver_roles)
values
  ('advisor-meeting', 'พบอาจารย์ที่ปรึกษา', 'การกำกับติดตาม', 2, 'ครั้ง', 1, false, false, true, array['staff']),
  ('patient-care', 'ผู้ป่วยที่รับไว้ในความดูแล', 'การดูแลผู้ป่วย', null, 'ราย', 2, true, false, false, array['staff']),
  ('major-operation-observe', 'สังเกตการผ่าตัดใหญ่', 'ห้องผ่าตัด', 8, 'ราย', 3, true, true, true, array['staff']),
  ('opd-attendance', 'เข้าเรียนที่ OPD', 'กิจกรรมรายสัปดาห์', 8, 'สัปดาห์', 4, false, false, true, array['staff']),
  ('conference', 'เข้าร่วม Conference ของหน่วย', 'กิจกรรมรายสัปดาห์', 8, 'สัปดาห์', 5, false, false, true, array['staff']),
  ('after-hours-duty', 'อยู่เวรนอกเวลาราชการ', 'เวร', null, 'ครั้ง', 6, false, false, false, array['staff','resident']),
  ('emergency-duty', 'อยู่เวรห้องฉุกเฉิน', 'เวร', 4, 'ครั้ง', 7, false, false, false, array['staff','resident']),
  ('major-operation-assist', 'ช่วยการผ่าตัดใหญ่', 'หัตถการ', 3, 'ราย', 8, true, true, false, array['staff','resident']),
  ('minor-operation', 'สังเกตหรือช่วยการผ่าตัดเล็ก', 'หัตถการ', 2, 'ราย', 9, true, true, false, array['staff','resident']),
  ('wound-suture', 'เย็บแผล', 'หัตถการพื้นฐาน', 2, 'ราย', 10, true, true, false, array['staff','resident','nurse']),
  ('foley-catheter', 'ใส่ Foley catheter', 'หัตถการพื้นฐาน', 3, 'ราย', 11, true, true, false, array['staff','resident','nurse']),
  ('venipuncture', 'เจาะเลือด', 'หัตถการพื้นฐาน', 4, 'ราย', 12, true, true, false, array['staff','resident','nurse']),
  ('stomal-care', 'ทำ Stomal care', 'หัตถการพื้นฐาน', 1, 'ราย', 13, true, true, false, array['staff','resident','nurse']),
  ('nasogastric-tube', 'ใส่ Nasogastric tube', 'หัตถการพื้นฐาน', 2, 'ราย', 14, true, true, false, array['staff','resident','nurse']),
  ('major-trauma-first-aid', 'เห็น First aid management in major trauma', 'หัตถการพื้นฐาน', 2, 'ราย', 15, true, false, false, array['staff','resident']),
  ('proctoscopy', 'ทำ Proctoscopy', 'หัตถการพื้นฐาน', 1, 'ราย', 16, true, true, false, array['staff','resident']),
  ('resident-teaching', 'การสอนของ Resident', 'กิจกรรมรายสัปดาห์', 8, 'สัปดาห์', 17, false, false, true, array['staff','resident']);

commit;
