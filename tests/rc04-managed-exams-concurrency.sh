#!/usr/bin/env bash
# RC-04 managed exams — concurrency tests (two database sessions). Throwaway local database only (refuses real data).
# Synthetic FIXTURE ids only. Usage: PGHOST=/tmp PGUSER=postgres PGDATABASE=<throwaway> bash tests/rc04-managed-exams-concurrency.sh
# R05 (v3): every psql exit status is checked. Setup/lookup/preview commands abort the suite on any failure (no
# empty or stale value is used). Each race session's psql status comes back through `wait` (nothing runs after psql
# that could hide it). A session expected to succeed must exit 0 with no ERROR line; a session expected to be refused
# must exit 1 with exactly ONE ERROR line matching the expected code — any other status or extra error fails.
# Outputs go to a private temporary directory per run. Exit 0 only if every check passed.
set -u
set -o pipefail
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail=0; pass() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }
fatal() { echo "FAIL $1" >&2; echo "SOME RC04 CONCURRENCY TESTS FAILED (aborted)" >&2; exit 1; }  # stderr: visible also from $(...)

# q <sql>: one value; aborts on nonzero exit, ERROR or empty result
q() {
  local out rc
  out=$("${PSQL[@]}" -c "$1" 2>"$TMP/q.err"); rc=$?
  [ $rc -eq 0 ] || fatal "query failed (psql exit $rc): $(head -c 300 "$TMP/q.err") :: ${1:0:120}"
  [ -n "$out" ] || fatal "query returned nothing :: ${1:0:120}"
  printf '%s\n' "$out"
}
# run_ok <sql>: a statement that must succeed; prints its stdout; aborts otherwise
run_ok() {
  local out rc
  out=$("${PSQL[@]}" -c "$1" 2>&1); rc=$?
  { [ $rc -eq 0 ] && ! grep -q 'ERROR:' <<<"$out"; } || fatal "statement failed (psql exit $rc): $(grep -m1 'ERROR' <<<"$out") :: ${1:0:120}"
  printf '%s\n' "$out"
}
[ "$(q "select count(*) from public.resident_profiles")" = "0" ] || { echo "Refusing to run: database has Resident data"; exit 2; }
A1=10000000-0000-4000-8000-0000000000a1; A2=10000000-0000-4000-8000-0000000000a2
R1=10000000-0000-4000-8000-0000000000c1; R2=10000000-0000-4000-8000-0000000000c2
"${PSQL[@]}" > "$TMP/setup.out" 2>&1 <<SQL || fatal "setup failed: $(grep -m1 ERROR "$TMP/setup.out")"
update public.resident_maintenance_pause set paused = false where scope = 'accounts';
insert into auth.users(id, email) values ('$A1','a1@fixture.test'),('$A2','a2@fixture.test'),('$R1','r1@fixture.test'),('$R2','r2@fixture.test');
insert into public.resident_profiles(user_id, full_name, email, pgy, active) values
 ('$A1','Fixture a1','a1@fixture.test',null,true),('$A2','Fixture a2','a2@fixture.test',null,true),
 ('$R1','Fixture r1','r1@fixture.test',2,true),('$R2','Fixture r2','r2@fixture.test',2,true);
insert into public.resident_user_roles(user_id, role, active) values ('$A1','admin',true),('$A2','admin',true),('$R1','resident',true),('$R2','resident',true);
SQL
as() { echo "begin; set local role authenticated; select set_config('request.jwt.claim.sub', '$1', true);"; }

