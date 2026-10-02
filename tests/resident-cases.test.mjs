import assert from "node:assert/strict";
import test from "node:test";
import {
  CASE_IMAGE_MAX_EDGE,
  canDeleteCase,
  canDeleteMedia,
  canDeleteNote,
  canEditCase,
  canEditNote,
  caseErrorMessage,
  caseImagePath,
  caseSexLabel,
  caseStatusLabel,
  conferenceWeek,
  isCaseConflict,
  scaledSize,
  validateCaseForm,
  validateCaseImageFile,
} from "../src/residentCases.js";

const NOW = new Date("2026-10-02T03:00:00Z"); // 10:00 Friday, Bangkok
const good = {
  admit_date: "2026-10-01",
  age_years: "64",
  sex: "female",
  diagnosis: " Adhesive small bowel obstruction ",
  management: "Non-operative",
  operation: "",
  unit_name: "Upper GI",
  status: "admit",
  owner_id: "11111111-1111-4111-8111-111111111111",
};

test("labels fall back to the raw value", () => {
  assert.equal(caseStatusLabel("pending_update"), "รออัปเดต");
  assert.equal(caseSexLabel("female"), "หญิง");
  assert.equal(caseStatusLabel("weird"), "weird");
});

test("a valid form passes", () => {
  assert.equal(validateCaseForm(good, NOW), "");
});

test("Buddhist-era year is rejected with a Gregorian hint", () => {
  assert.match(validateCaseForm({ ...good, admit_date: "2569-10-01" }, NOW), /ปี ค\.ศ\.[\s\S]*2026/);
});

test("date must be real, recent and not in the future (Bangkok)", () => {
  assert.match(validateCaseForm({ ...good, admit_date: "" }, NOW), /เลือกวันที่รับ/);
  assert.match(validateCaseForm({ ...good, admit_date: "2019-12-31" }, NOW), /2020/);
  assert.match(validateCaseForm({ ...good, admit_date: "2026-10-03" }, NOW), /ไม่เกินวันนี้/);
  assert.equal(validateCaseForm({ ...good, admit_date: "2026-10-02" }, NOW), "");
  // 00:30 Bangkok on the 3rd is still the 2nd in UTC: today means Bangkok today.
  assert.equal(validateCaseForm({ ...good, admit_date: "2026-10-03" }, new Date("2026-10-02T17:30:00Z")), "");
});

test("other fields are validated", () => {
  assert.match(validateCaseForm({ ...good, age_years: "" }, NOW), /อายุ/);
  assert.match(validateCaseForm({ ...good, age_years: "121" }, NOW), /อายุ/);
  assert.match(validateCaseForm({ ...good, age_years: "3.5" }, NOW), /อายุ/);
  assert.match(validateCaseForm({ ...good, sex: "x" }, NOW), /เพศ/);
  assert.match(validateCaseForm({ ...good, diagnosis: "   " }, NOW), /Diagnosis/);
  assert.match(validateCaseForm({ ...good, diagnosis: "a".repeat(181) }, NOW), /180/);
  assert.match(validateCaseForm({ ...good, management: "a".repeat(1001) }, NOW), /1000/);
  assert.match(validateCaseForm({ ...good, operation: "a".repeat(181) }, NOW), /180/);
  assert.match(validateCaseForm({ ...good, unit_name: "ENT" }, NOW), /หน่วย/);
  assert.match(validateCaseForm({ ...good, status: "x" }, NOW), /สถานะ/);
  assert.match(validateCaseForm({ ...good, owner_id: "" }, NOW), /Owner/);
});

