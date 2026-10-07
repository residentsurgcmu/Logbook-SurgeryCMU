import assert from "node:assert/strict";
import test from "node:test";
import {
  CASE_IMAGE_MAX_EDGE,
  CASE_UNITS,
  splitCaseImageFiles,
  canDeleteCase,
  canDeleteMedia,
  canDeleteNote,
  canEditCase,
  canEditNote,
  caseErrorMessage,
  caseImagePath,
  caseSexLabel,
  caseTypeLabel,
  CASE_TYPES,
  conferenceWeek,
  conferenceWeekForCase,
  conferenceWindow,
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
  assert.equal(caseTypeLabel("operative"), "Operative");
  assert.equal(caseTypeLabel("conservative"), "Conservative");
  assert.equal(caseTypeLabel(null), "ยังไม่ระบุ");
  assert.equal(caseSexLabel("female"), "หญิง");
  assert.equal(caseTypeLabel("weird"), "weird");
});

test("Type is optional, limited to Conservative/Operative, and the old status is no longer validated", () => {
  assert.deepEqual(CASE_TYPES.map(([key]) => key), ["conservative", "operative"]);
  assert.equal(validateCaseForm({ ...good, treatment_type: "" }, NOW), "");
  assert.equal(validateCaseForm({ ...good, treatment_type: "operative" }, NOW), "");
  assert.equal(validateCaseForm({ ...good, treatment_type: "conservative", status: "anything-hidden" }, NOW), "");
});

test("Type can be demanded for new cases only; edits of old cases without a Type stay allowed", () => {
  assert.match(validateCaseForm({ ...good, treatment_type: "" }, NOW, { requireType: true }), /Type/);
  assert.match(validateCaseForm({ ...good }, NOW, { requireType: true }), /Type/);
  assert.equal(validateCaseForm({ ...good, treatment_type: "operative" }, NOW, { requireType: true }), "");
  assert.equal(validateCaseForm({ ...good, treatment_type: "" }, NOW, { requireType: false }), "");
  assert.equal(validateCaseForm({ ...good, treatment_type: "" }, NOW), "");
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
  assert.match(validateCaseForm({ ...good, treatment_type: "x" }, NOW), /Type/);
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

test("conference window starts on the Saturday after the previous Friday conference", () => {
  assert.deepEqual(conferenceWindow("2026-09-28"), { from: "2026-09-26", to: "2026-10-02" });
});

test("a weekend admission belongs to the following week's conference", () => {
  assert.deepEqual(conferenceWeekForCase("2026-10-03"), { start: "2026-10-05", end: "2026-10-09" }); // Sat
  assert.deepEqual(conferenceWeekForCase("2026-10-04"), { start: "2026-10-05", end: "2026-10-09" }); // Sun
  assert.deepEqual(conferenceWeekForCase("2026-10-02"), { start: "2026-09-28", end: "2026-10-02" }); // Fri
  assert.deepEqual(conferenceWeekForCase("2026-09-28"), { start: "2026-09-28", end: "2026-10-02" }); // Mon
  assert.equal(conferenceWeekForCase("bad"), null);
  // Every admission date falls inside the window of the week it is assigned to.
  for (let d = 0; d < 14; d += 1) {
    const iso = new Date(Date.UTC(2026, 8, 28 + d)).toISOString().slice(0, 10);
    const { start } = conferenceWeekForCase(iso);
    const { from, to } = conferenceWindow(start);
    assert.ok(iso >= from && iso <= to, `${iso} outside ${from}..${to}`);
  }
});

test("deleted cases are read-only for everyone", () => {
  const deleted = { created_by: "a", owner_id: "a", deleted_at: "2026-10-02T00:00:00Z" };
  assert.equal(canEditCase({ id: "m", role: "admin" }, deleted), false);
  assert.equal(canEditCase({ id: "s", role: "staff" }, deleted), false);
  assert.equal(canDeleteCase({ id: "m", role: "admin" }, deleted), false);
  assert.equal(canDeleteCase({ id: "a", role: "resident" }, deleted), false);
});

test("a deactivated-owner error is shown in Thai", () => {
  assert.match(caseErrorMessage(new Error("Owner must be an active Resident")), /ต้องเป็น Resident/);
});

test("units are the department units: five original ones plus Trauma", () => {
  assert.deepEqual(CASE_UNITS, ["Upper GI", "Colorectal", "HPB", "B&E", "Vascular", "Trauma"]);
  assert.equal(validateCaseForm({ ...good, unit_name: "Trauma", treatment_type: "operative" }, NOW, { requireType: true }), "");
  assert.match(validateCaseForm({ ...good, unit_name: "General surgery" }, NOW), /หน่วย/);
  assert.match(validateCaseForm({ ...good, unit_name: "General surgery" }, NOW), /หน่วย/);
  assert.equal(validateCaseForm({ ...good, unit_name: "B&E" }, NOW), "");
});

test("picked images are split into accepted and rejected with Thai reasons by position", () => {
  const ok = { type: "image/jpeg", size: 1000 };
  const pdf = { type: "application/pdf", size: 10 };
  const empty = { type: "image/png", size: 0 };
  const { accepted, rejected } = splitCaseImageFiles([ok, pdf, ok, empty]);
  assert.equal(accepted.length, 2);
  assert.deepEqual(rejected.map((item) => item.position), [2, 4]);
  assert.match(rejected[0].message, /ภาพที่ 2: รองรับเฉพาะภาพ/);
  assert.match(rejected[1].message, /ภาพที่ 4: ไฟล์ภาพว่าง/);
});

test("no more than 10 images can wait to be uploaded at once", () => {
  const ok = { type: "image/png", size: 10 };
  const { accepted, rejected } = splitCaseImageFiles(Array(4).fill(ok), 8);
  assert.equal(accepted.length, 2);
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].message, /ไม่เกิน 10 ภาพ/);
  assert.deepEqual(splitCaseImageFiles(null), { accepted: [], rejected: [] });
});

test("clinical detail (present illness, vital signs, physical examination) is not part of an admission case", async () => {
  const helpers = await import("../src/residentCases.js");
  assert.equal(helpers.CASE_VITALS, undefined);
  assert.equal(helpers.formatVitals, undefined);
  assert.equal(helpers.CASE_LIMITS.presentIllness, undefined);
  assert.equal(helpers.CASE_LIMITS.physicalExam, undefined);
  // Stray values in a form are ignored, never validated or kept.
  assert.equal(validateCaseForm({ ...good, heart_rate: "999", present_illness: "x".repeat(5000) }, NOW), "");
});
