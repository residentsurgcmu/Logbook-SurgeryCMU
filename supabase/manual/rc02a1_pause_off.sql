-- RC-02a-1: RESUME account writes (owner, SQL Editor). Run only after the checks in the release guide pass.
update public.resident_maintenance_pause
   set paused = false, note = 'resumed by owner (rc02a1_pause_off.sql)', changed_at = now()
 where scope = 'accounts';
select scope, paused, changed_at from public.resident_maintenance_pause;
