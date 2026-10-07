import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("cases screen validates, blocks double submit, and handles conflicts", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /validateCaseForm\(form, new Date\(\), \{ requireType: !initial \}\)/);
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
  assert.match(ui, /<CaseNotes key=\{`\$\{current\.id\}\|\$\{meetingDate\}`\} caseId=\{current\.id\}/);
  assert.match(ui, /meetingDate=\{meetingDate\}/);
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
  assert.match(ui, /saved\?\.range_from \|\| defaultRange\.from/);
  assert.match(ui, /loadAdmissionCases\(\{ from, to \}\)/);
  assert.match(ui, /conferenceWeekForCase\(initialCase/);
  assert.match(ui, /ไม่พบเคสที่เลือก/);
});

test("header shows the signed-in user's full name next to the role", async () => {
  const shell = await read("src/features/ResidentPlatform.jsx");
  assert.match(shell, /<span className="header-user-name"[^>]*>\{workspace\.user\.name\}<\/span>/);
  assert.match(shell, /title=\{workspace\.user\.name\}/);
  const css = await read("src/resident.css");
  assert.match(css, /\.header-user-name \{[^}]*text-overflow:ellipsis/);
});

test("the case form lets users pick images before saving and previews them", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /เลือกภาพ/);
  assert.match(ui, /type="file"[^>]*multiple/);
  assert.match(ui, /URL\.createObjectURL\(/);
  assert.match(ui, /URL\.revokeObjectURL\(/);
  assert.match(ui, /splitCaseImageFiles\(/);
  assert.match(ui, /uploadCaseImages\(caseId, pending\.map/);
});

test("after saving, the form closes and opens the case so a retry never creates a duplicate case", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /await onSaved\(caseId, failureNotice\)/);
  assert.match(ui, /setDialog\(\{ type: "detail", id: caseId, notice \}\)/);
  assert.match(ui, /dialog\.notice/);
});

test("the case detail has a visible upload button at the top of the images section", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /className="primary-button case-upload-button"/);
  assert.match(ui, /อัปโหลดภาพ/);
  const css = await read("src/resident.css");
  assert.match(css, /\.case-file-input \{[^}]*opacity:0/);
  assert.match(css, /\.case-upload-button:focus-within/);
});

test("the case form, detail view and conference have no clinical history/vitals/examination fields", async () => {
  const form = await read("src/features/ResidentCases.jsx");
  const conference = await read("src/features/ResidentConference.jsx");
  for (const [name, ui] of [["form/detail", form], ["conference", conference]]) {
    assert.doesNotMatch(ui, /Present illness|Vital signs|Physical examination|CASE_VITALS|formatVitals|present_illness|physical_exam/, name);
  }
  assert.match(form, />Diagnosis</);
  assert.match(form, />Management</);
});

test("Admin sees a permanent delete button for each image; uploaders keep the soft delete", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /user\.role === "admin" \?/);
  assert.match(ui, /purgeCaseMedia\(item\.id\)/);
  assert.match(ui, /ลบถาวร/);
  assert.match(ui, /deleteCaseMedia\(item\.id\)/);
  assert.match(ui, /className="danger-button case-media-delete"/);
});
