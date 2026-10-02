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
  assert.match(ui, /loadAdmissionCases\(\{ from: week\.start, to: week\.end \}\)/);
  assert.match(ui, /shiftIsoDate\(weekStart, -7\)/);
  assert.match(ui, /shiftIsoDate\(weekStart, 7\)/);
  assert.match(ui, /seq\.current/);
  assert.match(ui, /<CaseNotes key=\{current\.id\}/);
  assert.match(ui, /initialCase/);
  assert.doesNotMatch(ui, /<header[\s>]/);
});
