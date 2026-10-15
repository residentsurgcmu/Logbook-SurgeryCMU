-- Read-only check of the seat map after migration 20261014090000. Safe on production and staging: it only reads the catalogue.
--   npx supabase db query --linked --file tests/seat-map-db.sql
do $$
declare
  v_tables text[] := array['resident_room_layouts','resident_room_seats','resident_round_seat_config','resident_seat_assignments','resident_seat_holds','resident_seat_status','resident_seat_requests','resident_seat_events'];
  v_fns text[] := array[
    'public.hold_resident_seat(uuid, text)','public.confirm_resident_seat(uuid, text)','public.release_resident_seat(uuid)','public.use_reserve_area(uuid)',
    'public.report_urgent_duty(uuid, text, text)','public.request_seat_correction(uuid, text)',
    'public.staff_set_resident_seat(uuid, uuid, text)','public.staff_release_resident_seat(uuid, uuid)','public.certify_seat_map(uuid)',
    'public.admin_configure_seat_session(uuid, uuid, timestamptz)','public.review_seat_request(uuid, text)','public.list_seat_requests(uuid)','public.admin_list_seat_configs()',
    'public.list_resident_seat_sessions()','public.get_resident_seat_map(uuid)','public.get_my_seat_events(uuid)','public.admin_seat_report(uuid)'];
  v_t text; v_f text;
begin
  foreach v_t in array v_tables loop
    if to_regclass('public.' || v_t) is null then raise exception 'Missing table %', v_t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass) then raise exception 'RLS is off on %', v_t; end if;
    if has_table_privilege('anon', 'public.' || v_t, 'select') or has_table_privilege('anon', 'public.' || v_t, 'insert')
       or has_table_privilege('authenticated', 'public.' || v_t, 'insert') or has_table_privilege('authenticated', 'public.' || v_t, 'update')
       or has_table_privilege('authenticated', 'public.' || v_t, 'delete') then raise exception 'Direct table access is open on %', v_t; end if;
    if v_t not in ('resident_room_layouts', 'resident_room_seats') and has_table_privilege('authenticated', 'public.' || v_t, 'select') then
      raise exception 'Signed-in users can read % directly', v_t; end if;
  end loop;
  foreach v_f in array v_fns loop
    if to_regprocedure(v_f) is null then raise exception 'Missing function %', v_f; end if;
    if has_function_privilege('anon', v_f, 'execute') then raise exception 'anon can run %', v_f; end if;
    if not has_function_privilege('authenticated', v_f, 'execute') then raise exception 'authenticated cannot run %', v_f; end if;
    if not (select prosecdef from pg_proc where oid = to_regprocedure(v_f)) then raise exception '% is not SECURITY DEFINER', v_f; end if;
  end loop;
  if (select count(*) from public.resident_room_seats s join public.resident_room_layouts l on l.id = s.layout_id where l.name = 'ห้องประชุมวันศุกร์ (38 ที่)') <> 38 then
    raise exception 'The seeded layout does not have 38 seats (37 + the second moderator seat)'; end if;
  if to_regclass('public.resident_seat_assignments_one_seat_per_user') is null or to_regclass('public.resident_seat_assignments_one_user_per_seat') is null then
    raise exception 'A seat guarantee index is missing'; end if;
  if has_function_privilege('anon', 'private.resident_seat_context(uuid, text)', 'execute') or has_function_privilege('authenticated', 'private.resident_seat_context(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'private.resident_seat_log(uuid, uuid, uuid, text, text, jsonb)', 'execute') then
    raise exception 'An internal seat helper is callable from outside'; end if;
  if has_function_privilege('anon', 'public.check_in_resident_round(uuid)', 'execute') then raise exception 'check_in_resident_round became callable by anon'; end if;
end $$;
select 'seat-map structure OK' as result;