# race <label> <sqlA> <sqlB>: A holds its transaction 1.5 s after its call; B starts 0.4 s later.
# Sets SA/SB (psql exit status of each session, via wait), OA/OB (output), BWAIT (seconds B took).
race() {
  local d="$TMP/$1"; mkdir -p "$d"
  ( "${PSQL[@]}" -c "$2 select pg_sleep(1.5); commit;" > "$d/a.out" 2>&1 ) & local pa=$!
  sleep 0.4
  local t0; t0=$(date +%s.%N)
  ( "${PSQL[@]}" -c "$3 commit;" > "$d/b.out" 2>&1 ) & local pb=$!
  wait $pb; SB=$?
  local t1; t1=$(date +%s.%N)
  wait $pa; SA=$?
  OA=$(cat "$d/a.out"); OB=$(cat "$d/b.out"); DIR=$d
  BWAIT=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.2f", b - a }')
}
# expect_ok <label> <status> <output>: exit 0 and no ERROR line
expect_ok() {
  if [ "$2" -eq 0 ] && ! grep -q 'ERROR:' <<<"$3"; then pass "$1 (exit 0)"; else bad "$1: expected success, psql exit $2: $(grep -m1 'ERROR' <<<"$3")"; fi
}
# expect_reject <label> <status> <output> <code-regex>: exit 1 and exactly one ERROR line, which carries the code
expect_reject() {
  local n; n=$(grep -c 'ERROR:' <<<"$3")
  if [ "$2" -eq 1 ] && [ "$n" = "1" ] && grep 'ERROR:' <<<"$3" | grep -qE "$4"; then pass "$1 (exit 1, $(grep -oE "$4" <<<"$3" | head -1))"
  else bad "$1: expected one refusal matching $4; psql exit $2, ERROR lines $n: $(grep 'ERROR' <<<"$3" | head -2 | tr '\n' ' ')"; fi
}
nodeadlock() { grep -qi "deadlock detected" "$DIR/a.out" "$DIR/b.out" && bad "$1: deadlock" || pass "$1: no deadlock"; }
PAYLOAD='{"exam_type":"xray_anatomy","title":"Concurrency fixture","exam_date":"2026-06-20","academic_year":2569,
 "roster":[{"resident_id":"'$R1'","pgy_at_exam":2},{"resident_id":"'$R2'","pgy_at_exam":2}],
 "parts":[{"name":"A","sort_order":1,"max_score":100,"mpl":{"2":60}},{"name":"B","sort_order":2,"max_score":50,"mpl":{"2":30}}]}'

# C1 two identical create requests at once → one exam, the other is the replay
REQ=30000000-0000-4000-8000-000000000001
race C1 "$(as $A1) select public.rc04_create_managed_exam('$REQ', '$PAYLOAD');" "$(as $A1) select public.rc04_create_managed_exam('$REQ', '$PAYLOAD');"
expect_ok "C1-A create" "$SA" "$OA"; expect_ok "C1-B create (replay)" "$SB" "$OB"
[ "$(q "select count(*) from public.resident_exam_events where managed_by_rc04")" = "1" ] && pass "C1a identical concurrent create → one exam" || bad "C1a"
grep -q '"replayed": true' <<<"$OB" && pass "C1b the second call got the stored receipt" || bad "C1b: $OB"
nodeadlock C1
EXAM=$(q "select id from public.resident_exam_events where managed_by_rc04") || exit 1
REV=$(q "select id from public.rc04_exam_revisions where exam_id = '$EXAM'") || exit 1
PA=$(q "select part_id from public.rc04_revision_parts where revision_id = '$REV' and sort_order = 1") || exit 1
PB=$(q "select part_id from public.rc04_revision_parts where revision_id = '$REV' and sort_order = 2") || exit 1
ver() { q "select version from public.rc04_exam_revisions where id = '$REV'"; }
preview() { # user cells-json → preview json (aborts unless ok=true)
  local v out js; v=$(ver) || exit 1
  out=$(run_ok "$(as $1) select public.rc04_preview_import('$EXAM', '$REV', $v, '$2', '{}', null); commit;") || exit 1
  js=$(grep '^{' <<<"$out" | tail -1)
  grep -q '"ok": true' <<<"$js" || fatal "preview not ok: ${js:0:200}"
  printf '%s\n' "$js"
}
commit_sql() { # user request preview-json [reason]
  local id fp v; id=$(sed -E 's/.*"preview_id": "([^"]+)".*/\1/' <<<"$3"); fp=$(sed -E 's/.*"delta_fingerprint": "([^"]+)".*/\1/' <<<"$3"); v=$(sed -E 's/.*"expected_version": ([0-9]+).*/\1/' <<<"$3")
  [[ "$id" =~ ^[0-9a-f-]{36}$ && "$fp" =~ ^[0-9a-f]{64}$ && "$v" =~ ^[0-9]+$ ]] || fatal "cannot read preview fields"
  echo "$(as $1) select public.rc04_commit_import('$2', '$id', $v, '$fp', ${4:-null});"
}

# C2 the same commit request twice at once (lost response + retry overlap) → applied once
PV=$(preview $A1 '[{"resident_id":"'$R1'","part_id":"'$PA'","state":"scored","score":61}]') || exit 1
REQC=30000000-0000-4000-8000-000000000002
race C2 "$(commit_sql $A1 $REQC "$PV")" "$(commit_sql $A1 $REQC "$PV")"
expect_ok "C2-A commit" "$SA" "$OA"; expect_ok "C2-B same request (replay)" "$SB" "$OB"
[ "$(q "select count(*) from public.rc04_import_batches")" = "1" ] && [ "$(q "select count(*) from public.rc04_audit where operation = 'import.commit'")" = "1" ] && pass "C2a identical concurrent commits → one batch, one audit" || bad "C2a"
grep -q '"replayed": true' <<<"$OB" && pass "C2b the second got the receipt" || bad "C2b: $OB"
nodeadlock C2

