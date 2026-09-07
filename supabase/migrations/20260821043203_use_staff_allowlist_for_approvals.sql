begin;

alter table public.year4_logbook_entries
  add column if not exists selected_approver_email text
    references public.user_directory(email);

update public.year4_logbook_entries entry
set selected_approver_email = profile.email
from public.profiles profile
where profile.id = entry.selected_approver_id
  and entry.selected_approver_email is null;

alter table public.year4_logbook_entries
  alter column selected_approver_email set not null,
  alter column selected_approver_id drop not null;

alter table public.year4_logbook_entries
  drop constraint if exists year4_submitted_complete;
alter table public.year4_logbook_entries
  add constraint year4_submitted_complete check (
    status = 'draft'
    or (
      submitted_at is not null
      and selected_approver_email is not null
      and nullif(trim(detail), '') is not null
    )
  );

create index if not exists year4_entries_selected_approver_email_idx
  on public.year4_logbook_entries(selected_approver_email, status, submitted_at desc);

create or replace function private.is_active_staff_email(candidate_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_directory
    where email = lower(candidate_email)
      and role = 'staff'
      and active = true
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
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'staff'
      and active = true
      and email = lower(candidate_email)
  )
$$;

revoke all on function private.is_active_staff_email(text) from public, anon;
revoke all on function private.is_selected_staff(text) from public, anon;
grant execute on function private.is_active_staff_email(text) to authenticated;
grant execute on function private.is_selected_staff(text) to authenticated;

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

  select * into definition
  from public.year4_activity_definitions
  where id = new.activity_type and active = true;
  if not found then
    raise exception 'Activity definition is not active';
  end if;
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

drop policy if exists user_directory_staff_options_select on public.user_directory;
create policy user_directory_staff_options_select on public.user_directory
for select to authenticated
using (role = 'staff' and active = true);

grant select (email, full_name) on public.user_directory to authenticated;

drop policy if exists year4_entries_student_insert on public.year4_logbook_entries;
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

drop policy if exists year4_entries_student_update on public.year4_logbook_entries;
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

drop policy if exists year4_entries_staff_update on public.year4_logbook_entries;
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

commit;
