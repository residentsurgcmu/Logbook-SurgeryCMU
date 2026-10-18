#!/usr/bin/env bash
# Concurrency tests for RC-02a-1 accounts piece 1 (migration 20261018090000): two database sessions at once.
# Covers spec v4 §6 item 3 and required tests §8 items 1, 2, 4, 8.
# Run ONLY against a throwaway local database that has all migrations applied and no Resident data:
#   PGHOST=/tmp PGUSER=postgres PGDATABASE=<throwaway> bash tests/resident-accounts-concurrency.sh
# It creates test accounts, runs each case, checks the invariants, and deletes what it created.
set -u
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
fail=0
pass() { echo "PASS $1"; }
bad() { echo "FAIL $1"; fail=1; }

if [ "$("${PSQL[@]}" -c "select count(*) from public.resident_profiles")" != "0" ]; then
  echo "Refusing to run: this database already has Resident data (use an empty throwaway database)"; exit 2
fi

# The migration leaves account writes paused (release safety); this throwaway database needs them open.
"${PSQL[@]}" -c "update public.resident_maintenance_pause set paused = false where scope = 'accounts'" >/dev/null

# ---------- fixed test accounts
ADM=00000000-0000-0000-0000-00000000ad01
ADM2=00000000-0000-0000-0000-00000000ad02
S1=00000000-0000-0000-0000-0000000005a1
S2=00000000-0000-0000-0000-0000000005a2
R1=00000000-0000-0000-0000-0000000004e1
R2=00000000-0000-0000-0000-0000000004e2
cleanup() {
  psql -X -q -At -v ON_ERROR_STOP=1 >/dev/null <<SQL
delete from public.resident_notifications where recipient_id in (select user_id from public.resident_profiles where email like '%@conc.test');
delete from public.resident_self_assessment_scores where request_id in (select id from public.resident_assessment_requests where resident_id in (select user_id from public.resident_profiles where email like '%@conc.test'));
delete from public.resident_assessment_email_deliveries where request_id in (select id from public.resident_assessment_requests where resident_id in (select user_id from public.resident_profiles where email like '%@conc.test'));
delete from public.resident_assessment_requests where resident_id in (select user_id from public.resident_profiles where email like '%@conc.test');
delete from public.resident_assessment_scores where assessment_id in (select id from public.resident_assessments where resident_id in (select user_id from public.resident_profiles where email like '%@conc.test'));
delete from public.resident_assessments where resident_id in (select user_id from public.resident_profiles where email like '%@conc.test');
delete from public.resident_evaluator_assignments where resident_id in (select user_id from public.resident_profiles where email like '%@conc.test');
delete from public.resident_account_events where actor_id in ('$ADM', '$ADM2');
delete from public.resident_staff_directory where email like '%@conc.test';
delete from public.resident_user_roles where user_id in (select id from auth.users where email like '%@conc.test');
delete from public.resident_profiles where email like '%@conc.test';
delete from auth.users where email like '%@conc.test';
SQL
}
seed() {
  cleanup
  "${PSQL[@]}" >/dev/null <<SQL
insert into auth.users(id, email) values ('$ADM','adm@conc.test'),('$ADM2','adm2@conc.test'),('$S1','s1@conc.test'),('$S2','s2@conc.test'),('$R1','r1@conc.test'),('$R2','r2@conc.test');
insert into public.resident_profiles(user_id, full_name, email, pgy, active) select id, 'Test ' || split_part(email, '@', 1), email,
  case when email like 'r%' then 2 end, true from auth.users where email like '%@conc.test';
insert into public.resident_user_roles(user_id, role, active) select id,
  case when email like 'r%' then 'resident'::public.resident_system_role when email like 's%' then 'staff' else 'admin' end, true
  from auth.users where email like '%@conc.test';
insert into public.resident_staff_directory(email, full_name, unit_name, active, auth_user_id)
  select email, 'Test ' || split_part(email, '@', 1), 'Unit', true, id from auth.users where email like 's%@conc.test';
SQL
}
TPL1=$("${PSQL[@]}" -c "select id from public.resident_template_definitions where template_code = 'EPA-4'")
TPL2=$("${PSQL[@]}" -c "select id from public.resident_template_definitions where template_code = 'EPA-5'")

