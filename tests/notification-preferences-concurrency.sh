#!/usr/bin/env bash
# RC-NOTIF-V1 — two-session race tests (save vs SMTP authorization, cron vs Edge web reminder, two e-mail workers).
# Throwaway local database with all migrations; refuses Resident data. Synthetic FIXTURE ids. Real database clock.
# PGHOST=/tmp PGUSER=postgres PGDATABASE=<throwaway> bash tests/notification-preferences-concurrency.sh
# Every psql exit status is checked (same rules as the RC-04 v3 runner): lookups/setup abort on failure, each race
# session's status comes back through wait, a session must succeed (exit 0, no ERROR) unless the scenario says otherwise.
set -u
set -o pipefail
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail=0; pass() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }
fatal() { echo "FAIL $1" >&2; echo "SOME NOTIFICATION CONCURRENCY TESTS FAILED (aborted)" >&2; exit 1; }
q() { local out rc; out=$("${PSQL[@]}" -c "$1" 2>"$TMP/q.err"); rc=$?
  [ $rc -eq 0 ] || fatal "query failed (psql exit $rc): $(head -c 300 "$TMP/q.err") :: ${1:0:120}"
  [ -n "$out" ] || fatal "query returned nothing :: ${1:0:120}"; printf '%s\n' "$out"; }
run_ok() { local out rc; out=$("${PSQL[@]}" -c "$1" 2>&1); rc=$?
  { [ $rc -eq 0 ] && ! grep -q 'ERROR:' <<<"$out"; } || fatal "statement failed (psql exit $rc): $(grep -m1 ERROR <<<"$out") :: ${1:0:120}"; printf '%s\n' "$out"; }
race() { # label sqlA sqlB — A holds its transaction 1.5 s after its statements; B starts 0.4 s later
  local d="$TMP/$1"; mkdir -p "$d"
  ( "${PSQL[@]}" -c "$2 select pg_sleep(1.5); commit;" > "$d/a.out" 2>&1 ) & local pa=$!
  sleep 0.4; local t0; t0=$(date +%s.%N)
  ( "${PSQL[@]}" -c "$3 commit;" > "$d/b.out" 2>&1 ) & local pb=$!
  wait $pb; SB=$?; local t1; t1=$(date +%s.%N); wait $pa; SA=$?
  OA=$(cat "$d/a.out"); OB=$(cat "$d/b.out"); DIR=$d
  BWAIT=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.2f", b - a }')
}
expect_ok() { if [ "$2" -eq 0 ] && ! grep -q 'ERROR:' <<<"$3"; then pass "$1 (exit 0)"; else bad "$1: expected success, psql exit $2: $(grep -m1 ERROR <<<"$3")"; fi; }
waited() { [ "$(awk -v w="$BWAIT" 'BEGIN { print (w >= 0.9) ? 1 : 0 }')" = "1" ]; }
nodeadlock() { grep -qi "deadlock detected" "$DIR/a.out" "$DIR/b.out" && bad "$1: deadlock" || pass "$1: no deadlock"; }

[ "$(q "select count(*) from public.resident_profiles")" = "0" ] || { echo "Refusing to run: database has Resident data"; exit 2; }
B1=10000000-0000-4000-8000-0000000000b1; C1=10000000-0000-4000-8000-0000000000c1
"${PSQL[@]}" > "$TMP/setup.out" 2>&1 <<SQL || fatal "setup failed: $(grep -m1 ERROR "$TMP/setup.out")"
update public.resident_maintenance_pause set paused = false where scope = 'accounts';
update public.resident_notification_mail_control set paused = false;   -- the migration starts with e-mail paused
insert into auth.users(id, email) values ('$B1','b1@fixture.test'),('$C1','c1@fixture.test');
insert into public.resident_profiles(user_id, full_name, email, pgy, active) values ('$B1','Fixture b1','b1@fixture.test',null,true),('$C1','Fixture c1','c1@fixture.test',2,true);
insert into public.resident_user_roles(user_id, role, active) values ('$B1','staff',true),('$C1','resident',true);
insert into public.resident_staff_directory(email, full_name, unit_name, active, auth_user_id) values ('b1@fixture.test','Fixture b1','Unit',true,'$B1');
SQL
as() { echo "begin; set local role authenticated; select set_config('request.jwt.claim.sub', '$1', true);"; }
# a pending request whose reminder becomes due now (event = this moment, after any earlier off/on cycle)
newreq() { local code=$1 id
  id=$(run_ok "$(as $C1) select public.submit_resident_assessment_request((select id from public.resident_template_definitions where template_code = '$code'), '$B1', current_date, 'ctx', 'activity', null, null, '[]'::jsonb); commit;" | grep -E '^[0-9a-f-]{36}$' | tail -1)
  [ -n "$id" ] || fatal "could not create request $code"
  run_ok "update public.resident_assessment_requests set submitted_at = now() - interval '24 hours' where id = '$id'" >/dev/null
  echo "$id"; }
