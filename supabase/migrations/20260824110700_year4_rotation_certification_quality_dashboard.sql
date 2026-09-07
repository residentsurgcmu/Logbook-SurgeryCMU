begin;

update public.year4_activity_definitions
set target_count = 12
where id = 'patient-care';

update public.year4_activity_definitions
set target_count = 8
where id = 'after-hours-duty';

create table public.year4_rotations (
  id uuid primary key default gen_random_uuid(),
  academic_year integer not null check (academic_year between 2500 and 2700),
  group_code text not null check (nullif(trim(group_code), '') is not null),
  name text not null check (nullif(trim(name), '') is not null),
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('planned', 'open', 'closed', 'archived')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint year4_rotation_dates check (end_date >= start_date),
  constraint year4_rotation_unique unique (academic_year, group_code)
);

create table public.year4_logbook_certifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  academic_year integer not null check (academic_year between 2500 and 2700),
  rotation_id uuid references public.year4_rotations(id) on delete set null,
  selected_certifier_email text not null references public.user_directory(email),
  status text not null default 'submitted' check (status in ('submitted', 'certified', 'returned', 'reopened')),
  submitted_at timestamptz not null default now(),
  certified_by uuid references public.profiles(id),
  certified_at timestamptz,
  certifier_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint year4_certification_unique unique (student_id, academic_year),
  constraint year4_certified_complete check (
    status <> 'certified' or (certified_by is not null and certified_at is not null)
  ),
  constraint year4_returned_has_note check (
    status <> 'returned' or nullif(trim(certifier_note), '') is not null
  )
);

alter table public.year4_logbook_entries
  add column academic_year integer,
  add column rotation_id uuid references public.year4_rotations(id) on delete set null;

alter table public.year4_logbook_entries disable trigger user;

update public.year4_logbook_entries entry
set academic_year = profile.cohort_year
from public.profiles profile
where profile.id = entry.student_id
  and entry.academic_year is null;

alter table public.year4_logbook_entries enable trigger user;

create index year4_rotations_year_group_idx on public.year4_rotations(academic_year, group_code, status);
create index year4_certifications_staff_idx on public.year4_logbook_certifications(selected_certifier_email, status, submitted_at desc);
create index year4_certifications_student_idx on public.year4_logbook_certifications(student_id, academic_year);
create index year4_entries_year_rotation_idx on public.year4_logbook_entries(academic_year, rotation_id, student_id);

create trigger year4_rotations_touch_updated_at
before update on public.year4_rotations
for each row execute function private.touch_updated_at();

create trigger year4_certifications_touch_updated_at
before update on public.year4_logbook_certifications
for each row execute function private.touch_updated_at();

create or replace function private.assign_year4_entry_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_year integer;
  student_group_code text;
begin
  select cohort_year, student_group into student_year, student_group_code
  from public.profiles
  where id = new.student_id and role = 'student' and active = true;

  new.academic_year = coalesce(student_year, new.academic_year);
  select id into new.rotation_id
  from public.year4_rotations
  where academic_year = new.academic_year
    and group_code = student_group_code
    and new.activity_date between start_date and end_date
    and status in ('open', 'closed')
  order by start_date desc
  limit 1;
  return new;
end;
$$;

revoke all on function private.assign_year4_entry_context() from public, anon, authenticated;

create trigger year4_assign_entry_context
before insert on public.year4_logbook_entries
for each row execute function private.assign_year4_entry_context();

create or replace function private.protect_certified_year4_logbook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_year integer;
begin
  if (select private.is_admin()) then return new; end if;
  entry_year = coalesce(new.academic_year, (select cohort_year from public.profiles where id = new.student_id));
  if exists (
    select 1 from public.year4_logbook_certifications
    where student_id = new.student_id
      and academic_year = entry_year
      and status = 'certified'
  ) then
    raise exception 'Logbook is certified and locked';
  end if;
  if tg_op = 'UPDATE' and (
    new.academic_year is distinct from old.academic_year
    or new.rotation_id is distinct from old.rotation_id
  ) then
    raise exception 'Academic year and rotation are system managed';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_certified_year4_logbook() from public, anon, authenticated;

create trigger year4_protect_certified_logbook
before insert or update on public.year4_logbook_entries
for each row execute function private.protect_certified_year4_logbook();

create or replace function private.validate_year4_certification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  required_total integer;
  completed_total integer;
