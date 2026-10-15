import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/20261016090000_exam_delete_draft.sql", import.meta.url), "utf8");

test("delete_resident_exam_event is Admin-only and refuses anything that is not a Draft", () => {
  assert.match(sql, /^begin;/m);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /create or replace function public\.delete_resident_exam_event\(p_event_id uuid\)\s*returns void/);
  assert.match(sql, /security definer set search_path = public, private, auth/);
  assert.match(sql, /private\.resident_role_is\('admin'\)/);
  assert.match(sql, /for update/);
  assert.match(sql, /if v_event\.status <> 'draft' then raise exception 'Return the exam to Draft before deleting it'/);
});

test("it opens the guard for this transaction only, deletes just the event row, and never touches other tables by hand", () => {
  assert.match(sql, /perform set_config\('app\.exam_mpl_save', 'on', true\);\s*delete from public\.resident_exam_events where id = p_event_id;/);
  assert.equal((sql.match(/delete from /g) || []).length, 1);
  assert.doesNotMatch(sql, /drop |truncate|alter table/i);
});

test("only signed-in users can call it (the Admin check does the rest)", () => {
  assert.match(sql, /revoke all on function public\.delete_resident_exam_event\(uuid\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.delete_resident_exam_event\(uuid\) to authenticated;/);
});
