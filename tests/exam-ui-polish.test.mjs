import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const page = await read("../src/features/ResidentExams.jsx");
const editor = await read("../src/features/ExamScoreEditor.jsx");
const api = await read("../src/residentApi.js");

test("Excel export is built in the browser and loads exceljs only when the button is pressed", async () => {
  const src = await read("../src/examExcelExport.js");
  assert.match(src, /await import\("exceljs"\)/);
  assert.match(src, /buildExamWorkbook\(ExcelJS, event\)/);
  assert.match(src, /examExportFileName\(event\)/);
  assert.doesNotMatch(src, /^import .*exceljs/m);
});

test("both editors give the Admin an Excel button for the exam on screen", async () => {
  assert.match(page, /import ExamExportButton from "\.\/ExamExportButton"/);
  assert.match(editor, /import ExamExportButton from "\.\/ExamExportButton"/);
  assert.match(page, /<ExamExportButton event=\{event\} \/>/);
  assert.match(editor, /<ExamExportButton event=\{event\} \/>/);
  const button = await read("../src/features/ExamExportButton.jsx");
  assert.match(button, /exportExamExcel\(event\)/);
  assert.match(button, /ส่งออก Excel/);
  assert.match(button, /role="alert"/);
});

test("deleting a Draft goes through one RPC that takes only the event id", () => {
  assert.match(api, /export async function deleteResidentExamDraft\(eventId\)/);
  assert.match(api, /supabase\.rpc\("delete_resident_exam_event", \{ p_event_id: eventId \}\)/);
});

test("both editors offer 'ลบ Draft นี้' only while the exam is a Draft, after a confirmation that names the exam", () => {
  for (const [name, src] of [["ResidentExams", page], ["ExamScoreEditor", editor]]) {
    assert.match(src, /deleteResidentExamDraft/, name);
    assert.match(src, /async function removeDraft\(\)/, name);
    assert.match(src, /window\.confirm\(`ลบ Draft "\$\{event\.title\}"/, name);
    assert.match(src, /event\.status === "draft" && <button type="button" className="danger-button"[^>]*onClick=\{removeDraft\}/, name);
    assert.match(src, /await onDeleted\?\.\(\)/, name);
  }
  assert.match(page, /const afterDelete = async \(\) => \{ setSelectedId\(""\); await onRefresh\(\); \};/);
  assert.equal((page.match(/onDeleted=\{afterDelete\}/g) || []).length, 2);
});

test("the exam picker tells equal drafts apart by the number of Residents", () => {
  assert.match(page, /\$\{event\.participants\.length\} คน/);
});

test("the legacy editor is keyed by exam, so a finished delete cannot leave the next manual exam disabled", () => {
  assert.match(page, /<ExamEditor key=\{selected\.id\} event=\{selected\}/);
});

test("the behaviour script closes the save flag again, so its 'legacy save is blocked' and delete checks really run", async () => {
  const script = await read("./resident-exam-mpl-rollback.sql");
  const resets = script.match(/perform set_config\('app\.exam_mpl_save', '', true\);/g) || [];
  assert.ok(resets.length >= 2, "reset the flag after the first score save and before the delete checks");
});
