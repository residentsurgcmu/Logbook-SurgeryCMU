import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await readFile(new URL("../src/residentApi.js", import.meta.url), "utf8");

test("residentApi exposes the exam MPL calls and keeps the legacy ones", () => {
  for (const name of ["listExamStandards", "saveExamStandards", "listExamMpl", "updateExamMpl", "createResidentExamMpl", "saveResidentExamScores", "createResidentExam", "saveResidentExamResults"]) {
    assert.match(api, new RegExp(`export async function ${name}\\(`), name);
  }
});

test("each call goes to the matching database object with the agreed parameter names", () => {
  assert.match(api, /supabase\.rpc\("save_resident_exam_standards", \{ p_standards: rows \}\)/);
  assert.match(api, /\.from\("resident_exam_standards"\)\s*\.select\("id,exam_type,part_name,max_score,resident_exam_standard_mpl\(pgy,mpl\)"\)/);
  assert.match(api, /\.from\("resident_exam_mpl"\)\s*\.select\("part_id,pgy,mpl"\)\s*\.eq\("event_id", eventId\)/);
  assert.match(api, /supabase\.rpc\("update_resident_exam_mpl", \{\s*p_event_id: eventId,\s*p_mpl: rows,?\s*\}\)/);
  assert.match(api, /supabase\.rpc\("create_resident_exam_event_mpl", \{/);
  assert.match(api, /p_parts: form\.parts,/);
  assert.match(api, /supabase\.rpc\("save_resident_exam_scores", \{\s*p_event_id: eventId,\s*p_results: results,?\s*\}\)/);
});

test("the outcome is never sent when saving MPL scores", () => {
  const start = api.indexOf("export async function saveResidentExamScores");
  assert.ok(start >= 0);
  const next = api.indexOf("\nexport ", start + 10);
  const body = api.slice(start, next < 0 ? undefined : next);
  assert.doesNotMatch(body, /outcome/);
});
