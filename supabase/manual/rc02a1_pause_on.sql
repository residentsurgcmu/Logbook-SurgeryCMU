-- RC-02a-1: PAUSE account writes (owner, SQL Editor). Needs migration 20261018090000 to be installed.
-- After this, every INSERT/UPDATE/DELETE on resident_profiles, resident_user_roles and
-- resident_staff_directory is refused for every role (browser, Edge Functions old or new, Admin RPCs).
-- Step 2 waits until every account write that was already running has finished (max 30 s; if it times out,
-- run this file again). The migration itself already starts paused; use this file before a rollback.
-- 1) switch on (committed immediately so new writes are refused from now on)
update public.resident_maintenance_pause
   set paused = true, note = 'paused by owner (rc02a1_pause_on.sql)', snapshot = private.resident_account_counts(), changed_at = now()
 where scope = 'accounts';
-- 2) wait for running writers: SHARE mode cannot be granted while any transaction still holds a write lock
begin;
set local lock_timeout = '30s';
lock table public.resident_profiles, public.resident_user_roles, public.resident_staff_directory in share mode;
commit;
-- 3) result: paused must be true
select scope, paused, changed_at, snapshot from public.resident_maintenance_pause;
