-- RC-NOTIF-V1 — Notification preferences v1 (C1, IMPL-01).
-- * Own preferences (web/email per kind) with a version; history of OFF periods [off_at, on_at);
--   permanent per-event suppressions (request, recipient, kind, channel).
-- * ONE decision for every creator of a web notification: a BEFORE INSERT trigger on resident_notifications
--   (submit, complete, the SQL cron reminder job, the Edge Function upsert, old Edge versions).
-- * E-mail: the legacy claim is retired (old workers cannot bypass the per-attempt decision);
--   the new Edge Function asks for permission per attempt (rc_notif_authorize_email_attempt) right before
--   SMTP and reports the outcome (rc_notif_finish_email_attempt).
-- Decision rule (UTC, database clock): a notification of kind K on channel C whose event happened at E is
-- suppressed if ANY off period of (recipient, K, C) overlaps [E, decision time D]:
--     off_at <= D  and  (on_at is null or on_at > E)
-- i.e. an event exactly at off_at is suppressed, an event exactly at on_at is allowed. A suppression is
-- recorded and is permanent; turning the channel back on never re-sends it.
-- Event time E: request = submitted_at, reminder = submitted_at + 24 h, completed = assessed_at.
-- Lock order: mail control (shared for admissions) -> request -> recipient advisory -> delivery -> attempt.
-- Web paths use request -> recipient -> retry queue. Save takes only the recipient lock; bulk web paths
-- defer rather than wait on request/recipient locks. Finish/reconciliation take delivery then attempt.
-- No existing row is changed by this migration (defaults = everything on = behaviour before v1); the only row written
-- is the e-mail control switch, which starts PAUSED (I03).

set lock_timeout = '15s';

-- ------------------------------------------------------------------ tables
create table public.resident_notification_preferences (
  user_id uuid primary key references public.resident_profiles(user_id) on delete cascade,
  request_web boolean not null default true,
  request_email boolean not null default true,
  reminder_web boolean not null default true,
  reminder_email boolean not null default true,
  completed_web boolean not null default true,
  version integer not null check (version >= 1),
  updated_at timestamptz not null
);

create table public.resident_notification_off_periods (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.resident_profiles(user_id) on delete cascade,
  kind text not null check (kind in ('request', 'reminder', 'completed')),
  channel text not null check (channel in ('web', 'email')),
  off_at timestamptz not null,
  on_at timestamptz,
  off_version integer not null,
  on_version integer,
  check (on_at is null or on_at > off_at),
  check (kind <> 'completed' or channel = 'web')
);
create unique index resident_notification_one_open_period
  on public.resident_notification_off_periods (user_id, kind, channel) where on_at is null;
create index resident_notification_off_periods_lookup
  on public.resident_notification_off_periods (user_id, kind, channel, off_at);

create table public.resident_notification_suppressions (
  request_id uuid not null references public.resident_assessment_requests(id) on delete cascade,
  recipient_id uuid not null references public.resident_profiles(user_id) on delete cascade,
  kind text not null check (kind in ('request', 'reminder', 'completed')),
  channel text not null check (channel in ('web', 'email')),
  event_at timestamptz not null,
  decided_at timestamptz not null,
  off_period_id bigint references public.resident_notification_off_periods(id) on delete set null,
  primary key (request_id, recipient_id, kind, channel)
);

alter table public.resident_assessment_email_deliveries
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column reservation_v3 boolean not null default false;
alter table public.resident_assessment_email_deliveries
  drop constraint resident_assessment_email_deliveries_status_check;
alter table public.resident_assessment_email_deliveries
  add constraint resident_assessment_email_deliveries_status_check
  check (status in ('sending', 'sent', 'failed', 'suppressed', 'uncertain'));

create table public.resident_assessment_email_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.resident_assessment_email_deliveries(id) on delete cascade,
  attempt_no integer not null check (attempt_no >= 1),
  status text not null check (status in ('authorized', 'sent', 'failed_before_smtp', 'uncertain')),
  authorized_at timestamptz not null,
  finished_at timestamptz,
  provider_message_id text,
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  unique (delivery_id, attempt_no)
);
create unique index resident_assessment_email_one_open_attempt
  on public.resident_assessment_email_attempts (delivery_id) where status = 'authorized';

