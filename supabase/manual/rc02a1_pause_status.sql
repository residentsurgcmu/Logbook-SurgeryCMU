-- RC-02a-1: pause status (read-only; counts only, no names or e-mails).
select scope, paused, block_client_direct_writes, changed_at, note,
       snapshot as counts_when_paused,
       private.resident_account_counts() as counts_now,
       snapshot = private.resident_account_counts() as counts_unchanged
from public.resident_maintenance_pause;
