import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/20261015110000_exam_mpl_rpcs.sql", import.meta.url), "utf8");
const fn = (name) => {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `${name} missing`);
  const next = sql.indexOf("create or replace function", start + 10);
  return sql.slice(start, next < 0 ? undefined : next);
};

test("the legacy create/save/publish functions are not redefined", () => {
  assert.doesNotMatch(sql, /create or replace function public\.create_resident_exam_event\(/);
  assert.doesNotMatch(sql, /create or replace function public\.save_resident_exam_results\(/);
  assert.doesNotMatch(sql, /create or replace function public\.set_resident_exam_publication\(/);
});

test("create_resident_exam_event_mpl reuses the legacy validation, locks PGY and snapshots MPL", () => {
  const body = fn("create_resident_exam_event_mpl");
  assert.match(body, /private\.resident_role_is\('admin'\)/);
  assert.match(body, /public\.create_resident_exam_event\(\s*p_exam_type, p_exam_date, p_title, p_max_score, v_names, p_participant_ids\)/);
  assert.match(body, /set scoring_mode = 'mpl'/);
  assert.match(body, /set pgy_at_exam = case when profile\.pgy between 1 and 4 then profile\.pgy end/);
  assert.match(body, /update public\.resident_exam_parts set max_score = v_max/);
  assert.match(body, /insert into public\.resident_exam_mpl\(event_id, part_id, pgy, mpl\)/);
  assert.match(body, /private\.resident_exam_parse_number\(v_text, v_max, 'MPL'\)/);
  assert.match(body, /MCQ needs exactly one MPL row/);
  assert.match(body, /revoke all on function public\.create_resident_exam_event_mpl\(text, date, text, numeric, jsonb, jsonb\) from public, anon/);
});

test("save_resident_exam_scores never reads an outcome from the client and computes score >= MPL", () => {
  const body = fn("save_resident_exam_scores");
  assert.doesNotMatch(body, /v_result->>'outcome'/);
  assert.match(body, /scoring_mode <> 'mpl'/);
  assert.match(body, /v_event\.status <> 'draft'/);
  assert.match(body, /Exam result is duplicated/);
  assert.match(body, /Exam result includes a Resident outside this exam/);
  assert.match(body, /private\.resident_exam_parse_number\(v_result->>'score', v_max, 'Score'\)/);
  assert.match(body, /part_id is not distinct from v_part_id and pgy = v_pgy/);
  assert.match(body, /when v_mpl is null then null\s+when v_score >= v_mpl then 'pass'\s+else 'remediation'/);
  assert.match(body, /'computed'/);
  assert.match(body, /for update/);
});

test("update_resident_exam_mpl is draft-only and recomputes every outcome in the same transaction", () => {
  const body = fn("update_resident_exam_mpl");
  assert.match(body, /v_event\.status <> 'draft'/);
  assert.match(body, /delete from public\.resident_exam_mpl where event_id = p_event_id/);
  assert.match(body, /update public\.resident_exam_results result\s+set outcome = \(/);
  assert.match(body, /outcome_source = 'computed'/);
  assert.match(body, /MPL row is duplicated/);
});

test("list_resident_exam_records is dropped and recreated with the new columns, same visibility rule", () => {
  assert.match(sql, /drop function public\.list_resident_exam_records\(\)/);
  const body = sql.slice(sql.indexOf("create or replace function public.list_resident_exam_records"));
  for (const column of ["scoring_mode text", "part_max_score numeric", "pgy_at_exam smallint", "mpl numeric", "outcome_source text"]) {
    assert.ok(body.includes(column), column);
  }
  assert.match(body, /mpl_row\.pgy = participant\.pgy_at_exam/);
  assert.match(body, /event\.status = 'published'/);
  assert.match(body, /participant\.resident_id = \(select auth\.uid\(\)\)/);
  assert.match(body, /grant execute on function public\.list_resident_exam_records\(\) to authenticated/);
  assert.match(body, /revoke all on function public\.list_resident_exam_records\(\) from public, anon/);
});

test("every new function is closed to anon", () => {
  for (const signature of [
    "create_resident_exam_event_mpl\\(text, date, text, numeric, jsonb, jsonb\\)",
    "save_resident_exam_scores\\(uuid, jsonb\\)",
    "update_resident_exam_mpl\\(uuid, jsonb\\)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature} from public, anon`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature} to authenticated`));
  }
});

test("save_resident_exam_scores sets the transaction-local flag before it deletes the old results", () => {
  const body = fn("save_resident_exam_scores");
  const flag = body.indexOf("set_config('app.exam_mpl_save', 'on', true)");
  assert.ok(flag > 0, "flag missing");
  assert.ok(flag < body.indexOf("delete from public.resident_exam_results"), "flag must be set before the delete");
});
