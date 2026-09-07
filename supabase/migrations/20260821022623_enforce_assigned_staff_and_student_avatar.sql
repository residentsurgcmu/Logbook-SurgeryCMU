begin;

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.year4_logbook_entries
  add column if not exists selected_approver_id uuid
    references public.profiles(id);

create index if not exists year4_entries_selected_approver_idx
  on public.year4_logbook_entries(selected_approver_id, status, submitted_at desc);

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
revoke all on function private.is_active_staff(uuid) from public, anon;
grant execute on function private.is_active_staff(uuid) to authenticated;

create or replace function private.validate_year4_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition public.year4_activity_definitions%rowtype;
  staff_name text;
begin
  if new.status = 'draft' then
    return new;
  end if;

  select * into definition
  from public.year4_activity_definitions
  where id = new.activity_type and active = true;
  if not found then
    raise exception 'Activity definition is not active';
  end if;

  select full_name into staff_name
  from public.profiles
  where id = new.selected_approver_id and role = 'staff' and active = true;
  if staff_name is null then
    raise exception 'Selected approver must be an active Staff account';
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

drop trigger if exists year4_validate_submission on public.year4_logbook_entries;
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

drop policy if exists profiles_select_authorized on public.profiles;
create policy profiles_select_authorized on public.profiles
for select to authenticated
using (
  (select auth.uid()) = id
  or (select private.is_staff())
  or (role = 'staff' and active = true)
);

drop policy if exists profiles_student_avatar_update on public.profiles;
create policy profiles_student_avatar_update on public.profiles
for update to authenticated
using ((select auth.uid()) = id and role = 'student')
with check ((select auth.uid()) = id and role = 'student');

drop policy if exists year4_entries_student_insert on public.year4_logbook_entries;
create policy year4_entries_student_insert on public.year4_logbook_entries
for insert to authenticated
with check (
  (select auth.uid()) = student_id
  and recorded_by = (select auth.uid())
  and status in ('draft', 'submitted')
  and (select private.is_active_staff(selected_approver_id))
  and approved_by is null
  and approved_at is null
  and approver_comment is null
  and onedrive_sync_status = 'not_required'
);

drop policy if exists year4_entries_student_update on public.year4_logbook_entries;
drop policy if exists year4_entries_authorized_update on public.year4_logbook_entries;
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
  and (select private.is_active_staff(selected_approver_id))
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
  and (select auth.uid()) = selected_approver_id
  and status = 'submitted'
)
with check (
  (select private.is_staff())
  and (select auth.uid()) = selected_approver_id
  and status in ('approved', 'rejected')
);

grant update (avatar_path) on public.profiles to authenticated;

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

drop policy if exists student_avatars_select on storage.objects;
create policy student_avatars_select on storage.objects
for select to authenticated
using (
  bucket_id = 'student-avatars'
  and (owner_id = (select auth.uid()::text) or (select private.is_staff()))
);

drop policy if exists student_avatars_insert on storage.objects;
create policy student_avatars_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'student-avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and (select private.current_user_role()) = 'student'
);

drop policy if exists student_avatars_update on storage.objects;
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

commit;
