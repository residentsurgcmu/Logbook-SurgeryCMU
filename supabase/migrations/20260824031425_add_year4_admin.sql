begin;

alter table public.user_directory drop constraint if exists user_directory_role_check;
alter table public.user_directory
  add constraint user_directory_role_check
  check (role in ('staff', 'admin'));

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('staff', 'student', 'admin'));

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.current_user_role()) = 'admin', false)
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

insert into public.user_directory (email, full_name, role, active)
values ('surgerycmuyear4@hotmail.com', 'Surgery CMU Year 4 Admin', 'admin', true)
on conflict (email) do update set
  full_name = excluded.full_name,
  role = excluded.role,
  active = excluded.active;

drop policy if exists profiles_select_authorized on public.profiles;
create policy profiles_select_authorized on public.profiles
for select to authenticated
using (
  (select auth.uid()) = id
  or (select private.is_staff())
  or (select private.is_admin())
  or (role = 'staff' and active = true)
);

drop policy if exists year4_entries_select on public.year4_logbook_entries;
create policy year4_entries_select on public.year4_logbook_entries
for select to authenticated
using (
  (select auth.uid()) = student_id
  or (select private.is_staff())
  or (select private.is_admin())
);

drop policy if exists year4_events_select on public.year4_approval_events;
create policy year4_events_select on public.year4_approval_events
for select to authenticated
using (
  (select auth.uid()) = student_id
  or (select private.is_staff())
  or (select private.is_admin())
);

drop policy if exists student_avatars_select on storage.objects;
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

commit;
