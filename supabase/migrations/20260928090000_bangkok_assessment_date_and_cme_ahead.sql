-- 1) Assessment dates: compare with today's date in Bangkok, not UTC.
--    Supabase runs in UTC, so between 00:00 and 07:00 Bangkok time
--    `current_date` is still yesterday and a resident submitting with the
--    form's default date (today, Bangkok) got "Assessment date is invalid".
--
--    The affected functions are rewritten from their live definitions with
--    only `current_date` replaced, so bodies, SECURITY DEFINER, search_path
--    and grants stay exactly as deployed.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('submit_resident_assessment_request', 'admin_record_historical_resident_assessment')
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('current_date' in v_def) > 0 then
      execute replace(v_def, 'current_date', '(clock_timestamp() at time zone ''Asia/Bangkok'')::date');
    end if;
  end loop;
end;
$$;

--    Same for CHECK constraints such as `assessment_date <= current_date`.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as table_name, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname like 'resident\_%'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%CURRENT_DATE%'
  loop
    execute format('alter table %s drop constraint %I', r.table_name, r.conname);
    execute format('alter table %s add constraint %I %s', r.table_name, r.conname,
      regexp_replace(r.def, 'CURRENT_DATE', '((now() at time zone ''Asia/Bangkok'')::date)', 'gi'));
  end loop;
end;
$$;

-- 2) CME QR: allow Admin to attach/remove the image for any open session
--    that has not finished yet (e.g. next Friday), not only today's.
create or replace function public.set_resident_round_cme_qr(
  p_session_id uuid,
  p_storage_path text
) returns text
language plpgsql security definer set search_path = public, private, auth, storage as $$
declare
  v_previous_path text;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if p_session_id is null or nullif(btrim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'Meeting session and CME QR image are required';
  end if;
  if not exists (
    select 1 from public.resident_round_sessions
    where id = p_session_id
      and closed_at is null
      and ends_at >= clock_timestamp()
  ) then
    raise exception 'CME QR can only be added to a meeting session that is open and not finished';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'resident-round-cme-qr' and name = btrim(p_storage_path)
  ) then
    raise exception 'CME QR image upload was not found';
  end if;

  select storage_path into v_previous_path
  from public.resident_round_cme_qr where session_id = p_session_id;

  insert into public.resident_round_cme_qr (session_id, storage_path, uploaded_by, uploaded_at, updated_at)
  values (p_session_id, btrim(p_storage_path), (select auth.uid()), clock_timestamp(), clock_timestamp())
  on conflict (session_id) do update set
    storage_path = excluded.storage_path,
    uploaded_by = excluded.uploaded_by,
    uploaded_at = excluded.uploaded_at,
    updated_at = excluded.updated_at;
  return v_previous_path;
end;
$$;
revoke all on function public.set_resident_round_cme_qr(uuid, text) from public, anon;
grant execute on function public.set_resident_round_cme_qr(uuid, text) to authenticated;

create or replace function public.clear_resident_round_cme_qr(p_session_id uuid)
returns text
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_storage_path text;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  delete from public.resident_round_cme_qr
  where session_id = p_session_id
    and exists (
      select 1 from public.resident_round_sessions
      where id = p_session_id and closed_at is null
    )
  returning storage_path into v_storage_path;
  if v_storage_path is null then raise exception 'CME QR for this open meeting session was not found'; end if;
  return v_storage_path;
end;
$$;
revoke all on function public.clear_resident_round_cme_qr(uuid) from public, anon;
grant execute on function public.clear_resident_round_cme_qr(uuid) to authenticated;