# C3 two NEW requests on the same preview at once → one applies, the other is refused (consumed/conflict)
PV=$(preview $A1 '[{"resident_id":"'$R1'","part_id":"'$PB'","state":"absent"}]') || exit 1
race C3 "$(commit_sql $A1 30000000-0000-4000-8000-000000000003 "$PV")" "$(commit_sql $A1 30000000-0000-4000-8000-000000000004 "$PV")"
expect_ok "C3-A commit" "$SA" "$OA"
expect_reject "C3-B second new request on a used preview refused" "$SB" "$OB" "RC04_PREVIEW_CONSUMED|RC04_REVISION_CONFLICT"
[ "$(q "select count(*) from public.rc04_import_batches")" = "2" ] && pass "C3b applied once" || bad "C3b"
nodeadlock C3

# C4 two Admins, previews of the same version, commit at once → one wins, the other REVISION_CONFLICT; no stale overwrite
PV1=$(preview $A1 '[{"resident_id":"'$R2'","part_id":"'$PA'","state":"scored","score":70}]') || exit 1
PV2=$(preview $A2 '[{"resident_id":"'$R2'","part_id":"'$PA'","state":"scored","score":75}]') || exit 1
race C4 "$(commit_sql $A1 30000000-0000-4000-8000-000000000005 "$PV1")" "$(commit_sql $A2 30000000-0000-4000-8000-000000000006 "$PV2")"
expect_ok "C4-A first Admin commits" "$SA" "$OA"
expect_reject "C4-B the later Admin gets a conflict" "$SB" "$OB" "RC04_REVISION_CONFLICT"
[ "$(q "select score from public.rc04_revision_results where revision_id = '$REV' and resident_id = '$R2' and part_id = '$PA'")" = "70.00" ] && pass "C4b the first value is kept" || bad "C4b"
nodeadlock C4

# fill + review
PV=$(preview $A1 '[{"resident_id":"'$R2'","part_id":"'$PB'","state":"awaiting"}]') || exit 1
run_ok "$(commit_sql $A1 30000000-0000-4000-8000-000000000007 "$PV") commit;" > /dev/null || exit 1
run_ok "$(as $A1) select public.rc04_mark_reviewed(gen_random_uuid(), '$EXAM', '$REV', $(ver), '{\"absent\":1,\"awaiting\":1}'); commit;" > /dev/null || exit 1

