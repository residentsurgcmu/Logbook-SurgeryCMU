-- RC-NOTIF-V1 behaviour tests (migration 20261118090000). Throwaway local database only; everything rolls back.
-- Synthetic FIXTURE accounts. The database clock used by every decision (private.rc_notif_now) is replaced inside
-- this transaction by a scripted clock, so A/B run at the exact times of the work order (UTC).
-- The SQL cron path is the real statement of the 'resident-assessment-web-reminders' job; the e-mail path calls
-- the same RPC sequence the Edge worker uses (due list → web reminder → claim → authorize → finish).
-- psql -v ON_ERROR_STOP=1 -f tests/notification-preferences-behavior.sql
begin;
do $$ begin if exists (select 1 from public.resident_profiles) then raise exception 'Refusing to run: database has Resident data'; end if; end $$;
update public.resident_maintenance_pause set paused = false where scope = 'accounts';
-- the migration starts with e-mail paused (I03); this suite runs the worker, so e-mail is resumed here (I03 tests below pause it again)
update public.resident_notification_mail_control set paused = false;
create schema t;
create table t.clock (now timestamptz not null);
insert into t.clock values ('2026-01-10 09:00:00+00');
create or replace function private.rc_notif_now() returns timestamptz language sql volatile set search_path = '' as $$ select now from t.clock $$;
create function t.at(p text) returns void language sql as $$ update t.clock set now = p::timestamptz $$;
create table t.ctx (k text primary key, v text);
create function t.v(p text) returns text language sql as $$ select v from t.ctx where k = p $$;
create function t.put(p text, x text) returns text language sql as $$ insert into t.ctx values (p, x) on conflict (k) do update set v = excluded.v returning v $$;
create function t.put(p text, x uuid) returns text language sql as $$ select t.put(p, x::text) $$;
create function t.id(n text) returns uuid language sql immutable as $$ select ('10000000-0000-4000-8000-0000000000' || n)::uuid $$;
create function t.ok(c boolean, l text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL %', l; end if; raise notice 'PASS %', l; end $$;
create function t.q(u text, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin perform set_config('request.jwt.claim.sub', coalesce(t.id(u)::text, ''), true); set local role authenticated; execute p_sql into v; reset role; return v; end $$;
create function t.err(u text, p_sql text, pat text, l text) returns void language plpgsql as $$
declare m text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(t.id(u)::text, ''), true);
  begin set local role authenticated; execute p_sql; exception when others then get stacked diagnostics m = message_text; end;
  reset role;
  if m is null or m !~* pat then raise exception 'FAIL % : expected "%" got "%"', l, pat, coalesce(m, 'success'); end if;
  raise notice 'PASS %', l;
end $$;
create function t.err_role(r text, p_sql text, pat text, l text) returns void language plpgsql as $$
declare m text;
begin
  begin execute format('set local role %I', r); execute p_sql; exception when others then get stacked diagnostics m = message_text; end;
  reset role;
  if m is null or m !~* pat then raise exception 'FAIL % : expected "%" got "%"', l, pat, coalesce(m, 'success'); end if;
  raise notice 'PASS %', l;
end $$;
-- save own preferences as user u (reads the current version first, like the page)
create function t.save(u text, prefs jsonb) returns jsonb language sql as $$
  select t.q(u, format('select public.rc_notif_save_my_preferences(%s, %L::jsonb)',
    (t.q(u, 'select public.rc_notif_get_my_preferences()')->>'version'), prefs)) $$;
-- a request submitted by resident r to staff s, with submitted_at forced to p_at (event time of the scenario)
create function t.req(r text, s text, code text, p_at text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform t.at(p_at);
  perform set_config('request.jwt.claim.sub', t.id(r)::text, true);
  select public.submit_resident_assessment_request(d.id, t.id(s), (p_at::timestamptz at time zone 'UTC')::date, 'ctx', 'activity ' || code,
       case when d.requires_self_assessment then d.outcome_options->>0 end, case when d.requires_self_assessment then 'self' end,
       case when d.requires_self_assessment then (select coalesce(jsonb_agg(jsonb_build_object('criterionId', c.id, 'score', d.score_options->>1, 'comment', '') order by c.sort_order), '[]'::jsonb)
                                                     from public.resident_template_criteria c where c.template_id = d.id and c.active) else '[]'::jsonb end)
    into v from public.resident_template_definitions d where d.template_code = code;
  update public.resident_assessment_requests set submitted_at = p_at::timestamptz where id = v;
  return v;
end $$;
-- the real SQL cron statement of job 'resident-assessment-web-reminders'
create function t.cron_web() returns void language sql as $$
  insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message)
  select request.staff_id, request.id, 'assessment_reminder', 'แบบประเมินรอเกิน 24 ชั่วโมง', definition.template_code || ' ยังรอการประเมิน'
  from public.resident_assessment_requests request
  join public.resident_template_definitions definition on definition.id = request.template_id
  where request.status = 'pending' and request.submitted_at <= now() - interval '24 hours'
  on conflict (request_id, recipient_id, notification_type) do nothing $$;
-- one run of the e-mail worker, as the Edge Function does it, against a mail sink (t.sink)
create table t.sink (request_id uuid, delivery_type text, attempt_no int, outcome text, at timestamptz);
create function t.worker(p_outcome text default 'sent') returns int language plpgsql as $$
declare w record; d uuid; a jsonb; n int := 0;
begin
  for w in select * from public.rc_notif_due_email_work(200, interval '6 hours') loop
    if w.delivery_type = 'reminder' then perform public.rc_notif_ensure_web_reminder(w.request_id); end if;
    d := (public.rc_notif_reserve_email(w.request_id, w.delivery_type)->>'delivery_id')::uuid;   -- same call as the Edge
    continue when d is null;
    a := public.rc_notif_authorize_email_attempt(d);
    continue when not (a->>'allowed')::boolean;
    -- the mail sink receives a message only when SMTP accepted it; a failure before SMTP delivers nothing
    if p_outcome = 'sent' then insert into t.sink values (w.request_id, w.delivery_type, (a->>'attempt_no')::int, p_outcome, private.rc_notif_now()); end if;
    perform public.rc_notif_finish_email_attempt((a->>'attempt_id')::uuid, p_outcome, 'sink-' || n, case when p_outcome <> 'sent' then 'sink: ' || p_outcome end);
    n := n + 1;
  end loop;
  return n;
end $$;
create function t.web(req uuid, typ text) returns bigint language sql as $$ select count(*) from public.resident_notifications where request_id = req and notification_type = typ $$;
create function t.attempts(req uuid, typ text) returns bigint language sql as $$
  select count(*) from public.resident_assessment_email_attempts a join public.resident_assessment_email_deliveries d on d.id = a.delivery_id where d.request_id = req and d.delivery_type = typ $$;
create function t.dstatus(req uuid, typ text) returns text language sql as $$
  select coalesce((select status || '/' || attempt_count from public.resident_assessment_email_deliveries where request_id = req and delivery_type = typ), 'none') $$;
create function t.sinkn(req uuid, typ text) returns bigint language sql as $$ select count(*) from t.sink where request_id = req and delivery_type = typ $$;
grant usage on schema t to authenticated, anon, service_role; grant all on all tables in schema t to authenticated, anon, service_role;
grant execute on all functions in schema t to authenticated, anon, service_role;

-- fixture accounts: a1 Admin, b1/b2 Staff (in the Staff list), c1/c2 Residents, c9 inactive Resident
insert into auth.users(id, email) select t.id(x), x || '@fixture.test' from unnest(array['a1','b1','b2','c1','c2','c9']) x;
insert into public.resident_profiles(user_id, full_name, email, pgy, active)
  select t.id(x), 'Fixture ' || x, x || '@fixture.test', case when x like 'c%' then 2 end, x <> 'c9' from unnest(array['a1','b1','b2','c1','c2','c9']) x;
insert into public.resident_user_roles(user_id, role, active)
  select t.id(x), case when x like 'a%' then 'admin'::public.resident_system_role when x like 'b%' then 'staff' else 'resident' end, x <> 'c9' from unnest(array['a1','b1','b2','c1','c2','c9']) x;
insert into public.resident_staff_directory(email, full_name, unit_name, active, auth_user_id)
  select x || '@fixture.test', 'Fixture ' || x, 'Unit', true, t.id(x) from unnest(array['b1','b2']) x;

-- ===================== Case A: off 09:01, reminder due 09:05, on 09:09, first worker 09:15 (no worker while off)
select t.put('A', t.req('c1', 'b1', 'EPA-1', '2026-01-09 09:05:00+00')::text);           -- due 2026-01-10 09:05
-- the initial e-mail of the request had been sent the day before (normal operation)
select t.at('2026-01-09 09:06:00+00'); select t.ok(t.worker() = 1 and t.dstatus(t.v('A')::uuid, 'initial') = 'sent/1', 'A0 setup: initial e-mail sent the day before');
select t.at('2026-01-10 09:01:00+00'); select t.ok((t.save('b1', '{"reminder_email": false}')->>'changed')::boolean, 'A1 09:01 Staff turns reminder e-mail off');
select t.at('2026-01-10 09:09:00+00'); select t.ok((t.save('b1', '{"reminder_email": true}')->>'changed')::boolean, 'A2 09:09 turns it back on');
select t.at('2026-01-10 09:15:00+00');
select t.cron_web();                                                   -- SQL cron path
select t.ok(t.web(t.v('A')::uuid, 'assessment_reminder') = 1, 'A3 SQL cron: one web reminder (web was never off)');
select t.ok(t.worker() = 0, 'A4 e-mail worker 09:15 sends nothing');
select t.ok(t.attempts(t.v('A')::uuid, 'reminder') = 0 and t.dstatus(t.v('A')::uuid, 'reminder') = 'suppressed/0'
  and t.sinkn(t.v('A')::uuid, 'reminder') = 0, 'A5 old reminder e-mail: zero attempts, terminal suppressed');
select t.ok(exists (select 1 from public.resident_notification_suppressions where request_id = t.v('A')::uuid and kind = 'reminder' and channel = 'email'), 'A6 suppression recorded (permanent)');
select t.at('2026-01-10 09:30:00+00'); select t.cron_web(); select t.worker();
select t.ok(t.web(t.v('A')::uuid, 'assessment_reminder') = 1 and t.attempts(t.v('A')::uuid, 'reminder') = 0 and t.dstatus(t.v('A')::uuid, 'reminder') = 'suppressed/0', 'A7 next round: still one web row, zero attempts, suppressed');
select t.put('A2', t.req('c2', 'b1', 'EPA-2', '2026-01-09 09:20:00+00'));   -- same Staff, same kind, due 09:20 (after re-enable)
select t.at('2026-01-10 09:30:00+00'); select t.cron_web();
select t.ok(t.worker() = 1 and t.sinkn(t.v('A2')::uuid, 'reminder') = 1 and t.dstatus(t.v('A2')::uuid, 'reminder') = 'sent/1', 'A8 a reminder due after re-enable is sent once');
select t.at('2026-01-10 09:45:00+00'); select t.cron_web(); select t.worker();
select t.ok(t.sinkn(t.v('A2')::uuid, 'reminder') = 1 and t.web(t.v('A2')::uuid, 'assessment_reminder') = 1 and t.sinkn(t.v('A')::uuid, 'reminder') = 0, 'A9 following round: no repeat for either request');
select t.ok(t.web(t.v('A')::uuid, 'assessment_requested') = 1 and t.web(t.v('A2')::uuid, 'assessment_requested') = 1, 'A10 request web notifications were created normally');

-- ===================== Case B: reminder due while ON; attempt 1 fails before SMTP; off and on before the retry
select t.put('B', t.req('c1', 'b2', 'EPA-3', '2026-01-09 10:05:00+00'));       -- due 2026-01-10 10:05
select t.at('2026-01-09 10:06:00+00'); select t.worker();                          -- initial sent
select t.at('2026-01-10 10:06:00+00'); select t.cron_web();
select t.ok(t.worker('failed_before_smtp') = 1 and t.dstatus(t.v('B')::uuid, 'reminder') = 'failed/1', 'B1 attempt 1 fails before SMTP received it (retryable)');
select t.at('2026-01-10 10:10:00+00'); select t.save('b2', '{"reminder_email": false}');
select t.at('2026-01-10 10:20:00+00'); select t.save('b2', '{"reminder_email": true}');
select t.at('2026-01-10 16:30:00+00'); select t.cron_web(); select t.worker();     -- retry after the 6 h back-off
select t.ok(t.attempts(t.v('B')::uuid, 'reminder') = 1 and t.dstatus(t.v('B')::uuid, 'reminder') = 'suppressed/1' and t.sinkn(t.v('B')::uuid, 'reminder') = 0, 'B2 retry round: attempt count stays 1, terminal suppressed');
select t.ok(t.web(t.v('B')::uuid, 'assessment_reminder') = 1, 'B3 one web reminder');
select t.at('2026-01-11 00:00:00+00'); select t.cron_web(); select t.worker();
select t.ok(t.attempts(t.v('B')::uuid, 'reminder') = 1 and t.web(t.v('B')::uuid, 'assessment_reminder') = 1, 'B4 next round: still 1 attempt, 1 web row');
select t.put('B2', t.req('c2', 'b2', 'EPA-4', '2026-01-10 10:25:00+00'));        -- due 2026-01-11 10:25, after re-enable
select t.at('2026-01-11 10:30:00+00'); select t.cron_web();
select t.ok(t.worker() = 1 and t.sinkn(t.v('B2')::uuid, 'reminder') = 1, 'B5 a new reminder after re-enable is sent once');
select t.ok(not exists (select 1 from public.rc_notif_due_email_work(500, interval '0 seconds') w where w.request_id = t.v('B')::uuid), 'B6 the suppressed delivery is no longer on the work list (no retry)');

-- ===================== boundaries [off_at, on_at)
select t.put('E1', t.req('c1', 'b1', 'EPA-5', '2026-01-19 11:00:00+00'));       -- due 01-20 11:00
select t.put('E2', t.req('c2', 'b1', 'EPA-6', '2026-01-19 11:10:00+00'));       -- due 01-20 11:10
select t.at('2026-01-20 11:00:00+00'); select t.save('b1', '{"reminder_email": false}');   -- off exactly at E1's event
select t.at('2026-01-20 11:10:00+00'); select t.save('b1', '{"reminder_email": true}');    -- on exactly at E2's event
select t.at('2026-01-20 11:20:00+00'); select t.worker();
select t.ok(t.dstatus(t.v('E1')::uuid, 'reminder') = 'suppressed/0', 'E1 event exactly at off_at → suppressed');
select t.ok(t.dstatus(t.v('E2')::uuid, 'reminder') = 'sent/1', 'E2 event exactly at on_at → allowed');
select t.put('E3', t.req('c1', 'b1', 'EPA-7-L1-L2', '2026-01-21 08:00:00+00'));
select t.at('2026-01-22 07:00:00+00'); select t.save('b1', '{"reminder_email": false}');  -- open-ended off before the event
select t.at('2026-01-22 09:00:00+00'); select t.worker();
select t.ok(t.dstatus(t.v('E3')::uuid, 'reminder') = 'suppressed/0', 'E3 open-ended off period suppresses later events');
select t.at('2026-01-22 09:30:00+00'); select t.save('b1', '{"reminder_email": true}');
-- reserved (claimed) and then turned off before authorization → not sent
select t.put('E4', t.req('c2', 'b1', 'EPA-7-L3', '2026-01-21 09:40:00+00'));
select t.at('2026-01-22 09:45:00+00');
select t.put('E4d', public.rc_notif_reserve_email(t.v('E4')::uuid, 'reminder')->>'delivery_id');
select t.at('2026-01-22 09:46:00+00'); select t.save('b1', '{"reminder_email": false}');
select t.at('2026-01-22 09:47:00+00');
select t.ok((public.rc_notif_authorize_email_attempt(t.v('E4d')::uuid)->>'reason') = 'suppressed' and t.dstatus(t.v('E4')::uuid, 'reminder') = 'suppressed/0', 'E4 a reservation gives no permission: off before authorization → no attempt');
select t.at('2026-01-22 10:00:00+00'); select t.save('b1', '{"reminder_email": true}');

-- ===================== saves: same values, failures, stale version, own-only
select t.put('ver', (t.q('b1', 'select public.rc_notif_get_my_preferences()')->>'version'));
select t.put('periods', (select count(*)::text from public.resident_notification_off_periods where user_id = t.id('b1')));
select t.ok((t.save('b1', '{"reminder_email": true, "request_web": true}')->>'changed')::boolean = false
  and (t.q('b1', 'select public.rc_notif_get_my_preferences()')->>'version') = t.v('ver')
  and (select count(*)::text from public.resident_notification_off_periods where user_id = t.id('b1')) = t.v('periods'), 'S1 saving the same values: no new version, no period');
select t.err('b1', format('select public.rc_notif_save_my_preferences(%s, %L)', t.v('ver'), '{"reminder_email": "no"}'), 'must be true or false', 'S2 invalid value refused');
select t.err('b1', format('select public.rc_notif_save_my_preferences(%s, %L)', t.v('ver'), '{"completed_email": false}'), 'is not a setting', 'S3 no e-mail setting for completed assessments');
select t.ok((select count(*)::text from public.resident_notification_off_periods where user_id = t.id('b1')) = t.v('periods'), 'S4 failed saves left no period');
select t.err('b1', format('select public.rc_notif_save_my_preferences(%s, %L)', t.v('ver')::int - 1, '{"request_web": false}'), 'RC_NOTIF_VERSION_CONFLICT', 'S5 stale version refused');
select t.ok((t.q('c1', 'select public.rc_notif_get_my_preferences()')->>'user_id') = t.id('c1')::text and (t.q('c1', 'select public.rc_notif_get_my_preferences()')->>'version') = '0', 'S6 a user without settings gets defaults (version 0) for themselves');
select t.err('c9', 'select public.rc_notif_get_my_preferences()', 'RC_NOTIF_FORBIDDEN', 'S7 inactive account refused');
select t.err(null, 'select public.rc_notif_get_my_preferences()', 'RC_NOTIF_FORBIDDEN', 'S8 no login refused');
select t.err_role('anon', 'select public.rc_notif_get_my_preferences()', 'permission denied', 'S9 anon cannot call');
select t.err_role('authenticated', 'select * from public.resident_notification_preferences', 'permission denied', 'S10 no direct REST read of preferences');
select t.err_role('authenticated', 'select * from public.resident_notification_off_periods', 'permission denied', 'S11 no direct REST read of history');
select t.err_role('service_role', 'select * from public.resident_notification_suppressions', 'permission denied', 'S12 service_role has no direct table access either');
select t.err_role('authenticated', format('select public.rc_notif_authorize_email_attempt(%L)', t.v('E4d')), 'permission denied', 'S13 browser cannot authorize e-mail');
select t.ok((select count(*) = 0 from pg_proc p where p.proname = 'rc_notif_save_my_preferences' and pg_get_function_identity_arguments(p.oid) ~ 'uuid'), 'S14 save takes no target user id (Admin cannot edit others)');

-- ===================== existing users, separate channels, workflow
select t.at('2026-01-25 08:00:00+00');
update public.resident_notifications set read_at = '2026-01-24 00:00:00+00' where request_id = t.v('E3')::uuid and notification_type = 'assessment_reminder';  -- Staff read it
select t.ok(t.web(t.v('E3')::uuid, 'assessment_reminder') = 1, 'U1 setup: existing read reminder row');
select t.cron_web(); select t.worker();
select t.ok(t.web(t.v('E3')::uuid, 'assessment_reminder') = 1 and (select read_at = '2026-01-24 00:00:00+00' from public.resident_notifications where request_id = t.v('E3')::uuid and notification_type = 'assessment_reminder'), 'U1b later cron/worker runs keep the existing row and its read_at');
select t.ok(not exists (select 1 from public.resident_notification_preferences where user_id in (t.id('c2'), t.id('a1')))
  and not exists (select 1 from public.resident_notification_off_periods where user_id in (t.id('c2'), t.id('a1'))), 'U1c users who never saved have no rows: defaults, no back-filled history');
-- the four web/e-mail pairs for NEW requests (Staff b2)
create function t.pair(web boolean, email boolean, code text, at text) returns text language plpgsql as $$
declare r uuid;
begin
  perform t.at(at); perform t.save('b2', jsonb_build_object('request_web', web, 'request_email', email));
  r := t.req('c1', 'b2', code, at); perform t.at(at);
  perform t.worker();
  return t.web(r, 'assessment_requested') || '/' || t.sinkn(r, 'initial');
end $$;
grant execute on function t.pair(boolean, boolean, text, text) to authenticated;
select t.ok(t.pair(true, true, 'PBA-01', '2026-01-25 09:00:00+00') = '1/1', 'U2 request web on / e-mail on → 1 web, 1 e-mail');
select t.ok(t.pair(false, true, 'PBA-02', '2026-01-25 09:10:00+00') = '0/1', 'U3 web off / e-mail on → 0 web, 1 e-mail');
select t.ok(t.pair(true, false, 'PBA-03', '2026-01-25 09:20:00+00') = '1/0', 'U4 web on / e-mail off → 1 web, 0 e-mail');
select t.ok(t.pair(false, false, 'PBA-04', '2026-01-25 09:30:00+00') = '0/0', 'U5 web off / e-mail off → nothing');
-- request e-mail off only: reminders still go out
select t.put('U6', t.req('c2', 'b2', 'PBA-05', '2026-01-25 09:40:00+00'));
select t.at('2026-01-26 09:45:00+00'); select t.cron_web(); select t.worker();
select t.ok(t.sinkn(t.v('U6')::uuid, 'reminder') = 1 and t.web(t.v('U6')::uuid, 'assessment_reminder') = 1 and t.sinkn(t.v('U6')::uuid, 'initial') = 0, 'U6 request e-mail off: no initial e-mail, reminder e-mail + web still work');
-- completed (web only) for the Resident: off → no row; the workflow itself still completes
select t.at('2026-01-26 10:00:00+00'); select t.save('c2', '{"completed_web": false}');  -- E2 belongs to Resident c2
select set_config('request.jwt.claim.sub', t.id('b1')::text, true);
select public.complete_resident_assessment_request(t.v('E2')::uuid,
  (select d.outcome_options->>0 from public.resident_template_definitions d join public.resident_assessment_requests r on r.template_id = d.id where r.id = t.v('E2')::uuid), '',
  (select coalesce(jsonb_agg(jsonb_build_object('criterionId', c.id, 'score', d.score_options->>0, 'comment', '') order by c.sort_order), '[]'::jsonb)
     from public.resident_assessment_requests r join public.resident_template_definitions d on d.id = r.template_id
     join public.resident_template_criteria c on c.template_id = d.id and c.active where r.id = t.v('E2')::uuid));
select t.ok((select status = 'completed' from public.resident_assessment_requests where id = t.v('E2')::uuid), 'W1 evaluation still completes');
select t.ok(t.web(t.v('E2')::uuid, 'assessment_completed') = 0, 'W2 completed web notification suppressed for a Resident who turned it off');
select t.put('W3', t.req('c2', 'b1', 'PBA-06', '2026-01-26 10:05:00+00'));
select set_config('request.jwt.claim.sub', t.id('c2')::text, true);
select public.cancel_resident_assessment_request(t.v('W3')::uuid);
select t.ok(t.web(t.v('W3')::uuid, 'assessment_requested') = 0, 'W3 cancel still removes the request notification');
select t.at('2026-01-27 10:10:00+00'); select t.cron_web(); select t.worker();
select t.ok(t.web(t.v('W3')::uuid, 'assessment_reminder') = 0 and t.dstatus(t.v('W3')::uuid, 'reminder') = 'none', 'W4 no reminder for a cancelled request');

-- ===================== decision failure → nothing sent, workflow not blocked
create or replace function private.rc_notif_now() returns timestamptz language sql volatile set search_path = '' as $$ select now() + make_interval(secs => 1/0) $$;
select t.put('F1', t.req('c1', 'b1', 'PBA-07', '2026-01-28 08:00:00+00'));
create function t.pending(req uuid, typ text) returns bigint language sql as $$ select count(*) from public.resident_notification_pending_web where request_id = req and notification_type = typ $$;
grant execute on function t.pending(uuid, text) to authenticated;
select t.ok(t.v('F1') is not null and t.web(t.v('F1')::uuid, 'assessment_requested') = 0 and t.pending(t.v('F1')::uuid, 'assessment_requested') = 1,
  'F1 (I01) decision failure: request still submitted, no notification, the undecided notification is kept durably');
do $$ begin
  begin perform public.rc_notif_reserve_email((select v from t.ctx where k = 'F1')::uuid, 'initial');
        raise exception 'FAIL F2 reservation succeeded during a decision failure';
  exception when division_by_zero then raise notice 'PASS F2 e-mail decision failure: reservation errors, nothing is reserved or sent'; end;
end $$;
select t.put('F3r', public.rc_notif_retry_pending_web(10)::text);
select t.ok((t.v('F3r')::jsonb->>'still_pending')::int = 1 and t.pending(t.v('F1')::uuid, 'assessment_requested') = 1 and t.web(t.v('F1')::uuid, 'assessment_requested') = 0
  and (select attempts = 2 from public.resident_notification_pending_web where request_id = t.v('F1')::uuid), 'F3 retry while the fault lasts: still pending (attempts 2), nothing created');
-- more undecided events while the fault lasts: a request that will be cancelled, one whose recipient turns web off, and a completion
select t.put('F4', t.req('c2', 'b1', 'PBA-13', '2026-01-28 08:10:00+00'));
select t.put('F5', t.req('c1', 'b2', 'PBA-14', '2026-01-28 08:20:00+00'));
select t.put('F6', t.req('c1', 'b2', 'PBA-15', '2026-01-28 08:30:00+00'));   -- Resident c1 never turned completed off
select set_config('request.jwt.claim.sub', t.id('b2')::text, true);
select public.complete_resident_assessment_request(t.v('F6')::uuid,
  (select d.outcome_options->>0 from public.resident_template_definitions d join public.resident_assessment_requests r on r.template_id = d.id where r.id = t.v('F6')::uuid), '',
  (select coalesce(jsonb_agg(jsonb_build_object('criterionId', c.id, 'score', d.score_options->>0, 'comment', '') order by c.sort_order), '[]'::jsonb)
     from public.resident_assessment_requests r join public.resident_template_definitions d on d.id = r.template_id
     join public.resident_template_criteria c on c.template_id = d.id and c.active where r.id = t.v('F6')::uuid));
select t.ok((select status = 'completed' from public.resident_assessment_requests where id = t.v('F6')::uuid) and t.web(t.v('F6')::uuid, 'assessment_completed') = 0
  and t.pending(t.v('F6')::uuid, 'assessment_completed') = 1, 'F4 completion during the fault: saved, completed notification kept pending');
create or replace function private.rc_notif_now() returns timestamptz language sql volatile set search_path = '' as $$ select now from t.clock $$;
select set_config('request.jwt.claim.sub', t.id('c2')::text, true);
select public.cancel_resident_assessment_request(t.v('F4')::uuid);                        -- cancelled before the retry
select t.at('2026-01-28 08:40:00+00'); select t.save('b2', '{"request_web": false}');    -- F5's recipient turns web off
select t.at('2026-01-28 09:00:00+00');
-- Advance eligibility for the retry postponed by F3 (real worker clock, independent of preference clock).
update public.resident_notification_pending_web set retry_after = clock_timestamp() - interval '1 second';
select t.put('Fr', public.rc_notif_retry_pending_web(50)::text);
select t.ok(t.web(t.v('F1')::uuid, 'assessment_requested') = 1, 'F5 fault over: the request notification is created once');
select t.ok(t.web(t.v('F6')::uuid, 'assessment_completed') = 1, 'F6 the completed notification is created once');
select t.ok(t.web(t.v('F4')::uuid, 'assessment_requested') = 0, 'F7 nothing for a request cancelled meanwhile');
select t.ok(t.web(t.v('F5')::uuid, 'assessment_requested') = 0 and exists (select 1 from public.resident_notification_suppressions
  where request_id = t.v('F5')::uuid and kind = 'request' and channel = 'web'), 'F8 an off period between the event and the retry suppresses it (permanent)');
select t.ok((select count(*) = 0 from public.resident_notification_pending_web), 'F9 queue empty after the retry');
select public.rc_notif_retry_pending_web(50);
select t.ok(t.web(t.v('F1')::uuid, 'assessment_requested') = 1 and t.web(t.v('F6')::uuid, 'assessment_completed') = 1, 'F10 a second retry creates no duplicate');
select t.at('2026-01-28 09:05:00+00'); select t.save('b2', '{"request_web": true}');
select t.ok(t.dstatus(t.v('F1')::uuid, 'initial') = 'none', 'F11 no delivery row was left by the failure');

-- ===================== many suppressed rows do not block normal work
select t.at('2026-02-01 08:00:00+00'); select t.save('b2', '{"reminder_email": false}');
insert into public.resident_assessment_requests (template_id, resident_id, staff_id, assessment_date, clinical_context, procedure_or_activity, status, submitted_at, attempt_number)
  select (select id from public.resident_template_definitions where template_code = 'EPA-1'), t.id('c1'), t.id('b2'), '2026-01-01', 'ctx', 'bulk ' || g, 'pending', '2026-01-01 00:00:00+00'::timestamptz + g * interval '1 second', 1000 + g
    from generate_series(1, 260) g;
create function t.bulk_suppressed() returns bigint language sql as $$ select count(*) from public.resident_assessment_email_deliveries d join public.resident_assessment_requests r on r.id = d.request_id where r.procedure_or_activity like 'bulk %' and d.status = 'suppressed' $$;
select t.at('2026-02-01 08:30:00+00'); select t.worker();
select t.ok(t.bulk_suppressed() = 200, 'M1 first run settles a full batch of 200 as suppressed (no attempt)');
select t.at('2026-02-01 08:45:00+00'); select t.worker();
select t.ok(t.bulk_suppressed() = 260 and (select count(*) = 0 from t.sink s join public.resident_assessment_requests r on r.id = s.request_id where r.procedure_or_activity like 'bulk %'), 'M1b second run settles the other 60; none sent');
select t.put('M2', t.req('c2', 'b1', 'PBA-08', '2026-02-01 09:00:00+00'));
select t.at('2026-02-01 09:05:00+00');
select t.ok((select count(*) from public.rc_notif_due_email_work(200, interval '6 hours') w where w.request_id = t.v('M2')::uuid) = 1, 'M2 suppressed rows are filtered before the limit: the new request is on a 200-row work list');
select t.worker(); select t.ok(t.sinkn(t.v('M2')::uuid, 'initial') = 1, 'M3 and it is sent');

-- ===================== attempt tokens: stale attempt cannot be reused; unknown outcome is terminal
select t.put('T1', t.req('c1', 'b1', 'PBA-09', '2026-02-02 08:00:00+00'));
select t.at('2026-02-02 08:01:00+00');
select t.put('T1d', public.rc_notif_reserve_email(t.v('T1')::uuid, 'initial')->>'delivery_id');
select t.put('T1a', public.rc_notif_authorize_email_attempt(t.v('T1d')::uuid)->>'attempt_id');
select t.ok((public.rc_notif_authorize_email_attempt(t.v('T1d')::uuid)->>'reason') = 'attempt_in_progress', 'K1 a second worker gets no permission while an attempt is open');
select t.ok((public.rc_notif_finish_email_attempt(t.v('T1a')::uuid, 'uncertain', null, 'timeout after DATA')->>'accepted')::boolean and t.dstatus(t.v('T1')::uuid, 'initial') = 'uncertain/1', 'K2 unknown SMTP outcome → terminal uncertain');
select t.ok((public.rc_notif_finish_email_attempt(t.v('T1a')::uuid, 'sent', 'late', null)->>'accepted')::boolean = false, 'K3 the same attempt cannot be reported twice (stale worker)');
select t.at('2026-02-02 09:00:00+00');
select t.ok(public.rc_notif_reserve_email(t.v('T1')::uuid, 'initial')->>'delivery_id' is null and t.attempts(t.v('T1')::uuid, 'initial') = 1, 'K4 uncertain is never claimed again (no automatic duplicate)');
select t.put('T2', t.req('c2', 'b1', 'PBA-10', '2026-02-02 10:00:00+00'));
select t.at('2026-02-02 10:01:00+00');
select t.put('T2d', public.rc_notif_reserve_email(t.v('T2')::uuid, 'initial')->>'delivery_id');
select t.put('T2a', public.rc_notif_authorize_email_attempt(t.v('T2d')::uuid)->>'attempt_id');
select t.at('2026-02-02 10:20:00+00');   -- worker died after permission; nothing reported for 19 minutes
select t.ok(not exists (select 1 from public.rc_notif_due_email_work() where request_id = t.v('T2')::uuid), 'K5 normal work list reconciles an expired attempt without offering it for sending');
select t.ok(t.dstatus(t.v('T2')::uuid, 'initial') = 'uncertain/1'
 and (select status = 'uncertain' from public.resident_assessment_email_attempts where id = t.v('T2a')::uuid), 'K6 both ledger rows become terminal uncertain');
select t.ok(public.rc_notif_reserve_email(t.v('T2')::uuid, 'initial')->>'reason' = 'uncertain'
 and not (public.rc_notif_finish_email_attempt(t.v('T2a')::uuid, 'sent', 'late', null)->>'accepted')::boolean, 'K7 no re-reservation or late finish after reconciliation');

-- ===================== a missing reservation always has an explicit reason (never read as opt-out)
select t.ok(public.rc_notif_reserve_email(t.v('A')::uuid, 'reminder')->>'reason' = 'suppressed', 'Q1 suppressed delivery → reason suppressed');
select t.ok(public.rc_notif_reserve_email(t.v('A2')::uuid, 'reminder')->>'reason' = 'already_sent', 'Q2 sent delivery → reason already_sent');
select t.ok(public.rc_notif_reserve_email(t.v('T1')::uuid, 'initial')->>'reason' = 'uncertain', 'Q3 unknown outcome → reason uncertain');
select t.ok(public.rc_notif_reserve_email(t.v('E2')::uuid, 'reminder')->>'reason' = 'not_pending', 'Q4 completed request → reason not_pending');
select t.put('Q5', t.req('c1', 'b1', 'PBA-11', '2026-02-03 08:00:00+00')); select t.at('2026-02-03 08:01:00+00');
select t.ok(public.rc_notif_reserve_email(t.v('Q5')::uuid, 'initial')->>'reason' = 'reserved'
  and public.rc_notif_reserve_email(t.v('Q5')::uuid, 'initial')->>'reason' = 'in_progress', 'Q5 first call reserved, a second worker → in_progress');
update public.resident_staff_directory set email = 'b1-moved@fixture.test', auth_user_id = null where auth_user_id = t.id('b1');
select t.put('Q6', t.req('c2', 'b2', 'PBA-12', '2026-02-03 09:00:00+00'));
update public.resident_assessment_requests set staff_id = t.id('b1') where id = t.v('Q6')::uuid;
select t.ok(public.rc_notif_reserve_email(t.v('Q6')::uuid, 'initial')->>'reason' = 'no_recipient', 'Q6 no Staff-list e-mail for the recipient → reason no_recipient');

-- ===================== I02: a delivery that is being sent is never marked suppressed
update public.resident_staff_directory set email = 'b1@fixture.test', auth_user_id = t.id('b1') where email = 'b1-moved@fixture.test';  -- undo the Q6 setup
select t.put('G1', t.req('c1', 'b1', 'PBA-16', '2026-02-04 08:00:00+00')); select t.at('2026-02-04 08:01:00+00');
select t.put('G1d', public.rc_notif_reserve_email(t.v('G1')::uuid, 'initial')->>'delivery_id');
select t.put('G1a', public.rc_notif_authorize_email_attempt(t.v('G1d')::uuid)->>'attempt_id');
select t.at('2026-02-04 08:02:00+00'); select t.save('b1', '{"request_email": false}');
select t.ok(public.rc_notif_reserve_email(t.v('G1')::uuid, 'initial')->>'reason' = 'in_progress'
  and t.dstatus(t.v('G1')::uuid, 'initial') = 'sending/1'
  and not exists (select 1 from public.resident_notification_suppressions where request_id = t.v('G1')::uuid), 'G1 (I02) reserve again after turning off: in_progress, status unchanged, NO suppression');
select t.at('2026-02-04 08:03:00+00'); select public.rc_notif_finish_email_attempt(t.v('G1a')::uuid, 'sent', 'sink-g1', null);
select t.ok(t.dstatus(t.v('G1')::uuid, 'initial') = 'sent/1' and not exists (select 1 from public.resident_notification_suppressions where request_id = t.v('G1')::uuid),
  'G2 the authorized attempt ends sent; history stays sent, no suppression');
select t.at('2026-02-04 08:04:00+00'); select t.save('b1', '{"request_email": true}');
select t.put('G3', t.req('c2', 'b1', 'PBA-17', '2026-02-04 09:00:00+00')); select t.at('2026-02-04 09:01:00+00');
select t.put('G3d', public.rc_notif_reserve_email(t.v('G3')::uuid, 'initial')->>'delivery_id');
select t.put('G3a', public.rc_notif_authorize_email_attempt(t.v('G3d')::uuid)->>'attempt_id');
select t.at('2026-02-04 09:02:00+00'); select t.save('b1', '{"request_email": false}');
select t.ok(public.rc_notif_reserve_email(t.v('G3')::uuid, 'initial')->>'reason' = 'in_progress', 'G3 off while authorized: in_progress');
select public.rc_notif_finish_email_attempt(t.v('G3a')::uuid, 'failed_before_smtp', null, 'sink: refused');
select t.at('2026-02-04 16:00:00+00');
select t.ok(public.rc_notif_reserve_email(t.v('G3')::uuid, 'initial')->>'reason' = 'suppressed', 'G4 after a definite failure the retry is re-decided from the event time → suppressed');
select t.ok(t.dstatus(t.v('G3')::uuid, 'initial') = 'suppressed/1' and exists (select 1 from public.resident_notification_suppressions where request_id = t.v('G3')::uuid and channel = 'email'), 'G4b terminal suppressed after 1 attempt, suppression recorded');
select t.at('2026-02-04 16:05:00+00'); select t.save('b1', '{"request_email": true}');

-- ===================== I03: one switch for cron and browser; legacy claim retired
do $$ begin
  begin perform public.claim_resident_assessment_email_delivery((select v from t.ctx where k = 'T2')::uuid, 'initial', 'x@fixture.test');
        raise exception 'FAIL H1 legacy claim still works';
  exception when others then
    if sqlerrm !~ 'RC_NOTIF_LEGACY_CLAIM_RETIRED' then raise exception 'FAIL H1 unexpected %', sqlerrm; end if;
    raise notice 'PASS H1 legacy claim (old Edge, cron and browser) is refused';
  end;
end $$;
update public.resident_notification_mail_control set paused = true, paused_at = '2026-02-05 00:00:00+00';
select t.put('H2', t.req('c1', 'b1', 'PBA-18', '2026-02-05 08:00:00+00')); select t.at('2026-02-05 08:01:00+00');
select t.ok(public.rc_notif_reserve_email(t.v('H2')::uuid, 'initial')->>'reason' = 'paused', 'H2 paused: reservation refused with reason paused');
select t.ok(t.worker() = 0, 'H2b paused: the worker sends nothing');
select t.ok(t.dstatus(t.v('H2')::uuid, 'initial') = 'none', 'H2c paused: no delivery row, no attempt');
select t.ok((public.rc_notif_worker_checkin('rc-notif-v1-impl-v3')->>'paused')::boolean, 'H3 the v1 worker checks in and sees paused');
select t.ok((select worker_version = 'rc-notif-v1-impl-v3' and worker_seen_at is not null from public.resident_notification_mail_control), 'H3b the check-in is recorded');
update public.resident_notification_mail_control set paused = false;
select t.ok(t.worker() >= 1, 'H4 after resume the worker sends again');
select t.ok(t.sinkn(t.v('H2')::uuid, 'initial') = 1, 'H4b the waiting e-mail is sent once');

do $$ begin raise notice 'ALL NOTIFICATION PREFERENCE TESTS PASSED'; end $$;
rollback;