-- I01 (v2): a web notification whose decision could not be made is kept here, in the same transaction as the
-- workflow, and retried later from the ORIGINAL event time (request row) under the same rules. One per event.
create table public.resident_notification_pending_web (
  request_id uuid not null references public.resident_assessment_requests(id) on delete cascade,
  recipient_id uuid not null references public.resident_profiles(user_id) on delete cascade,
  notification_type text not null check (notification_type in ('assessment_requested', 'assessment_reminder', 'assessment_completed')),
  title text not null,
  message text not null,
  first_failed_at timestamptz not null,
  retry_after timestamptz not null default clock_timestamp(),
  attempts integer not null default 1,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  primary key (request_id, recipient_id, notification_type)
);

-- I03 (v2): one switch for every e-mail path (cron and browser). Starts PAUSED: e-mail stays off from the moment
-- this migration commits until supabase/manual/notif_v1_mail_worker_resume.sql has seen the new worker check in.
create table public.resident_notification_mail_control (
  id boolean primary key default true check (id),
  paused boolean not null,
  paused_at timestamptz not null,
  reason text,
  worker_version text,
  worker_seen_at timestamptz
);
insert into public.resident_notification_mail_control (id, paused, paused_at, reason)
values (true, true, clock_timestamp(), 'paused by migration 20261118090000 until the v1 worker is confirmed');

