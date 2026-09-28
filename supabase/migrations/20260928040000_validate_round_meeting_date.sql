-- Guard MM & Grand Round sessions against the Buddhist-year mistake:
-- typing 2569 (B.E.) into a Gregorian date input stored meeting_date in
-- C.E. 2569, so the scan window never matched "now" and no QR appeared.

-- 1) Repair existing rows whose year is clearly B.E. (> 2400), unless a
--    session already exists on the corrected date.
update public.resident_round_sessions s
set meeting_date = (s.meeting_date - interval '543 years')::date,
    starts_at = s.starts_at - interval '543 years',
    ends_at = s.ends_at - interval '543 years'
where extract(year from s.meeting_date) > 2400
  and not exists (
    select 1 from public.resident_round_sessions other
    where other.meeting_date = (s.meeting_date - interval '543 years')::date
  );

-- 2) Reject new or edited meeting dates more than ~1 year from today
--    (Bangkok time). Applies to open_resident_round and
--    update_resident_round_session because both write this table.
create or replace function private.validate_resident_round_meeting_date()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_today date := (clock_timestamp() at time zone 'Asia/Bangkok')::date;
begin
  if tg_op = 'UPDATE' and new.meeting_date is not distinct from old.meeting_date then
    return new;
  end if;
  if new.meeting_date < v_today - 366 or new.meeting_date > v_today + 366 then
    raise exception 'Meeting date must be within 1 year of today. Use the Gregorian (C.E.) year, e.g. 2026, not the Buddhist year 2569';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_resident_round_meeting_date() from public, anon, authenticated;

drop trigger if exists resident_round_sessions_validate_meeting_date on public.resident_round_sessions;
create trigger resident_round_sessions_validate_meeting_date
  before insert or update of meeting_date on public.resident_round_sessions
  for each row execute function private.validate_resident_round_meeting_date();
