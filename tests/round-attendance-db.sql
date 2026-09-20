-- Run read-only against the linked Resident database after the migration:
-- npx supabase db query --linked --file tests/round-attendance-db.sql
do $$
begin
  if not private.resident_round_is_open('2026-09-18T03:59:59Z'::timestamptz)
     or private.resident_round_is_open('2026-09-18T04:00:00Z'::timestamptz)
     or private.resident_round_is_open('2026-09-17T03:00:00Z'::timestamptz)
  then raise exception 'Friday 11:00 Bangkok cutoff regression'; end if;

  if not private.resident_round_token_is_current('2026-09-18T03:59:00Z'::timestamptz, '2026-09-18T03:59:59Z'::timestamptz)
     or private.resident_round_token_is_current('2026-09-18T03:59:00Z'::timestamptz, '2026-09-18T04:00:00Z'::timestamptz)
  then raise exception 'One-minute QR validity regression'; end if;

  if has_function_privilege('anon', 'public.open_resident_round()', 'execute')
     or has_function_privilege('anon', 'public.current_resident_round_qr()', 'execute')
     or has_function_privilege('anon', 'public.check_in_resident_round(uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.resident_round_qr_tokens', 'select')
  then raise exception 'Round access grant regression'; end if;

  if not (select relrowsecurity from pg_class where oid = 'public.resident_round_sessions'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.resident_round_qr_tokens'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.resident_round_attendance'::regclass)
  then raise exception 'Round RLS regression'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.resident_round_attendance'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (session_id, user_id)'
  ) then raise exception 'Duplicate check-in guard regression'; end if;
end;
$$;