do $$
declare t text;
begin
  foreach t in array array['resident_notification_preferences', 'resident_notification_off_periods',
    'resident_notification_suppressions', 'resident_assessment_email_attempts',
    'resident_notification_pending_web', 'resident_notification_mail_control'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;
revoke all on sequence public.resident_notification_off_periods_id_seq from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------ helpers (private, no client role)
-- Database clock used by every decision; tests replace this one function to fix the time.
create or replace function private.rc_notif_now()
returns timestamptz language sql volatile set search_path = '' as $$ select clock_timestamp() $$;

create or replace function private.rc_notif_lock(p_user_id uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('rc_notif:' || p_user_id::text, 0));
$$;

-- Shared row lock makes a committed pause an admission barrier. A queued admission
-- reads the current value after any concurrent pause/update has committed.
create or replace function private.rc_notif_mail_open()
returns boolean language plpgsql volatile set search_path = '' as $$
declare v_paused boolean;
begin
  select paused into v_paused from public.resident_notification_mail_control where id for share;
  return v_paused is false;
end;
$$;

create or replace function private.rc_notif_try_lock(p_user_id uuid)
returns boolean language sql volatile set search_path = '' as $$
  select pg_try_advisory_xact_lock(hashtextextended('rc_notif:' || p_user_id::text, 0));
$$;

create or replace function private.rc_notif_event_at(p_kind text, p_submitted_at timestamptz, p_assessed_at timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select case p_kind when 'request' then p_submitted_at
                     when 'reminder' then p_submitted_at + interval '24 hours'
                     when 'completed' then p_assessed_at end;
$$;

-- Caller must hold private.rc_notif_lock(p_recipient). Returns 'allow' or 'suppressed' (and records it).
create or replace function private.rc_notif_decide(p_request_id uuid, p_recipient uuid, p_kind text, p_channel text, p_event_at timestamptz)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_now timestamptz := private.rc_notif_now(); v_off bigint;
begin
  if p_event_at is null then raise exception 'RC_NOTIF_NO_EVENT_TIME'; end if;
  if exists (select 1 from public.resident_notification_suppressions
              where request_id = p_request_id and recipient_id = p_recipient and kind = p_kind and channel = p_channel) then
    return 'suppressed';
  end if;
  select id into v_off from public.resident_notification_off_periods
   where user_id = p_recipient and kind = p_kind and channel = p_channel
     and off_at <= v_now and (on_at is null or on_at > p_event_at)
   order by off_at limit 1;
  if v_off is null then return 'allow'; end if;
  insert into public.resident_notification_suppressions (request_id, recipient_id, kind, channel, event_at, decided_at, off_period_id)
  values (p_request_id, p_recipient, p_kind, p_channel, p_event_at, v_now, v_off)
  on conflict do nothing;
  return 'suppressed';
end;
$$;

-- ------------------------------------------------------------------ web: one decision for every creator
create or replace function private.rc_notif_web_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_req public.resident_assessment_requests%rowtype; v_kind text; v_event timestamptz;
begin
  v_kind := case new.notification_type when 'assessment_requested' then 'request'
                                       when 'assessment_reminder' then 'reminder'
                                       when 'assessment_completed' then 'completed' end;
  if v_kind is null then return new; end if;
  begin
    select * into v_req from public.resident_assessment_requests where id = new.request_id for share nowait;
    if not found then return null; end if;
    -- Serialize with both cancellation and completion; the mutating workflows
    -- already own their request row. Bulk writers must not wait while holding a different recipient.
    if not (case v_kind
      when 'request' then v_req.status = 'pending' and v_req.staff_id = new.recipient_id
      when 'reminder' then v_req.status = 'pending' and v_req.staff_id = new.recipient_id
        and v_req.submitted_at + interval '24 hours' <= private.rc_notif_now()
      when 'completed' then v_req.status = 'completed' and v_req.resident_id = new.recipient_id
    end) then return null; end if;
    if exists (select 1 from public.resident_notifications
                where request_id = new.request_id and recipient_id = new.recipient_id and notification_type = new.notification_type) then
      return new;
    end if;
    if not private.rc_notif_try_lock(new.recipient_id) then
      raise lock_not_available using message = 'notification recipient busy';
    end if;
    v_event := private.rc_notif_event_at(v_kind, v_req.submitted_at, v_req.assessed_at);
    if private.rc_notif_decide(new.request_id, new.recipient_id, v_kind, 'web', v_event) = 'suppressed' then return null; end if;
    return new;
  exception when others then
    -- I01 (v2): fail closed AND keep the work: the notification is not created now, but a pending row is written in
    -- this same transaction and retried later (private.rc_notif_retry_pending_web). If even that cannot be written,
    -- the error is raised, so nothing is silently lost (the workflow transaction fails and can be retried).
    insert into public.resident_notification_pending_web (request_id, recipient_id, notification_type, title, message, first_failed_at, last_error)
    values (new.request_id, new.recipient_id, new.notification_type, new.title, new.message, clock_timestamp(), left(sqlerrm, 500))
    on conflict (request_id, recipient_id, notification_type) do update
      set attempts = public.resident_notification_pending_web.attempts + 1, last_error = excluded.last_error;
    raise warning 'rc_notif web decision failed (%): kept for retry', sqlerrm;
    return null;
  end;
end;
$$;
create trigger rc_notif_web_guard before insert on public.resident_notifications
  for each row execute function private.rc_notif_web_guard();

-- I01 (v2): retry undecided web notifications. Eligibility is re-checked from the request (cancelled/finished or
-- moved requests create nothing); the insert goes through the same trigger, so the decision uses the original
-- event time and every off period up to now; the unique key prevents duplicates. A row stays pending only while
-- its decision keeps failing. Returns counts.
create or replace function public.rc_notif_retry_pending_web(p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.resident_notification_pending_web%rowtype; v_req public.resident_assessment_requests%rowtype;
  v_created integer := 0; v_skipped integer := 0; v_kept integer := 0; v_n integer; v_eligible boolean; v_still boolean;
begin
  for r in select * from public.resident_notification_pending_web
           where retry_after <= clock_timestamp() order by retry_after, first_failed_at, request_id, recipient_id, notification_type
           limit least(greatest(coalesce(p_limit, 200), 1), 1000) loop
    select * into v_req from public.resident_assessment_requests where id = r.request_id for share skip locked;
    if not found then continue; end if; -- locked by a status writer, or deleted (FK removes queue)
    if not private.rc_notif_try_lock(r.recipient_id) then continue; end if;
    v_eligible := found and case r.notification_type
      when 'assessment_requested' then v_req.status = 'pending' and v_req.staff_id = r.recipient_id
      when 'assessment_reminder' then v_req.status = 'pending' and v_req.staff_id = r.recipient_id
      when 'assessment_completed' then v_req.status = 'completed' and v_req.resident_id = r.recipient_id end;
    if not coalesce(v_eligible, false) then
      delete from public.resident_notification_pending_web where request_id = r.request_id and recipient_id = r.recipient_id and notification_type = r.notification_type;
      v_skipped := v_skipped + 1; continue;
    end if;
    -- the trigger re-writes the pending row if the decision fails again
    delete from public.resident_notification_pending_web where request_id = r.request_id and recipient_id = r.recipient_id and notification_type = r.notification_type
     returning * into r;
    if not found then continue; end if; -- another retry already handled the snapshot candidate
    insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message)
    values (r.recipient_id, r.request_id, r.notification_type, r.title, r.message)
    on conflict (request_id, recipient_id, notification_type) do nothing;
    get diagnostics v_n = row_count;
    select exists (select 1 from public.resident_notification_pending_web where request_id = r.request_id and recipient_id = r.recipient_id and notification_type = r.notification_type) into v_still;
    if v_still then
      update public.resident_notification_pending_web set attempts = r.attempts + 1, first_failed_at = r.first_failed_at,
        retry_after = clock_timestamp() + interval '5 minutes'
       where request_id = r.request_id and recipient_id = r.recipient_id and notification_type = r.notification_type;
      v_kept := v_kept + 1;
    elsif v_n = 1 then v_created := v_created + 1;
    else v_skipped := v_skipped + 1;      -- suppressed by an off period, or the row already existed
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'still_pending', v_kept);
end;
$$;

-- ------------------------------------------------------------------ e-mail
-- Reservation (no permission to send). I02 (v2): an open authorized attempt or a fresh reservation is checked
-- BEFORE any decision, so a delivery that is being sent is never marked suppressed; the decision for the next
-- attempt happens only after that attempt is closed (failed → re-decided from the event time; sent/uncertain stay).
create or replace function private.rc_notif_claim(p_request_id uuid, p_delivery_type text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_staff uuid; v_req public.resident_assessment_requests%rowtype; v_kind text; v_email text;
  v_d public.resident_assessment_email_deliveries%rowtype;
begin
  v_kind := case p_delivery_type when 'initial' then 'request' when 'reminder' then 'reminder' end;
  if v_kind is null then raise exception 'RC_NOTIF_INVALID_INPUT: delivery type'; end if;
  select * into v_req from public.resident_assessment_requests where id = p_request_id for share;
  if not found or v_req.status <> 'pending' then return null; end if;
  v_staff := v_req.staff_id;
  perform private.rc_notif_lock(v_staff);
  v_email := lower((select email from public.resident_staff_directory where auth_user_id = v_staff));
  if v_email is null then return null; end if;
  select * into v_d from public.resident_assessment_email_deliveries
   where request_id = p_request_id and delivery_type = p_delivery_type for update;            -- 3 delivery
  if found then
    if v_d.status in ('sent', 'suppressed', 'uncertain')
      or (v_d.status = 'sending' and not v_d.reservation_v3) then return null; end if;
    if exists (select 1 from public.resident_assessment_email_attempts where delivery_id = v_d.id and status = 'authorized') then
      return null;                                                    -- an attempt is in flight: never suppress it
    end if;
    if v_d.status = 'sending' and v_d.attempted_at >= clock_timestamp() - interval '10 minutes' then return null; end if;
  end if;
  if private.rc_notif_decide(p_request_id, v_staff, v_kind, 'email',
       private.rc_notif_event_at(v_kind, v_req.submitted_at, v_req.assessed_at)) = 'suppressed' then
    insert into public.resident_assessment_email_deliveries as d (request_id, delivery_type, recipient_email, status, attempted_at, error_message)
    values (p_request_id, p_delivery_type, v_email, 'suppressed', clock_timestamp(), 'suppressed by the recipient''s notification setting')
    on conflict (request_id, delivery_type) do update
      set status = 'suppressed', error_message = excluded.error_message
      where d.status in ('failed', 'sending');
    return null;
  end if;
  insert into public.resident_assessment_email_deliveries as delivery
    (request_id, delivery_type, recipient_email, status, attempted_at, error_message, reservation_v3)
  values (p_request_id, p_delivery_type, v_email, 'sending', clock_timestamp(), null, true)
  on conflict (request_id, delivery_type) do update
    set recipient_email = excluded.recipient_email, status = 'sending', attempted_at = excluded.attempted_at,
        error_message = null, reservation_v3 = true
    where delivery.status = 'failed'
       or (delivery.status = 'sending' and delivery.attempted_at < clock_timestamp() - interval '10 minutes')
  returning delivery.id into v_id;
  return v_id;
end;
$$;

-- I03 (v2): the legacy claim (used only by the old Edge Function, from cron and from the browser) is retired.
-- It now refuses, so an old worker can never send after this migration — also after an Edge rollback.
-- New workers reserve through public.rc_notif_reserve_email.
create or replace function public.claim_resident_assessment_email_delivery(p_request_id uuid, p_delivery_type text, p_recipient_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'RC_NOTIF_LEGACY_CLAIM_RETIRED: this e-mail worker version does not apply notification settings; deploy the v1 worker';
end;
$$;
revoke all on function public.claim_resident_assessment_email_delivery(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_resident_assessment_email_delivery(uuid, text, text) to service_role;

-- Reservation with an explicit reason (contract: never read a missing claim as an opt-out). Used by the new Edge
-- Function; the old claim stays for old workers. reason: reserved | suppressed (setting off) | already_sent |
-- uncertain (earlier outcome unknown) | in_progress (another worker holds it) | not_pending (request done/cancelled/
-- moved) | no_recipient (no active Staff-list e-mail). Database errors are raised (= unavailable: no send, retry later).
create or replace function public.rc_notif_reserve_email(p_request_id uuid, p_delivery_type text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_req public.resident_assessment_requests%rowtype; v_status text;
begin
  if not private.rc_notif_mail_open() then
    return jsonb_build_object('delivery_id', null, 'reason', 'paused');
  end if;
  v_id := private.rc_notif_claim(p_request_id, p_delivery_type);
  if v_id is not null then return jsonb_build_object('delivery_id', v_id, 'reason', 'reserved'); end if;
  select * into v_req from public.resident_assessment_requests where id = p_request_id;
  if not found or v_req.status <> 'pending' then return jsonb_build_object('delivery_id', null, 'reason', 'not_pending'); end if;
  select status into v_status from public.resident_assessment_email_deliveries where request_id = p_request_id and delivery_type = p_delivery_type;
  return jsonb_build_object('delivery_id', null, 'reason', case v_status
    when 'suppressed' then 'suppressed' when 'sent' then 'already_sent' when 'uncertain' then 'uncertain'
    when 'sending' then 'in_progress' else 'no_recipient' end);
end;
$$;

-- I03 (v2): every run of the v1 worker (cron deliver_due and browser deliver_initial) checks in first and does
-- nothing while e-mail is paused. The resume script requires a check-in of the expected version after the pause.
create or replace function public.rc_notif_worker_checkin(p_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.resident_notification_mail_control%rowtype;
begin
  if p_version is null or char_length(p_version) > 40 then raise exception 'RC_NOTIF_INVALID_INPUT: version'; end if;
  update public.resident_notification_mail_control set worker_version = p_version, worker_seen_at = clock_timestamp() returning * into v;
  return jsonb_build_object('paused', v.paused, 'version', p_version);
end;
$$;

-- Permission for ONE SMTP attempt, decided right before the send. The reservation (claim) gives none.
-- Returns {allowed:true, attempt_id, ...mail data} or {allowed:false, reason}.
create or replace function public.rc_notif_authorize_email_attempt(p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_d public.resident_assessment_email_deliveries%rowtype; v_req public.resident_assessment_requests%rowtype;
  v_staff uuid; v_kind text; v_now timestamptz; v_open public.resident_assessment_email_attempts%rowtype;
  v_attempt uuid; v_dir record; v_resident text; v_template text;
begin
  if not private.rc_notif_mail_open() then
    return jsonb_build_object('allowed', false, 'reason', 'paused');
  end if;
  select * into v_d from public.resident_assessment_email_deliveries where id = p_delivery_id;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'no_delivery'); end if;
  select * into v_req from public.resident_assessment_requests where id = v_d.request_id for share;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'no_request'); end if;
  v_staff := v_req.staff_id;
  perform private.rc_notif_lock(v_staff);
  select * into v_d from public.resident_assessment_email_deliveries where id = p_delivery_id for update;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'no_delivery'); end if;
  v_now := private.rc_notif_now();
  if v_d.status <> 'sending' or not v_d.reservation_v3 then return jsonb_build_object('allowed', false, 'reason', 'not_reserved', 'status', v_d.status); end if;
  select * into v_open from public.resident_assessment_email_attempts where delivery_id = p_delivery_id and status = 'authorized' for update;  -- 4 attempt
  if found then
    if v_open.authorized_at > v_now - interval '10 minutes' then
      return jsonb_build_object('allowed', false, 'reason', 'attempt_in_progress');
    end if;
    -- an earlier attempt never reported back: SMTP may have accepted it → never send again automatically
    update public.resident_assessment_email_attempts set status = 'uncertain', finished_at = v_now,
      error_message = 'no outcome reported within 10 minutes' where id = v_open.id;
    update public.resident_assessment_email_deliveries set status = 'uncertain', error_message = 'previous attempt outcome unknown' where id = p_delivery_id;
    return jsonb_build_object('allowed', false, 'reason', 'uncertain');
  end if;
  if v_req.status <> 'pending' or v_req.staff_id is distinct from v_staff then
    update public.resident_assessment_email_deliveries set status = 'failed', error_message = 'request is no longer pending for this Staff' where id = p_delivery_id;
    return jsonb_build_object('allowed', false, 'reason', 'not_pending');
  end if;
  select d.email, d.full_name into v_dir from public.resident_staff_directory d
    join public.resident_user_roles r on r.user_id = d.auth_user_id and r.role = 'staff' and r.active
    join public.resident_profiles p on p.user_id = d.auth_user_id and p.active
   where d.auth_user_id = v_staff and d.active;
  if v_dir.email is null then
    update public.resident_assessment_email_deliveries set status = 'failed', error_message = 'Selected Staff is not an active registered account' where id = p_delivery_id;
    return jsonb_build_object('allowed', false, 'reason', 'recipient_inactive');
  end if;
  v_kind := case v_d.delivery_type when 'initial' then 'request' else 'reminder' end;
  if private.rc_notif_decide(v_req.id, v_staff, v_kind, 'email', private.rc_notif_event_at(v_kind, v_req.submitted_at, v_req.assessed_at)) = 'suppressed' then
    update public.resident_assessment_email_deliveries set status = 'suppressed', error_message = 'suppressed by the recipient''s notification setting' where id = p_delivery_id;
    return jsonb_build_object('allowed', false, 'reason', 'suppressed');
  end if;
  insert into public.resident_assessment_email_attempts (delivery_id, attempt_no, status, authorized_at)
  values (p_delivery_id, v_d.attempt_count + 1, 'authorized', v_now) returning id into v_attempt;
  update public.resident_assessment_email_deliveries set attempt_count = attempt_count + 1, attempted_at = v_now, recipient_email = lower(v_dir.email)
   where id = p_delivery_id;
  select full_name into v_resident from public.resident_profiles where user_id = v_req.resident_id;
  select template_code into v_template from public.resident_template_definitions where id = v_req.template_id;
  return jsonb_build_object('allowed', true, 'attempt_id', v_attempt, 'attempt_no', v_d.attempt_count + 1,
    'delivery_type', v_d.delivery_type, 'to', lower(v_dir.email), 'staff_name', v_dir.full_name, 'resident_name', v_resident,
    'template_code', v_template, 'activity', v_req.procedure_or_activity);
end;
$$;

-- Outcome of an authorized attempt. Only the current open attempt is accepted (a stale worker cannot reuse it).
-- outcome: 'sent' | 'failed_before_smtp' (SMTP did not get the message → retry later) | 'uncertain' (send started,
-- result unknown → terminal, never retried automatically).
create or replace function public.rc_notif_finish_email_attempt(p_attempt_id uuid, p_outcome text, p_provider_message_id text default null, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_a public.resident_assessment_email_attempts%rowtype; v_now timestamptz := private.rc_notif_now();
begin
  if p_outcome is null or p_outcome not in ('sent', 'failed_before_smtp', 'uncertain') then raise exception 'RC_NOTIF_INVALID_INPUT: outcome'; end if;
  select * into v_a from public.resident_assessment_email_attempts where id = p_attempt_id;
  if not found then return jsonb_build_object('accepted', false, 'reason', 'unknown_attempt'); end if;
  perform 1 from public.resident_assessment_email_deliveries where id = v_a.delivery_id for update;
  select * into v_a from public.resident_assessment_email_attempts where id = p_attempt_id for update;
  if v_a.status <> 'authorized' then return jsonb_build_object('accepted', false, 'reason', 'attempt_closed', 'status', v_a.status); end if;
  update public.resident_assessment_email_attempts set status = p_outcome, finished_at = v_now,
    provider_message_id = case when p_outcome = 'sent' then left(p_provider_message_id, 500) end, error_message = left(p_error, 1000)
   where id = p_attempt_id;
  update public.resident_assessment_email_deliveries set
    status = case p_outcome when 'sent' then 'sent' when 'failed_before_smtp' then 'failed' else 'uncertain' end,
    provider_message_id = case when p_outcome = 'sent' then left(p_provider_message_id, 500) else provider_message_id end,
    sent_at = case when p_outcome = 'sent' then v_now else sent_at end,
    error_message = case when p_outcome = 'sent' then null else left(p_error, 1000) end
   where id = v_a.delivery_id;
  return jsonb_build_object('accepted', true, 'status', p_outcome);
end;
$$;

-- Close lost outcomes before building the normal work list, including attempts
-- for requests no longer pending. No transport call is made by this function.
-- Use the same delivery -> attempt order as finish/authorization.
create or replace function private.rc_notif_reconcile_email(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_now timestamptz := private.rc_notif_now(); v_n integer; v_closed integer := 0;
begin
  for v_id in select d.id
    from public.resident_assessment_email_deliveries d
    join public.resident_assessment_email_attempts a on a.delivery_id = d.id
    where d.status = 'sending' and a.status = 'authorized'
      and a.authorized_at <= v_now - interval '10 minutes'
    order by a.authorized_at, d.id limit greatest(1, least(coalesce(p_limit, 200), 1000))
    for update of d skip locked
  loop
    update public.resident_assessment_email_attempts
       set status = 'uncertain', finished_at = v_now, error_message = 'no outcome reported within 10 minutes'
     where delivery_id = v_id and status = 'authorized'
       and authorized_at <= v_now - interval '10 minutes';
    get diagnostics v_n = row_count;
    if v_n = 1 then
      update public.resident_assessment_email_deliveries
         set status = 'uncertain', error_message = 'previous attempt outcome unknown'
       where id = v_id and status = 'sending';
      v_closed := v_closed + 1;
    end if;
  end loop;
  return v_closed;
end;
$$;

-- Work list for the e-mail worker: pending requests whose due e-mail is neither done nor terminal.
-- Terminal rows (sent, suppressed, uncertain) are filtered BEFORE the limit, so they never fill the batch.
create or replace function public.rc_notif_due_email_work(p_limit integer default 200, p_failed_retry_after interval default interval '6 hours')
returns table (request_id uuid, delivery_type text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.rc_notif_reconcile_email(p_limit);
  return query select r.id, x.t
    from public.resident_assessment_requests r
    cross join lateral (select case when r.submitted_at <= private.rc_notif_now() - interval '24 hours' then 'reminder' else 'initial' end as t) x
    left join public.resident_assessment_email_deliveries d on d.request_id = r.id and d.delivery_type = x.t
   where r.status = 'pending'
     and (d.id is null
          or (d.status = 'failed' and (d.attempted_at <= private.rc_notif_now() - p_failed_retry_after
              or d.error_message = 'reservation released by pause before authorization'))
          or (d.status = 'sending' and d.reservation_v3 and d.attempted_at < private.rc_notif_now() - interval '10 minutes'))
     and not exists (select 1 from public.resident_assessment_email_attempts a
                     where a.delivery_id = d.id and a.status = 'authorized')
   order by r.submitted_at, r.id
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

-- The web reminder for one request (used by the Edge worker; the SQL cron job inserts directly).
-- Independent of claim and SMTP. Goes through the same trigger decision; existing rows are kept untouched.
create or replace function public.rc_notif_ensure_web_reminder(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.resident_assessment_requests%rowtype; v_template text; v_resident text; v_n integer;
begin
  select * into v_req from public.resident_assessment_requests where id = p_request_id;
  if not found or v_req.status <> 'pending' or v_req.submitted_at > private.rc_notif_now() - interval '24 hours' then
    return jsonb_build_object('created', false, 'reason', 'not_due');
  end if;
  select template_code into v_template from public.resident_template_definitions where id = v_req.template_id;
  select full_name into v_resident from public.resident_profiles where user_id = v_req.resident_id;
  insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message)
  values (v_req.staff_id, v_req.id, 'assessment_reminder', 'แบบประเมินรอเกิน 24 ชั่วโมง', v_template || ' ของ ' || v_resident || ' ยังรอการประเมิน')
  on conflict (request_id, recipient_id, notification_type) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('created', v_n = 1);
end;
$$;

-- ------------------------------------------------------------------ own preferences (browser)
create or replace function public.rc_notif_get_my_preferences()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v public.resident_notification_preferences%rowtype;
begin
  if not (select private.resident_account_active()) then raise exception 'RC_NOTIF_FORBIDDEN: active account required'; end if;
  select * into v from public.resident_notification_preferences where user_id = v_uid;
  return jsonb_build_object('user_id', v_uid, 'version', coalesce(v.version, 0),
    'request_web', coalesce(v.request_web, true), 'request_email', coalesce(v.request_email, true),
    'reminder_web', coalesce(v.reminder_web, true), 'reminder_email', coalesce(v.reminder_email, true),
    'completed_web', coalesce(v.completed_web, true), 'updated_at', v.updated_at);
end;
$$;

-- p_preferences: object with any of request_web, request_email, reminder_web, reminder_email, completed_web (booleans).
-- p_expected_version: the version the page showed (0 = never saved). Same values = no-op (no version, no history).
create or replace function public.rc_notif_save_my_preferences(p_expected_version integer, p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_old public.resident_notification_preferences%rowtype; v_cur integer;
  v_new jsonb; v_old_j jsonb; k text; v_now timestamptz; v_ver integer; v_changed text[] := '{}'; v_kind text; v_channel text;
begin
  if not (select private.resident_account_active()) then raise exception 'RC_NOTIF_FORBIDDEN: active account required'; end if;
  if p_expected_version is null or p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
    raise exception 'RC_NOTIF_INVALID_INPUT: expected_version and a preferences object are required';
  end if;
  for k in select jsonb_object_keys(p_preferences) loop
    if k not in ('request_web', 'request_email', 'reminder_web', 'reminder_email', 'completed_web') then
      raise exception 'RC_NOTIF_INVALID_INPUT: % is not a setting', k; end if;
    if jsonb_typeof(p_preferences->k) <> 'boolean' then raise exception 'RC_NOTIF_INVALID_INPUT: % must be true or false', k; end if;
  end loop;
  perform private.rc_notif_lock(v_uid);
  select * into v_old from public.resident_notification_preferences where user_id = v_uid for update;
  v_cur := coalesce(v_old.version, 0);
  if p_expected_version <> v_cur then
    raise exception 'RC_NOTIF_VERSION_CONFLICT: settings changed elsewhere (now version %); reload', v_cur;
  end if;
  v_old_j := jsonb_build_object('request_web', coalesce(v_old.request_web, true), 'request_email', coalesce(v_old.request_email, true),
    'reminder_web', coalesce(v_old.reminder_web, true), 'reminder_email', coalesce(v_old.reminder_email, true),
    'completed_web', coalesce(v_old.completed_web, true));
  v_new := v_old_j || p_preferences;
  for k in select jsonb_object_keys(v_new) loop
    if v_new->k is distinct from v_old_j->k then v_changed := array_append(v_changed, k); end if;
  end loop;
  if cardinality(v_changed) = 0 then
    return public.rc_notif_get_my_preferences() || jsonb_build_object('changed', false);
  end if;
  v_now := private.rc_notif_now(); v_ver := v_cur + 1;
  insert into public.resident_notification_preferences as p (user_id, request_web, request_email, reminder_web, reminder_email, completed_web, version, updated_at)
  values (v_uid, (v_new->>'request_web')::boolean, (v_new->>'request_email')::boolean, (v_new->>'reminder_web')::boolean,
          (v_new->>'reminder_email')::boolean, (v_new->>'completed_web')::boolean, v_ver, v_now)
  on conflict (user_id) do update set request_web = excluded.request_web, request_email = excluded.request_email,
    reminder_web = excluded.reminder_web, reminder_email = excluded.reminder_email, completed_web = excluded.completed_web,
    version = excluded.version, updated_at = excluded.updated_at;
  foreach k in array v_changed loop
    v_kind := split_part(k, '_', 1); v_channel := split_part(k, '_', 2);
    if (v_new->>k)::boolean then
      update public.resident_notification_off_periods set on_at = v_now, on_version = v_ver
       where user_id = v_uid and kind = v_kind and channel = v_channel and on_at is null;
    else
      insert into public.resident_notification_off_periods (user_id, kind, channel, off_at, off_version)
      values (v_uid, v_kind, v_channel, v_now, v_ver);
    end if;
  end loop;
  return public.rc_notif_get_my_preferences() || jsonb_build_object('changed', true, 'changed_keys', to_jsonb(v_changed));
end;
$$;

-- ------------------------------------------------------------------ privileges
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname like 'rc\_notif\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;
revoke all on function public.rc_notif_get_my_preferences() from public, anon, service_role;
revoke all on function public.rc_notif_save_my_preferences(integer, jsonb) from public, anon, service_role;
grant execute on function public.rc_notif_get_my_preferences() to authenticated;
grant execute on function public.rc_notif_save_my_preferences(integer, jsonb) to authenticated;
revoke all on function public.rc_notif_authorize_email_attempt(uuid) from public, anon, authenticated;
revoke all on function public.rc_notif_finish_email_attempt(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.rc_notif_due_email_work(integer, interval) from public, anon, authenticated;
revoke all on function public.rc_notif_ensure_web_reminder(uuid) from public, anon, authenticated;
revoke all on function public.rc_notif_reserve_email(uuid, text) from public, anon, authenticated;
revoke all on function public.rc_notif_worker_checkin(text) from public, anon, authenticated;
revoke all on function public.rc_notif_retry_pending_web(integer) from public, anon, authenticated;
grant execute on function public.rc_notif_authorize_email_attempt(uuid) to service_role;
grant execute on function public.rc_notif_finish_email_attempt(uuid, text, text, text) to service_role;
grant execute on function public.rc_notif_due_email_work(integer, interval) to service_role;
grant execute on function public.rc_notif_ensure_web_reminder(uuid) to service_role;
grant execute on function public.rc_notif_reserve_email(uuid, text) to service_role;
grant execute on function public.rc_notif_worker_checkin(text) to service_role;
grant execute on function public.rc_notif_retry_pending_web(integer) to service_role;

notify pgrst, 'reload schema';
