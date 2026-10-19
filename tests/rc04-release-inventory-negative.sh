#!/usr/bin/env bash
# RC-04: the release inventory must FAIL when an expected object is missing or weakened (fail-closed proof).
# Throwaway local database with all migrations; every case runs in a transaction that is rolled back.
# PGHOST=/tmp PGUSER=postgres PGDATABASE=<throwaway> bash tests/rc04-release-inventory-negative.sh
# R05 (v3): the psql exit status is checked BEFORE any row is counted; a failed command, connection or transaction
# fails the case even when 65 rows were already printed. Exit 0 only if every case passed.
set -u
set -o pipefail
INV="$(dirname "$0")/../supabase/manual/rc04_release_inventory.sql"
[ -r "$INV" ] || { echo "FAIL inventory file not readable: $INV"; exit 2; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail=0; pass() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }

# run_inv <label> <mutation sql> → sets RC, ROWS, TRUE_N, FALSE_N, OUT (stdout+stderr of psql only)
run_inv() {
  { echo "begin;"; [ -n "$2" ] && echo "$2"; cat "$INV"; echo "rollback;"; } > "$TMP/in.sql"
  psql -X -q -At -v ON_ERROR_STOP=1 -f "$TMP/in.sql" > "$TMP/out.txt" 2>&1
  RC=$?
  OUT=$(cat "$TMP/out.txt")
  ROWS=$(grep -cE '^I-.*\|[tf]$' "$TMP/out.txt")
  TRUE_N=$(grep -cE '^I-.*\|t$' "$TMP/out.txt")
  FALSE_N=$(grep -cE '^I-.*\|f$' "$TMP/out.txt")
}

# baseline: must succeed, 65 rows, all true
run_inv "N0" ""
if [ "$RC" -ne 0 ]; then bad "N0 baseline: psql exit $RC ($(grep -m1 ERROR "$TMP/out.txt"))"
elif [ "$ROWS" != "65" ] || [ "$TRUE_N" != "65" ]; then bad "N0 baseline: rows=$ROWS true=$TRUE_N (expected 65/65)"
else pass "N0 untouched database: exit 0, 65/65 true"; fi

# negative case: the mutation + inventory must succeed (exit 0), give 65 rows and at least one false
case_neg() {
  run_inv "$1" "$2"
  if [ "$RC" -ne 0 ]; then bad "$1 → psql exit $RC, case not accepted ($(grep -m1 ERROR "$TMP/out.txt"))"
  elif [ "$ROWS" != "65" ]; then bad "$1 → exit 0 but rows=$ROWS (expected 65)"
  elif [ "$FALSE_N" -lt 1 ]; then bad "$1 → exit 0, 65 rows, but no false row (mutation not detected)"
  else pass "$1 → exit 0, $FALSE_N false row(s) of 65"; fi
}
case_neg "N1 public RPC dropped" "drop function public.rc04_read_page(uuid,jsonb,integer);"
case_neg "N2 RPC search_path changed" "alter function public.rc04_commit_import(uuid,uuid,integer,text,text) set search_path = public;"
case_neg "N3 RPC made callable by anon" "grant execute on function public.rc04_create_managed_exam(uuid,jsonb) to anon;"
case_neg "N4 private helper made callable" "grant execute on function private.rc04_receipt_begin(uuid,text,uuid,jsonb) to authenticated;"
case_neg "N5 private helper dropped" "drop function private.rc04_validation(uuid) cascade;"
case_neg "N6 trigger disabled" "alter table public.rc04_revision_results disable trigger rc04_immutable;"
case_neg "N7 trigger dropped" "drop trigger rc04_guard_exam_event on public.resident_exam_events;"
case_neg "N8 RLS disabled on a table" "alter table public.rc04_audit disable row level security;"
case_neg "N9 table dropped" "drop table public.rc04_read_manifests;"
case_neg "N10 events policy lost the exclusion" "drop policy resident_exam_events_visible on public.resident_exam_events; create policy resident_exam_events_visible on public.resident_exam_events for select to authenticated using (true);"
case_neg "N11 legacy writer without guard" "create or replace function public.delete_resident_exam_event(p_event_id uuid) returns void language plpgsql security definer set search_path = public as \$\$ begin delete from public.resident_exam_events where id = p_event_id; end; \$\$;"
case_neg "N12 legacy reader without exclusion" "drop function public.list_resident_exam_records(); create function public.list_resident_exam_records() returns void language sql as 'select';"
case_neg "N13 one-working-revision index dropped" "drop index public.rc04_one_working_revision;"

if [ $fail = 0 ]; then echo "ALL RC04 INVENTORY NEGATIVE TESTS PASSED"; exit 0; else echo "SOME RC04 INVENTORY NEGATIVE TESTS FAILED"; exit 1; fi
