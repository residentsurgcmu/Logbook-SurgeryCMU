import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Trauma migration only widens the unit list: nothing is deleted, dropped or rewritten", async () => {
  const sql = await read("supabase/migrations/20261004100000_resident_case_unit_trauma.sql");
  assert.match(sql, /check\s*\(unit_name in \('Upper GI', 'Colorectal', 'HPB', 'B&E', 'Vascular', 'Trauma'\)\)/);
  assert.match(sql, /drop constraint if exists resident_admission_cases_unit_name_check/);
  assert.doesNotMatch(sql, /delete from|drop table|drop column|truncate|update public\./i);
  assert.doesNotMatch(sql, /General surgery|HBP/);
});

test("the results page shows which Staff evaluated, in the table and in the detail view", async () => {
  const ui = await read("src/features/ResidentAssessmentViews.jsx");
  assert.match(ui, /<th>ผู้ประเมิน \(Staff\)<\/th>/);
  assert.match(ui, /<td>\{evaluatorName\(item\)\}<\/td>/);
  assert.match(ui, /ผู้ประเมิน \(Staff\): <strong>\{evaluatorName\(selected\)\}<\/strong>/);
  assert.match(ui, /profileById\.get\(item\.evaluator_id\)\?\.name \|\| "ไม่พบชื่อ Staff"/);
});

test("flashcards can open the Deck and the list searches by Owner; the table shows Management and Operation", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, />เปิด Deck</);
  assert.match(ui, /onPresent\(\{ id: row\.id, admit_date: row\.admit_date \}\)/);
  assert.match(ui, /personName\(people, row\.owner_id\)\}`\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(ui, /<th>Management<\/th><th>Operation<\/th>/);
  assert.match(ui, /data-label="Management"/);
  const css = await read("src/resident.css");
  assert.match(css, /@media \(max-width:700px\) \{\s*\.case-table, \.case-table tbody/);
});