# SQL to act as a user inside a transaction
as_user() { echo "begin; set local role authenticated; select set_config('request.jwt.claim.sub', '$1', true);"; }
# submit a request (EPA forms without self-assessment are not guaranteed, so build the self part generically)
submit_sql() { # resident staff template
  cat <<SQL
select public.submit_resident_assessment_request('$3', '$2', current_date, 'ctx', 'activity',
  (select case when requires_self_assessment then outcome_options->>0 end from public.resident_template_definitions where id = '$3'),
  (select case when requires_self_assessment then 'self' end from public.resident_template_definitions where id = '$3'),
  (select case when d.requires_self_assessment then coalesce(jsonb_agg(jsonb_build_object('criterionId', c.id, 'score', d.score_options->>1, 'comment', '') order by c.sort_order), '[]'::jsonb) else '[]'::jsonb end
     from public.resident_template_definitions d left join public.resident_template_criteria c on c.template_id = d.id and c.active
     where d.id = '$3' group by d.requires_self_assessment, d.score_options));
SQL
}
complete_sql() { # request
  cat <<SQL
select public.complete_resident_assessment_request('$1',
  (select d.outcome_options->>0 from public.resident_template_definitions d join public.resident_assessment_requests r on r.template_id = d.id where r.id = '$1'),
  '', (select coalesce(jsonb_agg(jsonb_build_object('criterionId', c.id, 'score', d.score_options->>0, 'comment', '') order by c.sort_order), '[]'::jsonb)
       from public.resident_assessment_requests r join public.resident_template_definitions d on d.id = r.template_id
       join public.resident_template_criteria c on c.template_id = d.id and c.active where r.id = '$1'));
SQL
}
preview_counts() { # target -> jsonb
  "${PSQL[@]}" -c "$(as_user $ADM) select public.admin_preview_account_action('$1', 'deactivate')->'preview_counts'; commit;" | tail -1
}
updated_at() { "${PSQL[@]}" -c "select updated_at from public.resident_profiles where user_id = '$1'"; }
deactivate_sql() { # actor target counts
  echo "select public.admin_set_account_active('$2', false, '$(updated_at $2)', gen_random_uuid(), 'concurrency test', '$3'::jsonb);"
}
pending_req() { "${PSQL[@]}" -c "select id from public.resident_assessment_requests where resident_id = '$1' and status = 'pending' order by submitted_at desc limit 1"; }
# run two sessions: first holds its transaction for $HOLD seconds after its call; second starts 0.4 s later
HOLD=1.5
race() { # sqlA sqlB -> sets OUT_A OUT_B
  ( "${PSQL[@]}" -c "$1 select pg_sleep($HOLD); commit;" > /tmp/acc_a.out 2>&1 ) &
  local pa=$!
  sleep 0.4
  ( "${PSQL[@]}" -c "$2 commit;" > /tmp/acc_b.out 2>&1 ) &
  local pb=$!
  wait $pa; wait $pb
  OUT_A=$(cat /tmp/acc_a.out); OUT_B=$(cat /tmp/acc_b.out)
}
invariant() { # label
  local n
  n=$("${PSQL[@]}" -c "select count(*) from public.resident_assessment_requests q
        join public.resident_user_roles rr on rr.user_id = q.resident_id join public.resident_profiles rp on rp.user_id = q.resident_id
        join public.resident_user_roles sr on sr.user_id = q.staff_id join public.resident_profiles sp on sp.user_id = q.staff_id
        where q.status = 'pending' and not (rr.active and rp.active and sr.active and sp.active)")
  [ "$n" = "0" ] && pass "$1: no pending request to/from an inactive account" || bad "$1: $n pending request(s) left for an inactive account"
  if grep -qi deadlock /tmp/acc_a.out /tmp/acc_b.out; then bad "$1: deadlock"; else pass "$1: no deadlock"; fi
}

# ---------- 1a. deactivation of the submitting Resident runs first; the submission waits and is refused
seed
C=$(preview_counts $R1)
race "$(as_user $ADM) $(deactivate_sql $ADM $R1 "$C")" "$(as_user $R1) $(submit_sql $R1 $S1 $TPL1)"
echo "$OUT_B" | grep -q "Active Resident role required" && pass "1a submission after the Resident's deactivation is refused" || bad "1a expected refusal, got: $OUT_B"
invariant "1a"

# ---------- 1b. the submission runs first; the deactivation (preview taken before) sees the change
seed
C=$(preview_counts $R1)
race "$(as_user $R1) $(submit_sql $R1 $S1 $TPL1)" "$(as_user $ADM) $(deactivate_sql $ADM $R1 "$C")"
echo "$OUT_B" | grep -q "PREVIEW_CHANGED" && pass "1b deactivation sees the new request => PREVIEW_CHANGED, nothing written" || bad "1b expected PREVIEW_CHANGED, got: $OUT_B"
C=$(preview_counts $R1)
"${PSQL[@]}" -c "$(as_user $ADM) $(deactivate_sql $ADM $R1 "$C") commit;" >/dev/null 2>&1 && pass "1b after a fresh preview the deactivation succeeds" || bad "1b deactivation after re-preview failed"
[ "$("${PSQL[@]}" -c "select count(*) from public.resident_assessment_requests where resident_id = '$R1' and status = 'cancelled'")" = "1" ] && pass "1b the request that finished first was counted and cancelled" || bad "1b request not cancelled"
invariant "1b"

# ---------- 1c. deactivation of the target Staff runs first; the submission to that Staff is refused
seed
C=$(preview_counts $S1)
race "$(as_user $ADM) $(deactivate_sql $ADM $S1 "$C")" "$(as_user $R1) $(submit_sql $R1 $S1 $TPL1)"
echo "$OUT_B" | grep -q "must match an active registered Staff" && pass "1c submission to a Staff being deactivated is refused" || bad "1c expected refusal, got: $OUT_B"
invariant "1c"

# ---------- 1d. the submission to Staff runs first; Staff deactivation sees it
seed
C=$(preview_counts $S1)
race "$(as_user $R1) $(submit_sql $R1 $S1 $TPL1)" "$(as_user $ADM) $(deactivate_sql $ADM $S1 "$C")"
echo "$OUT_B" | grep -q "PREVIEW_CHANGED" && pass "1d Staff deactivation sees the new request => PREVIEW_CHANGED" || bad "1d expected PREVIEW_CHANGED, got: $OUT_B"
invariant "1d"

# ---------- 2a. evaluation runs first; deactivation of the Resident waits, then sees the change; evaluation is kept
seed
"${PSQL[@]}" -c "$(as_user $R1) $(submit_sql $R1 $S1 $TPL1) commit;" >/dev/null
REQ=$(pending_req $R1)
C=$(preview_counts $R1)
race "$(as_user $S1) $(complete_sql $REQ)" "$(as_user $ADM) $(deactivate_sql $ADM $R1 "$C")"
echo "$OUT_B" | grep -q "PREVIEW_CHANGED" && pass "2a deactivation after an evaluation in flight => PREVIEW_CHANGED" || bad "2a expected PREVIEW_CHANGED, got: $OUT_B"
[ "$("${PSQL[@]}" -c "select status from public.resident_assessment_requests where id = '$REQ'")" = "completed" ] && pass "2a the completed evaluation is never cancelled" || bad "2a evaluation was lost"
invariant "2a"

# ---------- 2b. deactivation of the Resident runs first; the evaluation waits and is refused
seed
"${PSQL[@]}" -c "$(as_user $R1) $(submit_sql $R1 $S1 $TPL1) commit;" >/dev/null
REQ=$(pending_req $R1)
C=$(preview_counts $R1)
race "$(as_user $ADM) $(deactivate_sql $ADM $R1 "$C")" "$(as_user $S1) $(complete_sql $REQ)"
echo "$OUT_B" | grep -q "no longer pending" && pass "2b evaluation after the Resident's deactivation is refused (request cancelled)" || bad "2b expected refusal, got: $OUT_B"
[ "$("${PSQL[@]}" -c "select count(*) from public.resident_assessments where resident_id = '$R1'")" = "0" ] && pass "2b no assessment was written" || bad "2b assessment written"
invariant "2b"

# ---------- 2c. deactivation of the evaluating Staff runs first; the evaluation is refused
seed
"${PSQL[@]}" -c "$(as_user $R1) $(submit_sql $R1 $S1 $TPL1) commit;" >/dev/null
REQ=$(pending_req $R1)
C=$(preview_counts $S1)
race "$(as_user $ADM) $(deactivate_sql $ADM $S1 "$C")" "$(as_user $S1) $(complete_sql $REQ)"
echo "$OUT_B" | grep -qE "Only the selected active Staff|no longer pending" && pass "2c evaluation by a Staff being deactivated is refused" || bad "2c expected refusal, got: $OUT_B"
invariant "2c"

# ---------- 2d. the Resident cancels while being deactivated (both orders)
seed
"${PSQL[@]}" -c "$(as_user $R1) $(submit_sql $R1 $S1 $TPL1) commit;" >/dev/null
REQ=$(pending_req $R1)
C=$(preview_counts $R1)
race "$(as_user $ADM) $(deactivate_sql $ADM $R1 "$C")" "$(as_user $R1) select public.cancel_resident_assessment_request('$REQ');"
echo "$OUT_B" | grep -qE "Only the Resident who sent this request|Only a pending request" && pass "2d cancel after deactivation is refused (already cancelled by deactivation)" || bad "2d got: $OUT_B"
invariant "2d"
seed
"${PSQL[@]}" -c "$(as_user $R1) $(submit_sql $R1 $S1 $TPL1) commit;" >/dev/null
REQ=$(pending_req $R1)
C=$(preview_counts $R1)
race "$(as_user $R1) select public.cancel_resident_assessment_request('$REQ');" "$(as_user $ADM) $(deactivate_sql $ADM $R1 "$C")"
echo "$OUT_B" | grep -q "PREVIEW_CHANGED" && pass "2e cancel first, then deactivation sees the change => PREVIEW_CHANGED" || bad "2e got: $OUT_B"
invariant "2e"

# ---------- 4. two Admins deactivate each other at the same moment
seed
CA=$(preview_counts $ADM2); CB=$(preview_counts $ADM)
race "$(as_user $ADM) $(deactivate_sql $ADM $ADM2 "$CA")" "$(as_user $ADM2) $(deactivate_sql $ADM2 $ADM "$CB")"
echo "$OUT_B" | grep -q "Active Admin account required" && pass "4 the second Admin, already deactivated, is refused" || bad "4 got: $OUT_B"
[ "$("${PSQL[@]}" -c "select count(*) from public.resident_user_roles r join public.resident_profiles p using (user_id) where r.role = 'admin' and r.active and p.active and p.email like '%@conc.test'")" -ge 1 ] && pass "4 at least one active Admin remains" || bad "4 no active Admin left"
invariant "4"

# ---------- 8. duplicate add at the same time (provision + provision, provision + invite): no overwrite
seed
NEW1=00000000-0000-0000-0000-0000000000e1
NEW2=00000000-0000-0000-0000-0000000000e2
"${PSQL[@]}" -c "insert into auth.users(id, email) values ('$NEW1', 'dup@conc.test'), ('$NEW2', 'dup2@conc.test')" >/dev/null
race "begin; set local role service_role; select public.admin_provision_account_internal('$ADM', '$NEW1', 'dup@conc.test', 'Test dup', 'resident', 1::smallint, null);" \
     "begin; set local role service_role; select public.admin_provision_account_internal('$ADM', '$NEW2', 'dup@conc.test', 'Test dup other', 'admin', null, null);"
echo "$OUT_B" | grep -q "ACCOUNT_EXISTS" && pass "8a second add of the same email at the same time => ACCOUNT_EXISTS" || bad "8a got: $OUT_B"
[ "$("${PSQL[@]}" -c "select r.role || '/' || p.full_name from public.resident_profiles p join public.resident_user_roles r using (user_id) where p.email = 'dup@conc.test'")" = "resident/Test dup" ] && pass "8a the first account is unchanged" || bad "8a first account was overwritten"
NEW3=00000000-0000-0000-0000-0000000000e3
"${PSQL[@]}" -c "insert into auth.users(id, email) values ('$NEW3', 'dupstaff@conc.test')" >/dev/null
race "begin; set local role service_role; select public.admin_provision_account_internal('$ADM', '$NEW3', 'dupstaff@conc.test', 'Test dup staff', 'staff', null, 'Unit A');" \
     "begin; set local role service_role; select public.admin_provision_account_internal('$ADM', '$NEW3', 'dupstaff@conc.test', 'Test dup staff', 'staff', null, 'Unit A');"
echo "$OUT_B" | grep -q "ACCOUNT_EXISTS" && pass "8b provision and invite of the same Staff at the same time => one wins, the other ACCOUNT_EXISTS" || bad "8b got: $OUT_B"
[ "$("${PSQL[@]}" -c "select count(*) from public.resident_staff_directory where email = 'dupstaff@conc.test'")" = "1" ] && pass "8b one Staff list entry" || bad "8b duplicate Staff list entry"

# ---------- P. pausing account writes waits for a write already running, then refuses new ones (G0 B-R02)
seed
UPD="select public.admin_update_account('$R1', '$(updated_at $R1)', gen_random_uuid(), '{\"full_name\":\"Test r1 in flight\"}'::jsonb);"
PAUSE_ON="$(sed -n '/^update public.resident_maintenance_pause/,/^commit;/p' "$(dirname "$0")/../supabase/manual/rc02a1_pause_on.sql")"
( "${PSQL[@]}" -c "$(as_user $ADM) $UPD select pg_sleep(2); commit;" > /tmp/acc_a.out 2>&1 ) &
pa=$!
sleep 0.5
t0=$(date +%s.%N)
"${PSQL[@]}" > /tmp/acc_b.out 2>&1 <<SQL
$PAUSE_ON
SQL
t1=$(date +%s.%N)
wait $pa
waited=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.2f", b - a }')
[ "$(awk -v w="$waited" 'BEGIN { print (w > 1.0) ? 1 : 0 }')" = "1" ] && pass "P1 pause_on waited for the running account write (${waited}s)" || bad "P1 pause_on did not wait (${waited}s): $(cat /tmp/acc_b.out)"
[ "$("${PSQL[@]}" -c "select full_name from public.resident_profiles where user_id = '$R1'")" = "Test r1 in flight" ] && pass "P2 the write that was already running finished normally" || bad "P2 running write lost: $(cat /tmp/acc_a.out)"
OUT=$("${PSQL[@]}" -c "begin; set local role service_role; insert into public.resident_profiles (user_id, full_name, email, pgy, active) values ('$R2', 'Old Edge overwrite', 'r2@conc.test', 4, true) on conflict (user_id) do update set full_name = excluded.full_name, pgy = excluded.pgy; commit;" 2>&1)
echo "$OUT" | grep -q "ACCOUNTS_PAUSED" && pass "P3 after the pause an old-Edge style upsert is refused" || bad "P3 got: $OUT"
OUT=$("${PSQL[@]}" -c "$(as_user $ADM) $(deactivate_sql $ADM $S2 "$(preview_counts $S2)") commit;" 2>&1)
echo "$OUT" | grep -q "ACCOUNTS_PAUSED" && pass "P4 after the pause an Admin deactivation is refused" || bad "P4 got: $OUT"
"${PSQL[@]}" -f "$(dirname "$0")/../supabase/manual/rc02a1_pause_off.sql" >/dev/null
OUT=$("${PSQL[@]}" -c "$(as_user $ADM) select public.admin_update_account('$R2', '$(updated_at $R2)', gen_random_uuid(), '{\"full_name\":\"Test r2 after\"}'::jsonb); commit;" 2>&1)
echo "$OUT" | grep -q '"changed": true' && pass "P5 after pause_off writes work again" || bad "P5 got: $OUT"

# ---------- G. v3 (Option A): an OLD-Edge request still running when the pause ends cannot write
OLD_EDGE="begin; set local role service_role; insert into public.resident_profiles (user_id, full_name, email, pgy, active) values ('$R2', 'Old Edge late write', 'r2@conc.test', 4, true) on conflict (user_id) do update set full_name = excluded.full_name, pgy = excluded.pgy, active = true;"
OUT=$("${PSQL[@]}" -c "$OLD_EDGE commit;" 2>&1)
echo "$OUT" | grep -q "ACCOUNT_WRITE_REFUSED" && pass "G1 after pause_off an old-Edge style upsert is still refused" || bad "G1 got: $OUT"
"${PSQL[@]}" -f "$(dirname "$0")/../supabase/manual/rc02a1_pause_on.sql" >/dev/null
# the old request starts while paused, waits 2 s (as if waiting for Auth/network), and writes after pause_off
( "${PSQL[@]}" -c "begin; set local role service_role; select pg_sleep(2); insert into public.resident_profiles (user_id, full_name, email, pgy, active) values ('$R2', 'Old Edge late write', 'r2@conc.test', 4, true) on conflict (user_id) do update set full_name = excluded.full_name, pgy = excluded.pgy, active = true; commit;" > /tmp/acc_a.out 2>&1 ) &
pa=$!
sleep 0.5
"${PSQL[@]}" -f "$(dirname "$0")/../supabase/manual/rc02a1_pause_off.sql" >/dev/null
wait $pa
grep -q "ACCOUNT_WRITE_REFUSED" /tmp/acc_a.out && pass "G2 an old-Edge request that was still running when the pause ended is refused" || bad "G2 got: $(cat /tmp/acc_a.out)"
[ "$("${PSQL[@]}" -c "select full_name || '/' || pgy from public.resident_profiles where user_id = '$R2'")" = "Test r2 after/2" ] && pass "G3 the account was not overwritten" || bad "G3 account changed"
NEWX=00000000-0000-0000-0000-0000000000e9
"${PSQL[@]}" -c "insert into auth.users(id, email) values ('$NEWX', 'newg@conc.test')" >/dev/null
OUT=$("${PSQL[@]}" -c "begin; set local role service_role; select public.admin_provision_account_internal('$ADM', '$NEWX', 'newg@conc.test', 'Test new g', 'resident', 1::smallint, null); commit;" 2>&1)
echo "$OUT" | grep -q '"created": true' && pass "G4 the new Edge path (reviewed function, service role) still adds accounts" || bad "G4 got: $OUT"

cleanup
if [ $fail = 0 ]; then echo "ALL ACCOUNT CONCURRENCY TESTS PASSED"; else echo "SOME ACCOUNT CONCURRENCY TESTS FAILED"; exit 1; fi
