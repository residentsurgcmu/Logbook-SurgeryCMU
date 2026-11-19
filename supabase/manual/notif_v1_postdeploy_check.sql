-- RC-NOTIF-V1 post-deploy check (read-only, no personal data). Run right after the migrations.
-- Expected: exactly 16 rows, every ok = true.
with clients(r) as (select rolname from pg_roles where rolname in ('anon', 'authenticated', 'authenticator', 'service_role')),
tbl(name) as (values ('resident_notification_preferences'), ('resident_notification_off_periods'), ('resident_notification_suppressions'),
  ('resident_assessment_email_attempts'), ('resident_notification_pending_web'), ('resident_notification_mail_control'))
select 'N1 table ' || t.name || ': exists, RLS on, no client/service privilege' as check_name,
  coalesce(c.relrowsecurity and not exists (select 1 from clients k cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    where has_table_privilege(k.r, c.oid, p)), false) as ok
  from tbl t left join pg_class c on c.oid = to_regclass('public.' || t.name)
union all select 'N2 web decision trigger enabled on resident_notifications',
  coalesce((select tgenabled = 'O' from pg_trigger where tgrelid = 'public.resident_notifications'::regclass and tgname = 'rc_notif_web_guard'), false)
union all select 'N3 legacy claim retired (old workers cannot send)',
  coalesce((select pg_get_functiondef(p.oid) ~ 'RC_NOTIF_LEGACY_CLAIM_RETIRED' from pg_proc p where p.oid = to_regprocedure('public.claim_resident_assessment_email_delivery(uuid,text,text)')), false)
union all select 'N4 worker RPCs: service_role only (7)',
  (select count(*) = 7 from pg_proc p where p.oid in (to_regprocedure('public.rc_notif_reserve_email(uuid,text)'), to_regprocedure('public.rc_notif_authorize_email_attempt(uuid)'),
     to_regprocedure('public.rc_notif_finish_email_attempt(uuid,text,text,text)'), to_regprocedure('public.rc_notif_due_email_work(integer,interval)'),
     to_regprocedure('public.rc_notif_ensure_web_reminder(uuid)'), to_regprocedure('public.rc_notif_worker_checkin(text)'), to_regprocedure('public.rc_notif_retry_pending_web(integer)'))
     and has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE'))
union all select 'N5 settings RPCs: authenticated only',
  (select count(*) = 2 from pg_proc p where p.oid in (to_regprocedure('public.rc_notif_get_my_preferences()'), to_regprocedure('public.rc_notif_save_my_preferences(integer,jsonb)'))
     and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE'))
union all select 'N6 private helpers not callable by any client role',
  (select count(*) >= 6 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'rc\_notif\_%')
  and not exists (select 1 from pg_proc p cross join clients k where p.pronamespace = 'private'::regnamespace and p.proname like 'rc\_notif\_%' and has_function_privilege(k.r, p.oid, 'EXECUTE'))
union all select 'N7 database clock is the real clock (no test override left)',
  coalesce((select prosrc ~ 'clock_timestamp' from pg_proc where oid = to_regprocedure('private.rc_notif_now()')), false)
union all select 'N8 delivery status allows suppressed and uncertain',
  exists (select 1 from pg_constraint where conname = 'resident_assessment_email_deliveries_status_check' and pg_get_constraintdef(oid) ~ 'suppressed' and pg_get_constraintdef(oid) ~ 'uncertain')
union all select 'N9 e-mail is paused until the resume script confirms the v1 worker',
  coalesce((select paused from public.resident_notification_mail_control), false)
union all select 'N10 web retry job scheduled (every 15 minutes)',
  exists (select 1 from cron.job where jobname = 'resident-notification-web-retry' and schedule = '*/15 * * * *')
union all select 'N11 worker check-in update targets the singleton control row',
  coalesce((select prosrc ~* 'update[[:space:]]+public[.]resident_notification_mail_control[^;]*where[[:space:]]+id[[:space:]]*=[[:space:]]*true[^;]*returning'
    from pg_proc where oid = to_regprocedure('public.rc_notif_worker_checkin(text)')), false)
;
