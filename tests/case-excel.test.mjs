import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildCaseWorkbook, caseExportFileName, caseExportRange, filterCasesForExport, validateExportRange } from "../src/caseExcel.js";

const FRIDAY = new Date("2026-10-02T03:00:00Z"); // Fri 2 Oct 2026, 10:00 Bangkok
const people = [
  { user_id: "r1", full_name: "Resident A", role: "resident", active: true },
  { user_id: "s1", full_name: "Staff A", role: "staff", active: true },
];
const base = { age_years: 50, sex: "female", management: "", operation: "", status: "admit", owner_id: "r1", created_by: "s1", updated_at: "2026-10-02T02:00:00Z", media_count: 0, deleted_at: null };
const cases = [
  { ...base, id: "a", case_code: "ADM-00010", admit_date: "2026-09-30", unit_name: "Upper GI", diagnosis: "Perforated peptic ulcer", media_count: 2, present_illness: "ปวดท้อง", bp_systolic: 100, bp_diastolic: 60, heart_rate: 120, resp_rate: null, body_temp: 38.5, spo2: null, physical_exam: "Guarding" },
  { ...base, id: "b", case_code: "ADM-00011", admit_date: "2026-10-01", unit_name: "B&E", diagnosis: "Thyroid nodule" },
  { ...base, id: "c", case_code: "ADM-00012", admit_date: "2026-08-15", unit_name: "Upper GI", diagnosis: "Old case" },
  { ...base, id: "d", case_code: "ADM-00013", admit_date: "2026-10-01", unit_name: "HPB", diagnosis: "Deleted", deleted_at: "2026-10-02T00:00:00Z" },
];

test("presets give inclusive ranges in Bangkok time", () => {
  assert.deepEqual(caseExportRange("week", FRIDAY), { from: "2026-09-28", to: "2026-10-04" });
  assert.deepEqual(caseExportRange("month", FRIDAY), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(caseExportRange("last-month", FRIDAY), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(caseExportRange("last-month", new Date("2026-01-10T03:00:00Z")), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(caseExportRange("month", new Date("2028-02-10T03:00:00Z")), { from: "2028-02-01", to: "2028-02-29" });
});

test("ranges are validated with Thai messages", () => {
  assert.equal(validateExportRange("2026-09-01", "2026-09-30"), "");
  assert.match(validateExportRange("", "2026-09-30"), /เลือกวันที่/);
  assert.match(validateExportRange("2026-10-05", "2026-10-01"), /ต้องไม่หลัง/);
  assert.match(validateExportRange("2569-09-01", "2569-09-30"), /พ\.ศ\./);
  assert.match(validateExportRange("2024-01-01", "2026-01-02"), /1 ปี/);
});

test("export keeps live cases inside the range and unit, oldest first", () => {
  const rows = filterCasesForExport(cases, { from: "2026-09-28", to: "2026-10-01", unit: "all" });
  assert.deepEqual(rows.map((row) => row.case_code), ["ADM-00010", "ADM-00011"]);
  assert.deepEqual(filterCasesForExport(cases, { from: "2026-09-28", to: "2026-10-01", unit: "B&E" }).map((row) => row.id), ["b"]);
  assert.deepEqual(filterCasesForExport(cases, { from: "2026-10-01", to: "2026-10-01", unit: "all" }).map((row) => row.id), ["b"]);
});

test("file names are safe and say the range and unit", () => {
  assert.equal(caseExportFileName({ from: "2026-10-01", to: "2026-10-31", unit: "all" }), "Admissions-2026-10-01_to_2026-10-31.xlsx");
  assert.equal(caseExportFileName({ from: "2026-10-01", to: "2026-10-31", unit: "B&E" }), "Admissions-2026-10-01_to_2026-10-31-B-E.xlsx");
});

test("the workbook has a case sheet and a discussion sheet with Thai values", async () => {
  const rows = filterCasesForExport(cases, { from: "2026-09-01", to: "2026-10-31", unit: "all" });
  const notes = [{ case_id: "a", author_id: "s1", body: "ทบทวน operative findings", created_at: "2026-10-02T02:05:00Z" }];
  const workbook = buildCaseWorkbook(ExcelJS, { rows, notes, people });
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.deepEqual(reread.worksheets.map((sheet) => sheet.name), ["รายการเคส", "ข้ออภิปราย"]);
  const sheet = reread.getWorksheet("รายการเคส");
  assert.deepEqual(sheet.getRow(1).values.slice(1), ["รหัสเคส", "วันที่รับ", "อายุ (ปี)", "เพศ", "หน่วย", "Diagnosis", "Present illness", "BP (mmHg)", "HR (/min)", "RR (/min)", "BT (°C)", "SpO2 (%)", "Physical examination", "Management", "Operation", "สถานะ", "Owner", "จำนวนภาพ", "ผู้บันทึก", "แก้ไขล่าสุด"]);
  assert.equal(sheet.rowCount, 1 + rows.length);
  const first = sheet.getRow(2).values.slice(1);
  assert.equal(first[0], "ADM-00010");
  assert.equal(first[3], "หญิง");
  assert.equal(first[6], "ปวดท้อง");
  assert.equal(first[7], "100/60");
  assert.equal(first[8], 120);
  assert.equal(first[9] ?? null, null); // empty cell reads back as undefined
  assert.equal(first[10], 38.5);
  assert.equal(first[12], "Guarding");
  assert.equal(first[15], "Admit");
  assert.equal(first[16], "Resident A");
  assert.equal(first[17], 2);
  assert.equal(first[18], "Staff A");
  assert.equal(sheet.getRow(3).values[5], "B&E");
  const discussion = reread.getWorksheet("ข้ออภิปราย");
  assert.deepEqual(discussion.getRow(2).values.slice(1, 4), ["ADM-00010", "Perforated peptic ulcer", "Staff A"]);
  assert.equal(discussion.getRow(2).values[5], "ทบทวน operative findings");
});

test("notes are fetched in chunks and exceljs loads only on export", async () => {
  const api = await readFile(new URL("../src/residentCasesApi.js", import.meta.url), "utf8");
  const fn = api.slice(api.indexOf("export async function loadCaseNotesForCases"));
  assert.match(fn, /\.in\("case_id", chunk\)/);
  assert.match(fn, /\.is\("deleted_at", null\)/);
  const exporter = await readFile(new URL("../src/caseExcelExport.js", import.meta.url), "utf8");
  assert.match(exporter, /await import\("exceljs"\)/);
});

test("New admissions has an Export Excel dialog with presets and a live count", async () => {
  const ui = await readFile(new URL("../src/features/ResidentCases.jsx", import.meta.url), "utf8");
  assert.match(ui, /Export Excel/);
  for (const label of ["สัปดาห์นี้", "เดือนนี้", "เดือนที่แล้ว", "กำหนดเอง"]) assert.match(ui, new RegExp(label));
  assert.match(ui, /filterCasesForExport\(/);
  assert.match(ui, /validateExportRange\(/);
  assert.match(ui, /exportCasesExcel\(/);
});
