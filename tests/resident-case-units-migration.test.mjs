import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = () => readFile(new URL("../supabase/migrations/20261002120000_resident_case_units.sql", import.meta.url), "utf8");

test("unit constraint is replaced with the five department units", async () => {
  const sql = await read();
  assert.match(sql, /drop constraint if exists resident_admission_cases_unit_name_check/);
  assert.match(sql, /add constraint resident_admission_cases_unit_name_check check \(unit_name in \('Upper GI', 'Colorectal', 'HPB', 'B&E', 'Vascular'\)\)/);
});

test("the test case ADM-00002 is removed with its notes and media rows first", async () => {
  const sql = await read();
  const notes = sql.indexOf("delete from public.resident_case_notes");
  const media = sql.indexOf("delete from public.resident_case_media");
  const cases = sql.indexOf("delete from public.resident_admission_cases");
  assert.ok(notes > 0 && media > notes && cases > media);
  assert.match(sql, /case_code = 'ADM-00002'/);
  // Any other row left on an old unit makes the migration fail loudly instead of guessing.
  assert.match(sql, /unit_name not in \('Upper GI', 'Colorectal', 'HPB', 'B&E', 'Vascular'\)/);
});

test("runs in one transaction and touches nothing else", async () => {
  const sql = await read();
  assert.match(sql, /^[\s\S]*\nbegin;\n[\s\S]*\ncommit;\s*$/);
  assert.doesNotMatch(sql, /drop table|resident_assessment|resident_profiles|resident_user_roles/i);
});
