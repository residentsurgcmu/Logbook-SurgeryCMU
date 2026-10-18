-- RC-02a-1: OPTIONAL clean-up after a rollback, once the owner no longer needs the pause switch.
-- Removes the pause triggers, functions and table (and with them the v3 direct-write guard). Run only
-- while paused = false. Use it only after a rollback: on the released version the guard must stay.
begin;
do $$ begin
  if (select public.resident_accounts_paused()) then raise exception 'Turn the pause off first (rc02a1_pause_off.sql)'; end if;
end $$;
drop trigger if exists resident_profiles_pause_guard on public.resident_profiles;
drop trigger if exists resident_user_roles_pause_guard on public.resident_user_roles;
drop trigger if exists resident_staff_directory_pause_guard on public.resident_staff_directory;
drop trigger if exists resident_profiles_pause_truncate on public.resident_profiles;
drop trigger if exists resident_user_roles_pause_truncate on public.resident_user_roles;
drop function if exists private.resident_refuse_account_write_when_paused();
drop function if exists public.resident_accounts_paused();
drop function if exists public.resident_account_direct_writes_blocked();
drop function if exists private.resident_account_counts();
drop table if exists public.resident_maintenance_pause;
commit;
