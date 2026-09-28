-- One-off cleanup: remove the MM & Grand Round session saved with a
-- Buddhist-era year (2569-09-28, shown in the UI as "พ.ศ. 3112").
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.

-- 1) Preview: should return exactly one row (2569-09-28, closed = true, attendance = 0)
select s.id, s.meeting_date, s.closed_at is not null as closed,
       (select count(*) from public.resident_round_attendance a where a.session_id = s.id) as attendance,
       (select count(*) from public.resident_round_cme_qr c where c.session_id = s.id) as cme_qr
from public.resident_round_sessions s
where extract(year from s.meeting_date) > 2400;

-- 2) Delete. Only touches sessions with a B.E. year that are closed and have
--    no attendance. QR tokens and CME QR rows are removed by ON DELETE CASCADE.
delete from public.resident_round_sessions s
where extract(year from s.meeting_date) > 2400
  and s.closed_at is not null
  and not exists (select 1 from public.resident_round_attendance a where a.session_id = s.id)
returning s.id, s.meeting_date;

-- 3) Verify: should now show only the 2026 sessions
select meeting_date, closed_at is not null as closed
from public.resident_round_sessions
order by meeting_date;