saveprefs() { echo "$(as $B1) select public.rc_notif_save_my_preferences((select (public.rc_notif_get_my_preferences()->>'version')::int), '$1'::jsonb);"; }
worker_sql() { # claim + authorize one reminder delivery (service role), print the authorization
  echo "begin; set local role service_role; select public.rc_notif_authorize_email_attempt((public.rc_notif_reserve_email('$1', 'reminder')->>'delivery_id')::uuid);"; }

# R1 authorization takes the user lock first, then "turn reminder e-mail off" is saved: the attempt was allowed
R=$(newreq EPA-1) || exit 1
race R1 "$(worker_sql $R)" "$(saveprefs '{"reminder_email": false}')"
expect_ok "R1-A worker authorizes" "$SA" "$OA"; expect_ok "R1-B save waits, then succeeds" "$SB" "$OB"
grep -q '"allowed": true' <<<"$OA" && pass "R1a permission given before the setting changed" || bad "R1a: $OA"
waited && pass "R1b the save really waited for the authorization lock (${BWAIT}s)" || bad "R1b no wait (${BWAIT}s)"
[ "$(q "select (select max(authorized_at) from public.resident_assessment_email_attempts a join public.resident_assessment_email_deliveries d on d.id = a.delivery_id where d.request_id = '$R') < (select off_at from public.resident_notification_off_periods where user_id = '$B1' and kind = 'reminder' and channel = 'email' and on_at is null)")" = "t" ] && pass "R1c serial order: authorized_at < off_at" || bad "R1c"
nodeadlock R1
run_ok "$(saveprefs '{"reminder_email": true}') commit;" >/dev/null

# R2 the save holds the lock first; the worker comes second and must not get permission
R=$(newreq EPA-2) || exit 1
race R2 "$(saveprefs '{"reminder_email": false}')" "$(worker_sql $R)"
expect_ok "R2-A save" "$SA" "$OA"; expect_ok "R2-B worker (no permission is not an error)" "$SB" "$OB"
waited && pass "R2a the worker really waited for the save lock (${BWAIT}s)" || bad "R2a no wait (${BWAIT}s)"
[ "$(q "select count(*) from public.resident_assessment_email_attempts a join public.resident_assessment_email_deliveries d on d.id = a.delivery_id where d.request_id = '$R'")" = "0" ] && [ "$(q "select status from public.resident_assessment_email_deliveries where request_id = '$R' and delivery_type = 'reminder'")" = "suppressed" ] && pass "R2b serial order: no attempt, terminal suppressed" || bad "R2b"
nodeadlock R2
run_ok "$(saveprefs '{"reminder_email": true}') commit;" >/dev/null

# R3 SQL cron web reminder and Edge ensure_web_reminder at the same moment → one row
R=$(newreq EPA-3) || exit 1
CRON="begin; insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message) select request.staff_id, request.id, 'assessment_reminder', 'แบบประเมินรอเกิน 24 ชั่วโมง', 'cron' from public.resident_assessment_requests request where request.id = '$R' and request.status = 'pending' and request.submitted_at <= now() - interval '24 hours' on conflict (request_id, recipient_id, notification_type) do nothing;"
race R3 "$CRON" "begin; set local role service_role; select public.rc_notif_ensure_web_reminder('$R');"
expect_ok "R3-A cron insert" "$SA" "$OA"; expect_ok "R3-B Edge ensure" "$SB" "$OB"
[ "$(q "select count(*) from public.resident_notifications where request_id = '$R' and notification_type = 'assessment_reminder'")" = "1" ] && pass "R3a one web reminder for the event" || bad "R3a"
grep -q '"created": false' <<<"$OB" && pass "R3b the second creator saw the existing row" || bad "R3b: $OB"
nodeadlock R3

# R4 two e-mail workers (e.g. old cron run + new run) for the same reminder → at most one authorized attempt
R=$(newreq EPA-4) || exit 1
race R4 "$(worker_sql $R)" "$(worker_sql $R)"
expect_ok "R4-A worker 1" "$SA" "$OA"; expect_ok "R4-B worker 2" "$SB" "$OB"
[ "$(q "select count(*) from public.resident_assessment_email_attempts a join public.resident_assessment_email_deliveries d on d.id = a.delivery_id where d.request_id = '$R'")" = "1" ] && pass "R4a exactly one authorized attempt" || bad "R4a"
nodeadlock R4