test("permission helpers mirror the spec matrix", () => {
  const resA = { id: "a", role: "resident" };
  const resB = { id: "b", role: "resident" };
  const staff = { id: "s", role: "staff" };
  const admin = { id: "m", role: "admin" };
  const row = { created_by: "a", owner_id: "a" };
  const ownedOnly = { created_by: "s", owner_id: "b" };
  assert.equal(canEditCase(resA, row), true);
  assert.equal(canEditCase(resB, row), false);
  assert.equal(canEditCase(resB, ownedOnly), true);
  assert.equal(canEditCase(staff, row), true);
  assert.equal(canEditCase(admin, row), true);
  assert.equal(canEditCase(null, row), false);
  assert.equal(canDeleteCase(resA, row), true);
  assert.equal(canDeleteCase(resB, row), false);
  assert.equal(canDeleteCase(resB, ownedOnly), false);
  assert.equal(canDeleteCase(staff, { created_by: "s" }), false);
  assert.equal(canDeleteCase(admin, row), true);
  assert.equal(canDeleteMedia(resA, { created_by: "a" }), true);
  assert.equal(canDeleteMedia(staff, { created_by: "a" }), false);
  assert.equal(canDeleteMedia(admin, { created_by: "a" }), true);
  assert.equal(canEditNote(admin, { author_id: "a" }), false);
  assert.equal(canEditNote(resA, { author_id: "a" }), true);
  assert.equal(canDeleteNote(admin, { author_id: "a" }), true);
  assert.equal(canDeleteNote(staff, { author_id: "a" }), false);
});

test("conference week is Monday to Friday, weekends map to the week that just ended", () => {
  assert.deepEqual(conferenceWeek("2026-10-02"), { start: "2026-09-28", end: "2026-10-02" }); // Fri
  assert.deepEqual(conferenceWeek("2026-09-28"), { start: "2026-09-28", end: "2026-10-02" }); // Mon
  assert.deepEqual(conferenceWeek("2026-10-03"), { start: "2026-09-28", end: "2026-10-02" }); // Sat
  assert.deepEqual(conferenceWeek("2026-10-04"), { start: "2026-09-28", end: "2026-10-02" }); // Sun
  assert.deepEqual(conferenceWeek("2026-10-05"), { start: "2026-10-05", end: "2026-10-09" }); // Mon
  assert.equal(conferenceWeek("not-a-date"), null);
});

test("image path is inside the case folder and always .jpg", () => {
  const id = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  const file = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.equal(caseImagePath(id, file), `${id.toLowerCase()}/${file}.jpg`);
  assert.throws(() => caseImagePath("../etc", file), /รหัสเคส/);
  assert.throws(() => caseImagePath("", file), /รหัสเคส/);
});

test("image files are checked before upload", () => {
  assert.match(validateCaseImageFile(null), /เลือกภาพ/);
  assert.match(validateCaseImageFile({ type: "application/pdf", size: 10 }), /JPEG, PNG หรือ WebP/);
  assert.match(validateCaseImageFile({ type: "image/png", size: 0 }), /ว่าง/);
  assert.match(validateCaseImageFile({ type: "image/png", size: 21 * 1024 * 1024 }), /20 MB/);
  assert.equal(validateCaseImageFile({ type: "image/webp", size: 3 * 1024 * 1024 }), "");
});

test("scaledSize keeps aspect ratio and never upsizes", () => {
  assert.deepEqual(scaledSize(1000, 500), { width: 1000, height: 500 });
  assert.deepEqual(scaledSize(4000, 3000), { width: CASE_IMAGE_MAX_EDGE, height: 1500 });
  assert.deepEqual(scaledSize(3000, 4000), { width: 1500, height: CASE_IMAGE_MAX_EDGE });
  assert.deepEqual(scaledSize(10000, 1), { width: CASE_IMAGE_MAX_EDGE, height: 1 });
});

test("conflict and permission errors become Thai messages", () => {
  const conflict = new Error("CASE_CONFLICT: this case was changed by someone else");
  assert.equal(isCaseConflict(conflict), true);
  assert.equal(isCaseConflict(new Error("other")), false);
  assert.match(caseErrorMessage(conflict), /มีผู้อื่นแก้เคสนี้/);
  assert.match(caseErrorMessage(new Error("You cannot edit this case")), /ไม่มีสิทธิ์/);
  assert.match(caseErrorMessage(new Error("Case not found")), /ไม่พบเคส/);
  assert.equal(caseErrorMessage(new Error("boom")), "boom");
  assert.equal(caseErrorMessage(null), "ทำรายการไม่สำเร็จ");
});
