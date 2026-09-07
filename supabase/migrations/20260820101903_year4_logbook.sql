-- Year 4 Surgery Logbook
-- Adds Student accounts and an auditable Draft -> Submitted -> Approved/Rejected workflow.

alter table public.user_directory drop constraint if exists user_directory_role_check;
alter table public.user_directory
  add constraint user_directory_role_check check (role in ('staff', 'fellow', 'student'));
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('staff', 'fellow', 'student'));

alter table public.user_directory
  add column if not exists student_code text,
  add column if not exists cohort_year integer;
alter table public.profiles
  add column if not exists student_code text,
  add column if not exists cohort_year integer,
  add column if not exists qr_token uuid not null default gen_random_uuid();

create unique index if not exists profiles_student_code_unique
  on public.profiles(student_code) where student_code is not null;
create unique index if not exists profiles_qr_token_unique on public.profiles(qr_token);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  directory_entry public.user_directory%rowtype;
begin
  select * into directory_entry from public.user_directory
  where email = lower(new.email) and active = true;
  if not found then
    raise exception 'This email is not authorized for Surgery Logbook';
  end if;
  insert into public.profiles (id, email, full_name, role, active, student_code, cohort_year)
  values (
    new.id,
    directory_entry.email,
    directory_entry.full_name,
    directory_entry.role,
    true,
    directory_entry.student_code,
    directory_entry.cohort_year
  );
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

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
create index year4_events_entry_idx
  on public.year4_approval_events(entry_id, created_at desc);

create trigger year4_logbook_touch_updated_at
before update on public.year4_logbook_entries
for each row execute function public.touch_updated_at();

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

alter table public.year4_activity_definitions enable row level security;
alter table public.year4_logbook_entries enable row level security;
alter table public.year4_approval_events enable row level security;

create policy year4_definitions_select on public.year4_activity_definitions
for select to authenticated using (active = true);

create policy year4_entries_select on public.year4_logbook_entries
for select to authenticated
using ((select auth.uid()) = student_id or (select private.is_staff()));

create policy year4_entries_student_insert on public.year4_logbook_entries
for insert to authenticated
with check (
  (select auth.uid()) = student_id
  and recorded_by = (select auth.uid())
  and status in ('draft', 'submitted')
  and approved_by is null
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
  and approved_by is null
);

create policy year4_entries_staff_update on public.year4_logbook_entries
for update to authenticated
using ((select private.is_staff()))
with check ((select private.is_staff()));

create policy year4_events_select on public.year4_approval_events
for select to authenticated
using ((select auth.uid()) = student_id or (select private.is_staff()));

revoke all on public.year4_activity_definitions,
  public.year4_logbook_entries,
  public.year4_approval_events from anon;
revoke all on public.year4_activity_definitions,
  public.year4_logbook_entries,
  public.year4_approval_events from authenticated;
grant select on public.year4_activity_definitions,
  public.year4_logbook_entries,
  public.year4_approval_events to authenticated;
grant insert, update on public.year4_logbook_entries to authenticated;
grant usage, select on sequence public.year4_approval_events_id_seq to authenticated;

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
  ('resident-teaching', 'การสอนของ Resident', 'กิจกรรมรายสัปดาห์', 8, 'สัปดาห์', 17, false, false, true, array['staff','resident'])
on conflict (id) do update set
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