# R5/R6: request row serializes cancellation and web retry.
queue_requested() {
  run_ok "begin;
  delete from public.resident_notifications where request_id = '$1' and notification_type = 'assessment_requested';
  insert into public.resident_notification_pending_web (request_id,recipient_id,notification_type,title,message,first_failed_at)
  values ('$1','$B1','assessment_requested','Fixture','Fixture',clock_timestamp()); commit;" >/dev/null
}
cancel_sql() { echo "$(as $C1) select public.cancel_resident_assessment_request('$1');"; }
retry_sql="begin; set local role service_role; select public.rc_notif_retry_pending_web();"
webcount() { q "select count(*) from public.resident_notifications where request_id='$1' and notification_type='assessment_requested'"; }
pendingcount() { q "select count(*) from public.resident_notification_pending_web where request_id='$1' and notification_type='assessment_requested'"; }
R=$(newreq EPA-5) || exit 1
queue_requested "$R"
race R5 "$(cancel_sql "$R")" "$retry_sql"
expect_ok "R5-A cancel owns request" "$SA" "$OA"; expect_ok "R5-B retry defers locked request" "$SB" "$OB"
[ "$(webcount "$R")" = 0 ] && [ "$(pendingcount "$R")" = 1 ] && pass "R5a no stale notification while cancel owns the request" || bad "R5a"
run_ok "$retry_sql commit;" >/dev/null
[ "$(webcount "$R")" = 0 ] && [ "$(pendingcount "$R")" = 0 ] && pass "R5b cleanup after cancel commits without replay" || bad "R5b"
nodeadlock R5

R=$(newreq EPA-6) || exit 1
queue_requested "$R"
race R6 "$retry_sql" "$(cancel_sql "$R")"
expect_ok "R6-A retry owns request" "$SA" "$OA"; expect_ok "R6-B cancel waits, then removes notification" "$SB" "$OB"
grep -Eq '"created": 1' <<<"$OA" && waited && [ "$(webcount "$R")" = 0 ] && [ "$(pendingcount "$R")" = 0 ] && pass "R6a retry wins; cancel waits (${BWAIT}s) and cleans up" || bad "R6a: $OA"
nodeadlock R6

# R7–R10: the same control row fences both reserve and authorize in both orders.
pause_sql="begin; select id from public.resident_notification_mail_control where id for update; update public.resident_notification_mail_control set paused=true where id;"
resume_test_only() { run_ok 'update public.resident_notification_mail_control set paused=false where id' >/dev/null; }
reserve_sql() { echo "begin; set local role service_role; select public.rc_notif_reserve_email('$1','reminder');"; }
authorize_sql() { echo "begin; set local role service_role; select public.rc_notif_authorize_email_attempt('$1');"; }
R=$(newreq EPA-8) || exit 1
race R7 "$pause_sql" "$(reserve_sql "$R")"
expect_ok "R7-A pause wins" "$SA" "$OA"; expect_ok "R7-B reserve waits" "$SB" "$OB"
grep -q '"reason": "paused"' <<<"$OB" && waited && [ "$(q "select count(*) from public.resident_assessment_email_deliveries where request_id='$R'")" = 0 ] && pass "R7a paused reserve adds no row" || bad "R7a: $OB"
nodeadlock R7
resume_test_only

race R8 "$(reserve_sql "$R")" "$pause_sql"
expect_ok "R8-A reserve wins" "$SA" "$OA"; expect_ok "R8-B pause waits" "$SB" "$OB"
grep -q '"reason": "reserved"' <<<"$OA" && waited && [ "$(q "select count(*) from public.resident_assessment_email_deliveries where request_id='$R' and status='sending'")" = 1 ] && pass "R8a pre-pause reservation is visible to drain" || bad "R8a"
nodeadlock R8
D=$(q "select id from public.resident_assessment_email_deliveries where request_id='$R'")
resume_test_only

race R9 "$pause_sql" "$(authorize_sql "$D")"
expect_ok "R9-A pause wins" "$SA" "$OA"; expect_ok "R9-B authorize waits" "$SB" "$OB"
grep -q '"reason": "paused"' <<<"$OB" && waited && [ "$(q "select count(*) from public.resident_assessment_email_attempts where delivery_id='$D'")" = 0 ] && pass "R9a paused authorization adds no attempt" || bad "R9a: $OB"
nodeadlock R9
resume_test_only

race R10 "$(authorize_sql "$D")" "$pause_sql"
expect_ok "R10-A authorize wins" "$SA" "$OA"; expect_ok "R10-B pause waits" "$SB" "$OB"
grep -q '"allowed": true' <<<"$OA" && waited && [ "$(q "select count(*) from public.resident_assessment_email_attempts where delivery_id='$D' and status='authorized'")" = 1 ] && pass "R10a pre-pause authorization is visible to drain" || bad "R10a"
nodeadlock R10

if [ $fail = 0 ]; then echo "ALL NOTIFICATION CONCURRENCY TESTS PASSED"; exit 0; else echo "SOME NOTIFICATION CONCURRENCY TESTS FAILED"; exit 1; fi
