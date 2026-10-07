import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = () => readFile(new URL("../src/residentCasesApi.js", import.meta.url), "utf8");

test("every write goes through an RPC, never a direct table write", async () => {
  const src = await api();
  for (const rpc of [
    "create_resident_admission_case_with_type", "update_resident_admission_case_with_type", "soft_delete_resident_admission_case",
    "admin_purge_resident_admission_case", "add_resident_case_media", "delete_resident_case_media",
    "add_resident_case_note", "edit_resident_case_note", "delete_resident_case_note", "list_resident_case_people",
  ]) assert.match(src, new RegExp(`"${rpc}"`));
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(\s*[{\[]/);
  assert.doesNotMatch(src, /from\("resident_(admission_cases|case_media|case_notes)"\)\s*\.(insert|update|delete)/);
});

test("expected updated_at is passed through untouched", async () => {
  const src = await api();
  assert.match(src, /p_expected_updated_at: expectedUpdatedAt/);
  assert.doesNotMatch(src, /new Date\(expectedUpdatedAt\)/);
  assert.doesNotMatch(src, /toISOString\(\)/);
});

test("image upload re-encodes, never reuses the file name, and cleans up on failure", async () => {
  const src = await api();
  assert.match(src, /upsert: false/);
  assert.match(src, /canvas\.toBlob\(resolve, "image\/jpeg", CASE_IMAGE_QUALITY\)/);
  assert.match(src, /p_caption: caption \|\| ""/);
  assert.doesNotMatch(src, /file\.name/);
  assert.match(src, /\.remove\(\[path\]\)/);
  assert.match(src, /createSignedUrls\(/);
});

test("list queries exclude soft-deleted rows and have a deterministic order", async () => {
  const src = await api();
  assert.match(src, /\.is\("deleted_at", null\)/);
  assert.match(src, /order\("admit_date", \{ ascending: false \}\)\s*\.order\("case_code", \{ ascending: false \}\)/);
  assert.match(src, /\.order\("created_at", \{ ascending: true \}\)\s*\.order\("id"\)/);
});

test("several images upload one by one and one failure does not stop the rest", async () => {
  const src = await api();
  const fn = src.slice(src.indexOf("export async function uploadCaseImages"));
  assert.match(fn, /for \(const \[index, file\] of files\.entries\(\)\)/);
  assert.match(fn, /await uploadCaseImage\(caseId, file\)/);
  assert.match(fn, /catch \(error\)/);
  assert.match(fn, /failed\.push\(/);
  assert.match(fn, /return \{ uploaded, failed \}/);
});

test("clinical fields are neither sent nor read; update leaves any stored clinical columns untouched", async () => {
  const src = await api();
  assert.doesNotMatch(src, /present_illness|physical_exam|bp_systolic|bp_diastolic|heart_rate|resp_rate|body_temp|spo2/);
  assert.doesNotMatch(src, /p_set_clinical/);
  assert.match(src, /p_owner_id: form\.owner_id/);
});

test("Admin permanent image delete removes the row, then the storage file", async () => {
  const src = await api();
  const fn = src.slice(src.indexOf("export async function purgeCaseMedia"));
  assert.match(fn, /"admin_purge_resident_case_media"/);
  assert.match(fn, /\.remove\(\[path\]\)/);
});
