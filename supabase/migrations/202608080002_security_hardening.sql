create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and active = true
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

grant execute on function private.current_user_role() to authenticated;
grant execute on function private.is_staff() to authenticated;

drop policy profiles_select_authorized on public.profiles;
create policy profiles_select_authorized on public.profiles
for select to authenticated
using ((select auth.uid()) = id or (select private.is_staff()));

drop policy logbook_select on public.logbook_entries;
drop policy logbook_insert on public.logbook_entries;
drop policy logbook_update on public.logbook_entries;
create policy logbook_select on public.logbook_entries
for select to authenticated
using ((select auth.uid()) = fellow_id or (select private.is_staff()));
create policy logbook_insert on public.logbook_entries
for insert to authenticated
with check (recorded_by = (select auth.uid()) and ((select auth.uid()) = fellow_id or (select private.is_staff())));
create policy logbook_update on public.logbook_entries
for update to authenticated
using ((select auth.uid()) = fellow_id or (select private.is_staff()))
with check ((select auth.uid()) = fellow_id or (select private.is_staff()));

drop policy epa_select on public.epa_assessments;
drop policy epa_staff_insert on public.epa_assessments;
drop policy epa_staff_update on public.epa_assessments;
create policy epa_select on public.epa_assessments
for select to authenticated using ((select auth.uid()) = fellow_id or (select private.is_staff()));
create policy epa_staff_insert on public.epa_assessments
for insert to authenticated with check ((select private.is_staff()) and assessor_id = (select auth.uid()));
create policy epa_staff_update on public.epa_assessments
for update to authenticated
using ((select private.is_staff()) and assessor_id = (select auth.uid()))
with check ((select private.is_staff()) and assessor_id = (select auth.uid()));

drop policy pba_select on public.pba_assessments;
drop policy pba_staff_insert on public.pba_assessments;
drop policy pba_staff_update on public.pba_assessments;
create policy pba_select on public.pba_assessments
for select to authenticated using ((select auth.uid()) = fellow_id or (select private.is_staff()));
create policy pba_staff_insert on public.pba_assessments
for insert to authenticated with check ((select private.is_staff()) and assessor_id = (select auth.uid()));
create policy pba_staff_update on public.pba_assessments
for update to authenticated
using ((select private.is_staff()) and assessor_id = (select auth.uid()))
with check ((select private.is_staff()) and assessor_id = (select auth.uid()));

drop policy topics_select on public.topics;
drop policy topics_insert on public.topics;
drop policy topics_update on public.topics;
create policy topics_select on public.topics
for select to authenticated using ((select auth.uid()) = fellow_id or (select private.is_staff()));
create policy topics_insert on public.topics
for insert to authenticated
with check (recorded_by = (select auth.uid()) and ((select auth.uid()) = fellow_id or (select private.is_staff())));
create policy topics_update on public.topics
for update to authenticated
using ((select auth.uid()) = fellow_id or (select private.is_staff()))
with check ((select auth.uid()) = fellow_id or (select private.is_staff()));

drop trigger on_auth_user_created on auth.users;
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
    raise exception 'This email is not authorized for Breast Surgery Training';
  end if;
  insert into public.profiles (id, email, full_name, role, active)
  values (new.id, directory_entry.email, directory_entry.full_name, directory_entry.role, true);
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

drop function public.handle_new_user();
drop function public.is_staff();
drop function public.current_user_role();

create policy user_directory_deny on public.user_directory
for select to authenticated using (false);

create index logbook_entries_recorded_by_idx on public.logbook_entries(recorded_by);
create index topics_recorded_by_idx on public.topics(recorded_by);
