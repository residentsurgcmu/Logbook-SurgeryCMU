import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("cases screen validates, blocks double submit, and handles conflicts", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /validateCaseForm\(form\)/);
  assert.match(ui, /if \(busy\) return;/);
  assert.match(ui, /disabled=\{busy\}/);
  assert.match(ui, /isCaseConflict\(/);
  assert.match(ui, /โหลดข้อมูลล่าสุด/);
  assert.match(ui, /updateAdmissionCase\(initial\.id, initial\.updated_at, form\)/);
  assert.match(ui, /softDeleteAdmissionCase\(row\.id, row\.updated_at\)/);
});

test("cases screen gates actions with the permission helpers and warns about PHI", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /canEditCase\(user, /);
  assert.match(ui, /canDeleteCase\(user, row\)/);
  assert.match(ui, /canDeleteMedia\(user, /);
  assert.match(ui, /user\.role === "admin"/);
  assert.match(ui, /<PrivacyNotice \/>/);
  const parts = await read("src/features/CaseParts.jsx");
  assert.match(parts, /ห้ามใส่ชื่อ-นามสกุล, HN/);
});

test("no patient identifier inputs exist", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.doesNotMatch(ui, /name="(hn|patient_name|patient)"|label>\s*(HN|ชื่อผู้ป่วย)/i);
});

test("modal does not use a header element (resident-app header is styled green)", async () => {
  const parts = await read("src/features/CaseParts.jsx");
  assert.doesNotMatch(parts, /<header[\s>]/);
  assert.match(parts, /Escape/);
});

test("notes use the append-only RPC helpers and reload after each action", async () => {
  const parts = await read("src/features/CaseParts.jsx");
  assert.match(parts, /addCaseNote\(caseId, /);
  assert.match(parts, /editCaseNote\(/);
  assert.match(parts, /deleteCaseNote\(/);
  assert.match(parts, /canEditNote\(user, /);
  assert.match(parts, /canDeleteNote\(user, /);
  assert.match(parts, /seq\.current/);
});

test("conference loads one Mon-Fri week, guards stale loads, and shows notes per case", async () => {
  const ui = await read("src/features/ResidentConference.jsx");
  assert.match(ui, /conferenceWeek\(/);
  assert.match(ui, /shiftIsoDate\(weekStart, -7\)/);
  assert.match(ui, /shiftIsoDate\(weekStart, 7\)/);
  assert.match(ui, /seq\.current/);
  assert.match(ui, /<CaseNotes key=\{current\.id\}/);
  assert.match(ui, /initialCase/);
  assert.doesNotMatch(ui, /<header[\s>]/);
});

test("both new tabs are wired for every role and present-case jumps to the conference", async () => {
  const shell = await read("src/features/ResidentPlatform.jsx");
  assert.match(shell, /import ResidentCases from "\.\/ResidentCases"/);
  assert.match(shell, /import ResidentConference from "\.\/ResidentConference"/);
  assert.match(shell, /nav\.push\(\["cases", "New admissions"\], \["conference", "ประชุมวันศุกร์"\]\)/);
  assert.match(shell, /cases: "New admissions"/);
  assert.match(shell, /conference: "ประชุมวันศุกร์"/);
  assert.match(shell, /tab === "cases"/);
  assert.match(shell, /tab === "conference"/);
  assert.match(shell, /setPresentCase\(/);
  // Not role-gated: the push sits at function level (2-space indent) right after
  // the gated attendance push, not as that `if`'s body (4-space indent).
  assert.match(shell, /\]\);\n  nav\.push\(\["cases", "New admissions"\]/);
});

test("case form lets validateCaseForm show Thai messages instead of native browser validation", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /<form className="case-form" noValidate onSubmit=\{submit\}>/);
});

test("admin can list soft-deleted cases (to purge them) and deleted rows are read-only", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /includeDeleted: user\.role === "admin" && showDeleted/);
  assert.match(ui, /แสดงเคสที่ถูกลบ/);
  assert.match(ui, /!row\.deleted_at/);
  const api = await read("src/residentCasesApi.js");
  assert.match(api, /if \(!includeDeleted\) query = query\.is\("deleted_at", null\)/);
  assert.match(api, /CASE_COLUMNS = "[^"]*deleted_at/);
});

test("conference includes weekend admissions and never silently shows the wrong case", async () => {
  const ui = await read("src/features/ResidentConference.jsx");
  assert.match(ui, /conferenceWindow\(week\.start\)/);
  assert.match(ui, /loadAdmissionCases\(\{ from: range\.from, to: range\.to \}\)/);
  assert.match(ui, /conferenceWeekForCase\(initialCase/);
  assert.match(ui, /ไม่พบเคสที่เลือก/);
});
