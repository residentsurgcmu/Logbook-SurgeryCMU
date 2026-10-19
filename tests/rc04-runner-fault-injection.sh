#!/usr/bin/env bash
# RC-04 R05: fault-injection tests for the test RUNNERS themselves (not for the database code).
# A fake `psql` is put first on PATH only inside this script. It passes every call through to the real psql of the
# local throwaway database, except ONE call chosen per case (regex over the arguments / -f file / stdin, Nth match),
# where it injects a fault:
#   before         : prints a connection-style error, exit 2, no output
#   after          : runs the real call (full output), then prints "ERROR: injected" on stderr, exit 3
#   flip           : runs the real call, then turns the first "|t" row into "|f", exit 0
#   extra_error    : runs the real call (keeps its own status/output), then adds a second unexpected ERROR line
# Each case runs the REAL runner and asserts its exit status (nonzero for faults, 0 for positive controls).
# Usage (throwaway databases only):
#   PGHOST=/tmp PGUSER=postgres INV_DB=<migrated db> CONC_DB=<db name> \
#   FRESH_DB_CMD='bash <tools>/apply.sh <db name> <repo>' bash tests/rc04-runner-fault-injection.sh
# Optional: INV_RUNNER / CONC_RUNNER to point at other runner versions (used to show the v2 runners missed faults).
set -u
set -o pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
INV_RUNNER=${INV_RUNNER:-$HERE/rc04-release-inventory-negative.sh}
CONC_RUNNER=${CONC_RUNNER:-$HERE/rc04-managed-exams-concurrency.sh}
: "${INV_DB:?set INV_DB}" "${CONC_DB:?set CONC_DB}" "${FRESH_DB_CMD:?set FRESH_DB_CMD}"
REAL_PSQL=$(command -v psql) || { echo "FAIL no real psql"; exit 2; }
FI=$(mktemp -d); trap 'rm -rf "$FI"' EXIT
mkdir -p "$FI/bin"
cat > "$FI/bin/psql" <<'EOF'
#!/usr/bin/env bash
# fake psql (fault injection) — passthrough unless this call is the selected one
args="$*"; content="$args"; stdin_file=""
want_stdin=1
for a in "$@"; do case "$a" in -c|-f) want_stdin=0;; esac; done
prev=""; for a in "$@"; do [ "$prev" = "-f" ] && content="$content $(cat "$a" 2>/dev/null)"; prev="$a"; done
if [ $want_stdin = 1 ]; then stdin_file=$(mktemp); cat > "$stdin_file"; content="$content $(cat "$stdin_file")"; fi
hit=0
if [ -n "${FI_MATCH:-}" ] && grep -qE -- "$FI_MATCH" <<<"$content"; then
  n=$(( $(cat "$FI_COUNT" 2>/dev/null || echo 0) + 1 )); echo $n > "$FI_COUNT"
  [ "$n" = "${FI_NTH:-1}" ] && hit=1
fi
real() { if [ -n "$stdin_file" ]; then "$REAL_PSQL" "$@" < "$stdin_file"; else "$REAL_PSQL" "$@" < /dev/null; fi; }
if [ $hit = 0 ]; then real "$@"; s=$?; [ -n "$stdin_file" ] && rm -f "$stdin_file"; exit $s; fi
echo "fault-injected ($FI_KIND) call #$n" >> "$FI_LOG"
case "$FI_KIND" in
  before) echo "psql: error: connection to server failed (fault injection)" >&2; exit 2;;
  after) real "$@"; echo "ERROR:  injected fault after complete output" >&2; exit 3;;
  flip) real "$@" | sed '0,/|t$/s//|f/'; exit 0;;
  extra_error) real "$@"; s=$?; echo "ERROR:  injected unexpected second error" >&2; exit $s;;
esac
EOF
chmod +x "$FI/bin/psql"
export REAL_PSQL FI_LOG="$FI/log"
fail=0; pass() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }

# fi_case <label> <expect: zero|nonzero> <runner> <db> <fresh: yes|no> <match> <nth> <kind>
fi_case() {
  local label=$1 expect=$2 runner=$3 db=$4 fresh=$5
  rm -f "$FI/count" "$FI_LOG"
  if [ "$fresh" = yes ]; then bash -c "$FRESH_DB_CMD" > "$FI/fresh.out" 2>&1 || { bad "$label: could not prepare $db"; return; }; fi
  ( export PATH="$FI/bin:$PATH" FI_COUNT="$FI/count" FI_MATCH="$6" FI_NTH="$7" FI_KIND="$8" PGDATABASE="$db"
    bash "$runner" > "$FI/run.out" 2>&1 )
  local rc=$?
  local injected; injected=$(cat "$FI_LOG" 2>/dev/null | head -1)
  if [ -n "$6" ] && [ -z "$injected" ]; then bad "$label: the fault was never injected (selector did not match)"; return; fi
  if [ "$expect" = zero ] && [ $rc -eq 0 ]; then pass "$label: runner exit 0 ${injected:+($injected)}"
  elif [ "$expect" = nonzero ] && [ $rc -ne 0 ]; then pass "$label: runner exit $rc as required ($injected; $(grep -m1 '^FAIL' "$FI/run.out" | cut -c1-110))"
  else bad "$label: runner exit $rc, expected $expect ($injected) — last lines: $(tail -2 "$FI/run.out" | tr '\n' ' ' | cut -c1-200)"; fi
}

echo "== inventory runner: $INV_RUNNER (db $INV_DB)"
fi_case "F1 positive control (no fault)"                         zero    "$INV_RUNNER" "$INV_DB" no  ""                                   1 none
fi_case "F2 baseline: error before any row"                       nonzero "$INV_RUNNER" "$INV_DB" no  "."                                  1 before
fi_case "F3 baseline: 65 true rows printed, then ERROR + exit 3"  nonzero "$INV_RUNNER" "$INV_DB" no  "."                                  1 after
fi_case "F4 baseline: exit 0 but one row false"                   nonzero "$INV_RUNNER" "$INV_DB" no  "."                                  1 flip
fi_case "F5 negative case: 65 rows with false, then ERROR exit 3" nonzero "$INV_RUNNER" "$INV_DB" no  "drop function public.rc04_read_page" 1 after
fi_case "F6 negative case: error before any row"                  nonzero "$INV_RUNNER" "$INV_DB" no  "disable trigger rc04_immutable"     1 before

echo "== concurrency runner: $CONC_RUNNER (fresh db $CONC_DB each case)"
fi_case "G1 positive control (no fault)"                                 zero    "$CONC_RUNNER" "$CONC_DB" yes ""                                                          1 none
fi_case "G2 session A fails after its output (exit 3)"                   nonzero "$CONC_RUNNER" "$CONC_DB" yes "pg_sleep\(1\.5\)"                                         1 after
fi_case "G3 session B fails before any output (exit 2)"                  nonzero "$CONC_RUNNER" "$CONC_DB" yes "rc04_create_managed_exam\('30000000-0000-4000-8000-000000000001'" 2 before
fi_case "G4 session B fails after a successful replay (exit 3)"          nonzero "$CONC_RUNNER" "$CONC_DB" yes "30000000-0000-4000-8000-000000000002"                     2 after
fi_case "G5 expected refusal + an unexpected second ERROR (C4-B)"        nonzero "$CONC_RUNNER" "$CONC_DB" yes "30000000-0000-4000-8000-000000000006"                     1 extra_error
fi_case "G6 version lookup fails (no empty value used)"                  nonzero "$CONC_RUNNER" "$CONC_DB" yes "select version from public\.rc04_exam_revisions"         1 before
fi_case "G7 preview call fails after printing its result"                nonzero "$CONC_RUNNER" "$CONC_DB" yes "rc04_preview_import"                                      1 after
fi_case "G8 setup (heredoc) fails"                                       nonzero "$CONC_RUNNER" "$CONC_DB" yes "insert into auth\.users"                                  1 after

if [ $fail = 0 ]; then echo "ALL RC04 RUNNER FAULT-INJECTION TESTS PASSED"; exit 0; else echo "SOME RC04 RUNNER FAULT-INJECTION TESTS FAILED"; exit 1; fi