begin
  if tg_op = 'INSERT' then
    if new.student_id <> (select auth.uid()) then raise exception 'Student can submit own certification only'; end if;
    if not (select private.is_active_staff_email(new.selected_certifier_email)) then raise exception 'Certifier must be active Staff'; end if;
    select coalesce(sum(target_count), 0) into required_total
    from public.year4_activity_definitions where active = true and target_count is not null;
    select coalesce(sum(least(activity_count, target_count)), 0) into completed_total
    from (
      select definition.target_count, count(entry.id)::integer as activity_count
      from public.year4_activity_definitions definition
      left join public.year4_logbook_entries entry
        on entry.activity_type = definition.id
        and entry.student_id = new.student_id
        and entry.academic_year = new.academic_year
        and entry.status = 'approved'
      where definition.active = true and definition.target_count is not null
      group by definition.id, definition.target_count
    ) progress;
    if required_total = 0 or completed_total < ceil(required_total * 0.8) then raise exception 'Logbook progress must reach 80 percent'; end if;
    if exists (select 1 from public.year4_logbook_entries where student_id = new.student_id and academic_year = new.academic_year and status in ('submitted', 'rejected')) then
      raise exception 'Resolve pending or returned entries before certification';
    end if;
    new.status = 'submitted';
    new.submitted_at = statement_timestamp();
    new.certified_by = null;
    new.certified_at = null;
  elsif old.student_id = (select auth.uid()) then
    if old.status not in ('returned', 'reopened') or new.status <> 'submitted' then raise exception 'Invalid student certification transition'; end if;
    if not (select private.is_active_staff_email(new.selected_certifier_email)) then raise exception 'Certifier must be active Staff'; end if;
    select coalesce(sum(target_count), 0) into required_total
    from public.year4_activity_definitions where active = true and target_count is not null;
    select coalesce(sum(least(activity_count, target_count)), 0) into completed_total
    from (
      select definition.target_count, count(entry.id)::integer as activity_count
      from public.year4_activity_definitions definition
      left join public.year4_logbook_entries entry
        on entry.activity_type = definition.id and entry.student_id = new.student_id
        and entry.academic_year = new.academic_year and entry.status = 'approved'
      where definition.active = true and definition.target_count is not null
      group by definition.id, definition.target_count
    ) progress;
    if required_total = 0 or completed_total < ceil(required_total * 0.8) then raise exception 'Logbook progress must reach 80 percent'; end if;
    if exists (select 1 from public.year4_logbook_entries where student_id = new.student_id and academic_year = new.academic_year and status in ('submitted', 'rejected')) then raise exception 'Resolve pending or returned entries before certification'; end if;
    new.submitted_at = statement_timestamp(); new.certified_by = null; new.certified_at = null; new.certifier_note = null;
  elsif (select private.is_staff()) then
    if not (select private.is_selected_staff(old.selected_certifier_email)) then raise exception 'Only selected Staff can certify'; end if;
    if old.status <> 'submitted' or new.status not in ('certified', 'returned') then raise exception 'Invalid certification transition'; end if;
    if new.status = 'certified' then
      new.certified_by = (select auth.uid());
      new.certified_at = statement_timestamp();
    else
      new.certified_by = null;
      new.certified_at = null;
    end if;
  elsif (select private.is_admin()) then
    if new.status <> 'reopened' then raise exception 'Admin can reopen certification only'; end if;
    new.certified_by = null;
    new.certified_at = null;
  else
    raise exception 'Certification update is not allowed';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_year4_certification() from public, anon, authenticated;

create trigger year4_validate_certification
before insert or update on public.year4_logbook_certifications
for each row execute function private.validate_year4_certification();

alter table public.year4_rotations enable row level security;
alter table public.year4_logbook_certifications enable row level security;

create policy year4_rotations_select on public.year4_rotations
for select to authenticated using (true);
create policy year4_rotations_admin_insert on public.year4_rotations
for insert to authenticated with check ((select private.is_admin()) and created_by = (select auth.uid()));
create policy year4_rotations_admin_update on public.year4_rotations
for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy year4_certifications_select on public.year4_logbook_certifications
for select to authenticated using (
  student_id = (select auth.uid()) or (select private.is_staff()) or (select private.is_admin())
);
create policy year4_certifications_student_insert on public.year4_logbook_certifications
for insert to authenticated with check (student_id = (select auth.uid()) and status = 'submitted');
create policy year4_certifications_student_update on public.year4_logbook_certifications
for update to authenticated using (student_id = (select auth.uid()) and status in ('returned', 'reopened'))
with check (student_id = (select auth.uid()) and status = 'submitted');
create policy year4_certifications_staff_update on public.year4_logbook_certifications
for update to authenticated using (
  ((select private.is_staff()) and (select private.is_selected_staff(selected_certifier_email)))
  or (select private.is_admin())
) with check (
  ((select private.is_staff()) and (select private.is_selected_staff(selected_certifier_email)))
  or (select private.is_admin())
);

revoke all on public.year4_rotations, public.year4_logbook_certifications from anon, authenticated;
grant select on public.year4_rotations, public.year4_logbook_certifications to authenticated;
grant insert, update on public.year4_rotations, public.year4_logbook_certifications to authenticated;

commit;
