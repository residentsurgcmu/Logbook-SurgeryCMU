import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Type replaces the visible status on form, list, detail, conference and both exports", async () => {
  const cases = await read("src/features/ResidentCases.jsx");
  const conference = await read("src/features/ResidentConference.jsx");
  assert.match(cases, /<select value=\{form\.treatment_type\} onChange=\{set\("treatment_type"\)\}/);
  assert.doesNotMatch(cases, /<label>สถานะ<select/);
  assert.doesNotMatch(cases + conference, /CaseStatusChip|CASE_STATUSES|caseStatusLabel/);
  assert.match(cases, /<CaseTypeChip type=\{row\.treatment_type\}/);
  assert.match(conference, /<CaseTypeChip type=\{current\.treatment_type\}/);
  assert.doesNotMatch(await read("src/casePptx.js"), /"สถานะ"/);
  assert.doesNotMatch(await read("src/caseExcel.js"), /"สถานะ"/);
});

test("the hidden legacy status keeps being sent so older rows and the existing RPCs stay valid", async () => {
  const api = await read("src/residentCasesApi.js");
  const cases = await read("src/features/ResidentCases.jsx");
  assert.match(api, /p_status: form\.status/);
  assert.match(cases, /status: "admit",\s*\n\s*treatment_type: ""/);
  assert.match(cases, /status: row\.status,\s*\n\s*treatment_type: row\.treatment_type \|\| ""/);
});

test("a case and its Type are saved in ONE database step, both when creating and when editing; the screen never makes a separate Type call", async () => {
  const api = await read("src/residentCasesApi.js");
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(api, /CASE_COLUMNS = "[^"]*status,treatment_type,/);
  // create: one call that carries the Type
  const create = api.slice(api.indexOf("export async function createAdmissionCase"), api.indexOf("export async function updateAdmissionCase"));
  assert.match(create, /rpc\("create_resident_admission_case_with_type"/);
  assert.match(create, /p_treatment_type: form\.treatment_type \|\| null/);
  // edit: one call that carries the Type and returns the final version
  const update = api.slice(api.indexOf("export async function updateAdmissionCase"), api.indexOf("export async function softDeleteAdmissionCase"));
  assert.match(update, /rpc\("update_resident_admission_case_with_type"/);
  assert.match(update, /p_treatment_type: form\.treatment_type \|\| null/);
  assert.match(update, /p_expected_updated_at: expectedUpdatedAt/);
  // the old two-step pieces are gone from the screen and the API
  assert.doesNotMatch(api, /set_resident_case_treatment_type|setAdmissionCaseType/);
  assert.doesNotMatch(ui, /setAdmissionCaseType|CASE_TYPE_SAVE_FAILED/);
  const submit = ui.slice(ui.indexOf("async function submit"), ui.indexOf("return (\n    <form className=\"case-form\""));
  assert.match(submit, /await updateAdmissionCase\(initial\.id, initial\.updated_at, form\);/);
  assert.match(submit, /caseId = await createAdmissionCase\(form\);/);
});

test("the Type migration is additive: new column + new function only, nothing existing is dropped or rewritten", async () => {
  const sql = await read("supabase/migrations/20261004090000_resident_case_treatment_type.sql");
  assert.match(sql, /add column if not exists treatment_type text/);
  assert.match(sql, /check \(treatment_type is null or treatment_type in \('conservative', 'operative'\)\)/);
  assert.match(sql, /create or replace function public\.set_resident_case_treatment_type\(/);
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /private\.resident_can_edit_case\(p_case_id\)/);
  assert.match(sql, /CASE_CONFLICT/);
  assert.match(sql, /revoke all on function public\.set_resident_case_treatment_type\(uuid, text, timestamptz\) from public, anon/);
  assert.match(sql, /grant execute on function public\.set_resident_case_treatment_type\(uuid, text, timestamptz\) to authenticated/);
  assert.doesNotMatch(sql, /drop (function|column|table|policy)/i);
  assert.doesNotMatch(sql, /create or replace function public\.(create|update)_resident_admission_case/);
  assert.doesNotMatch(sql, /alter table[^;]*(drop|alter column status)/i);
});
