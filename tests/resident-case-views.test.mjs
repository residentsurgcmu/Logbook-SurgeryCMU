import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("new cases must pick a Type; editing keeps it optional", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /validateCaseForm\(form, new Date\(\), \{ requireType: !initial \}\)/);
  assert.match(ui, /initial \? "Type" : "Type \(จำเป็น\)"/);
  assert.match(ui, /<option value="">\{initial \? "ยังไม่ระบุ" : "เลือก Type"\}<\/option>/);
  // the database column stays nullable: older cases have no Type
  const sql = await read("supabase/migrations/20261004090000_resident_case_treatment_type.sql");
  assert.match(sql, /treatment_type is null or treatment_type in/);
});

test("the case list can show the same filtered cases as a table or as flashcards", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /const \[view, setView\] = useState\("table"\)/);
  assert.match(ui, /aria-label="รูปแบบการแสดงเคส"/);
  assert.match(ui, /view === "cards" && \(/);
  // flashcards iterate the same `visible` rows, so filters and search apply to both views
  const cards = ui.slice(ui.indexOf('className="case-cards"'), ui.indexOf('className="resident-table-wrap"'));
  assert.match(cards, /visible\.map\(\(row\)/);
  assert.match(cards, /setDialog\(\{ type: "detail", id: row\.id \}\)/);
  assert.doesNotMatch(cards, /present_illness|physical_exam|bp_systolic|heart_rate/);
});