# C5 publish vs commit by the preview OWNER, both orders; B must really wait for A's locks (≥ 0.9 s)
waited() { [ "$(awk -v w="$BWAIT" 'BEGIN { print (w >= 0.9) ? 1 : 0 }')" = "1" ]; }
batches() { q "select count(*) from public.rc04_import_batches"; }
# order 1: commit holds the locks, publish (expected version from before) comes second
V=$(ver) || exit 1; PV=$(preview $A1 '[{"resident_id":"'$R1'","part_id":"'$PA'","state":"scored","score":62}]') || exit 1; NB=$(batches) || exit 1
race C5o1 "$(commit_sql $A1 30000000-0000-4000-8000-000000000008 "$PV" "'second check'")" "$(as $A2) select public.rc04_publish_revision(gen_random_uuid(), '$EXAM', '$REV', $V, null, '{\"absent\":1,\"awaiting\":1}');"
expect_ok "C5a commit (first)" "$SA" "$OA"
grep -q '"changed_count": 1' <<<"$OA" && pass "C5a' commit applied one change" || bad "C5a': $OA"
waited && pass "C5b publish really waited for the commit's locks (${BWAIT}s)" || bad "C5b publish did not wait (${BWAIT}s)"
expect_reject "C5c publish (second) refused: version moved, nothing published" "$SB" "$OB" "RC04_REVISION_CONFLICT"
[ "$(q "select state || ':' || coalesce(checked_version::text, '-') || ':' || (select score from public.rc04_revision_results where revision_id = '$REV' and resident_id = '$R1' and part_id = '$PA') from public.rc04_exam_revisions where id = '$REV'")" = "working:-:62.00" ] && [ "$(batches)" = "$((NB + 1))" ] && pass "C5d serial result: still working, review cleared, score 62, one batch" || bad "C5d"
nodeadlock C5-order1
# order 2: publish holds the locks, commit by the preview owner comes second
run_ok "$(as $A1) select public.rc04_mark_reviewed(gen_random_uuid(), '$EXAM', '$REV', $(ver), '{\"absent\":1,\"awaiting\":1}'); commit;" > /dev/null || exit 1
V=$(ver) || exit 1; PV=$(preview $A1 '[{"resident_id":"'$R1'","part_id":"'$PA'","state":"scored","score":63}]') || exit 1; NB=$(batches) || exit 1
NR=$(q "select count(*) from public.rc04_request_receipts where request_id = '30000000-0000-4000-8000-000000000009'") || exit 1
race C5o2 "$(as $A2) select public.rc04_publish_revision(gen_random_uuid(), '$EXAM', '$REV', $V, null, '{\"absent\":1,\"awaiting\":1}');" "$(commit_sql $A1 30000000-0000-4000-8000-000000000009 "$PV" "'third check'")"
expect_ok "C5e publish (first)" "$SA" "$OA"
grep -q '"published_revision_id"' <<<"$OA" && pass "C5e' publish returned the published revision" || bad "C5e': $OA"
waited && pass "C5f commit really waited for the publish locks (${BWAIT}s)" || bad "C5f commit did not wait (${BWAIT}s)"
expect_reject "C5g commit (second) refused after the revision became published" "$SB" "$OB" "RC04_NOT_WORKING"
[ "$(q "select state || ':' || (select score from public.rc04_revision_results where revision_id = '$REV' and resident_id = '$R1' and part_id = '$PA') from public.rc04_exam_revisions where id = '$REV'")" = "published:62.00" ] && [ "$(batches)" = "$NB" ] && [ "$(q "select count(*) from public.rc04_request_receipts where request_id = '30000000-0000-4000-8000-000000000009'")" = "$NR" ] && pass "C5h serial result: published with 62, no batch, no receipt left by the refused commit" || bad "C5h"
nodeadlock C5-order2

# C6 two corrections begun at once → one working revision
race C6 "$(as $A1) select public.rc04_begin_correction(gen_random_uuid(), '$EXAM', '$REV', 'fix 1');" "$(as $A2) select public.rc04_begin_correction(gen_random_uuid(), '$EXAM', '$REV', 'fix 2');"
expect_ok "C6-A first correction" "$SA" "$OA"
expect_reject "C6b the second is refused" "$SB" "$OB" "RC04_WORKING_REVISION_EXISTS"
[ "$(q "select count(*) from public.rc04_exam_revisions where exam_id = '$EXAM' and state = 'working'")" = "1" ] && pass "C6a one working correction" || bad "C6a"
nodeadlock C6

# C7 publish of the correction while a Staff read set is open: pages keep the pinned revision
W=$(q "select id from public.rc04_exam_revisions where exam_id = '$EXAM' and state = 'working'") || exit 1
run_ok "update public.resident_user_roles set role = 'staff' where user_id = '$A2'" > /dev/null || exit 1
M=$(run_ok "$(as $A2) select public.rc04_open_read_set('staff')->>'manifest_id'; commit;" | grep -E '^[0-9a-f-]{36}$' | tail -1)
[ -n "$M" ] || fatal "C7 no read set id"
P1=$(run_ok "$(as $A2) select public.rc04_read_page('$M', null, 2); commit;" | grep '^{') || exit 1
run_ok "$(as $A1) select public.rc04_mark_reviewed(gen_random_uuid(), '$EXAM', '$W', 1, '{\"absent\":1,\"awaiting\":1}'); commit;" > /dev/null || exit 1
run_ok "$(as $A1) select public.rc04_publish_revision(gen_random_uuid(), '$EXAM', '$W', 1, '$REV', '{\"absent\":1,\"awaiting\":1}'); commit;" > /dev/null || exit 1
CUR=$(sed -E 's/.*"next_cursor": (\{[^}]*\}).*/\1/' <<<"$P1"); [[ "$CUR" == \{* ]] || fatal "C7 page 1 has no next_cursor"
P2=$(run_ok "$(as $A2) select public.rc04_read_page('$M', '$CUR', 2); commit;" | grep '^{') || exit 1
grep -q "\"revision_id\": \"$REV\"" <<<"$P2" && ! grep -q "\"revision_id\": \"$W\"" <<<"$P2" && pass "C7 page 2 after the new publication is still the pinned revision" || bad "C7: $P2"

if [ $fail = 0 ]; then echo "ALL RC04 CONCURRENCY TESTS PASSED"; exit 0; else echo "SOME RC04 CONCURRENCY TESTS FAILED"; exit 1; fi
