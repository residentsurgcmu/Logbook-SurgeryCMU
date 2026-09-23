-- Run read-only against the linked Resident database after the migration:
-- npx --yes supabase db query --linked --file tests/resident-cme-historical-exams-db.sql
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'resident-round-cme-qr' and public = false
      and file_size_limit = 5242880
  ) then raise exception 'CME QR private bucket regression'; end if;

  if not exists (
    select 1 from pg_class where oid = 'public.resident_round_cme_qr'::regclass and relrowsecurity
  ) then raise exception 'CME QR RLS regression'; end if;

  if not (select relrowsecurity from pg_class where oid = 'public.resident_exam_events'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.resident_exam_participants'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.resident_exam_parts'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.resident_exam_results'::regclass)
  then raise exception 'Exam RLS regression'; end if;

  if has_function_privilege('anon', 'public.set_resident_round_cme_qr(uuid, text)', 'execute')
    or has_function_privilege('anon', 'public.clear_resident_round_cme_qr(uuid)', 'execute')
    or has_function_privilege('anon', 'public.admin_record_historical_resident_assessment(uuid, uuid, uuid, date, text, text, text, text, jsonb)', 'execute')
    or has_function_privilege('anon', 'public.create_resident_exam_event(text, date, text, numeric, jsonb, jsonb)', 'execute')
    or has_function_privilege('anon', 'public.save_resident_exam_results(uuid, jsonb)', 'execute')
    or has_function_privilege('anon', 'public.set_resident_exam_publication(uuid, boolean)', 'execute')
    or has_function_privilege('anon', 'public.list_resident_exam_records()', 'execute')
  then raise exception 'New Resident function grant regression'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'resident_assessments' and column_name = 'recorded_by'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'resident_assessments' and column_name = 'recorded_at'
  ) then raise exception 'Historical assessment audit-column regression'; end if;
end;
$$;
