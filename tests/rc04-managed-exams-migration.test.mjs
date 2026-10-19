// RC-04 B001: structure checks that run with npm test (behaviour is proven by the SQL suites:
// tests/rc04-managed-exams-behavior.sql, tests/rc04-managed-exams-concurrency.sh, release rehearsal).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const MIG = "supabase/migrations/20261019090000_rc04_managed_exams.sql";

test("every legacy exam writer rejects a managed exam before any mutation", async () => {
  const sql = await read(MIG);
  for (const fn of ["public.save_resident_exam_scores", "public.save_resident_exam_results", "public.set_resident_exam_publication",
    "public.update_resident_exam_mpl", "private.resident_exam_replace_mpl", "public.delete_resident_exam_event"]) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
    assert.ok(start > 0, fn);
    const body = sql.slice(start, sql.indexOf("$function$;", start));
    const guard = body.indexOf("perform private.rc04_reject_managed_exam(p_event_id);");
    assert.ok(guard > 0 && guard < body.search(/\b(insert|update|delete)\b/i), `${fn}: guard before the first write`);
  }
});

test("legacy reader and events policy exclude managed exams on the server", async () => {
  const sql = await read(MIG);
  assert.match(sql, /where not event\.managed_by_rc04/);
  assert.match(sql, /create policy resident_exam_events_visible[\s\S]*?not managed_by_rc04/);
});

test("rc04 tables: RLS on, no client or service-role privilege; published rows immutable; audit append-only", async () => {
  const sql = await read(MIG);
  assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated, service_role/);
  assert.match(sql, /RC04_IMMUTABLE: rows of a published revision cannot change/);
  assert.match(sql, /RC04_IMMUTABLE: audit is append-only/);
  assert.match(sql, /value_state text not null check \(value_state in \('scored', 'absent', 'awaiting', 'unknown'\)\)/);
  assert.match(sql, /or \(value_state <> 'scored' and score is null and outcome is null\)/);
});

test("every RC-04 write checks the Admin before the request receipt; lock order receipt → exam → revisions → preview", async () => {
  const sql = await read(MIG);
  for (const fn of ["rc04_create_managed_exam", "rc04_update_working_revision", "rc04_commit_import", "rc04_mark_reviewed", "rc04_publish_revision", "rc04_begin_correction"]) {
    const start = sql.indexOf(`function public.${fn}(`);
    const body = sql.slice(start, sql.indexOf("\n$$;", start));
    const admin = body.indexOf("private.rc04_require_admin()"), receipt = body.indexOf("private.rc04_receipt_begin(");
    assert.ok(admin > 0 && admin < receipt, `${fn}: admin before receipt`);
    const exam = body.indexOf("rc04_lock_exam("), rev = body.indexOf("rc04_lock_revision(");
    if (exam > 0) assert.ok(receipt < exam && (rev < 0 || exam < rev), `${fn}: receipt → exam → revision`);
  }
  const commit = sql.slice(sql.indexOf("function public.rc04_commit_import("));
  assert.ok(commit.indexOf("rc04_lock_revision(") < commit.indexOf("where id = p_preview_id for update"), "commit: revision before preview");
});

test("release rollback keeps data, guards and exclusion", async () => {
  const rb = await read("supabase/manual/rc04_rollback_entrypoints.sql");
  assert.match(rb, /drop function %s/);
  assert.doesNotMatch(rb, /drop table|delete from|truncate/i);
  assert.match(rb, /legacy reader exclusion missing/);
  assert.match(rb, /legacy writer guards missing/);
});

test("no real names, e-mails or keys in RC-04 test files", async () => {
  for (const f of ["tests/rc04-managed-exams-behavior.sql", "tests/rc04-managed-exams-concurrency.sh", "tests/rc04-fixtures.sql"]) {
    const s = await read(f);
    assert.doesNotMatch(s, /@(gmail|cmu|hotmail|outlook)\./i, f);
    assert.doesNotMatch(s, /eyJ[A-Za-z0-9_-]{20,}/, `${f}: no JWT`);
  }
});

test("B002: roster cap after update, strict file metadata, real no-op, strict cursor", async () => {
  const sql = await read(MIG);
  const upd = sql.slice(sql.indexOf("function public.rc04_update_working_revision("));
  assert.match(upd, /if v_roster > 200 then raise exception 'RC04_LIMIT/);
  assert.match(upd, /is distinct from \(v_rev\.title, v_rev\.exam_date, v_rev\.academic_year\)/);
  assert.ok(upd.indexOf("if v_n = 0 then") < upd.indexOf("private.rc04_bump(p_revision_id)"), "no-op returns before bump");
  assert.match(sql, /function private\.rc04_file_reported_errors\(p jsonb, p_exam_id uuid, p_revision_id uuid\)/);
  assert.match(sql, /FILE_REPORTED_NOT_OBJECT[\s\S]*FILE_REPORTED_MISSING_KEY[\s\S]*FILE_REPORTED_NULL[\s\S]*FILE_REPORTED_WRONG_TYPE/);
  assert.match(sql, /v_errors := private\.rc04_file_reported_errors\(p_file_reported, p_exam_id, p_revision_id\);/);
  assert.match(sql, /not \(p_cursor \?& array\['manifest_id', 'i', 'r', 's', 'p'\]\)/);
});

test("B002-B04: fixtures keep nulls and every required argument", async () => {
  const fx = JSON.parse(await read("docs/rc04/RC04_backend_fixtures_v2.json"));
  const firstPublish = fx.cases.find((c) => c.call === "rc04_publish_revision");
  assert.ok("p_expected_published_revision_id" in firstPublish.request && firstPublish.request.p_expected_published_revision_id === null);
  const rows = fx.cases.filter((c) => c.call === "rc04_read_page" && c.response).flatMap((c) => c.response.rows);
  const absence = rows.filter((r) => r.value_state === "absent" || r.value_state === "awaiting");
  assert.ok(absence.length > 0 && absence.every((r) => "score" in r && r.score === null && "outcome" in r && r.outcome === null));
  assert.ok(fx.cases.every((c) => ("response" in c) !== ("error" in c)), "each case has response or error, never both/none");
});
