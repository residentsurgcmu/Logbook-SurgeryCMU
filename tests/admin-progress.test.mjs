import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { buildAdminProgressWorkbook } from "../src/adminProgressExcel.js";
import { adminAttemptError, bangkokProgressTime, EPA_CODES, PBA_CODES, PROGRESS_WARNING, progressFileName, progressResidents } from "../src/adminProgress.js";

const at = new Date("2026-10-07T18:30:00Z"); // 8 October in Bangkok.
const residents = [1, 2, 3].map((i) => ({ id: `fake-resident-${i}`, name: `Resident สมมติ ${i}`, pgy: i }));
function fixture() {
  return residents.flatMap((resident) => [...EPA_CODES, ...PBA_CODES].map((code) => ({
    resident_id: resident.id, resident_name: resident.name, resident_pgy: resident.pgy,
    template_id: `fake-${code}`, template_code: code, template_type: code.startsWith("EPA") ? "EPA" : "PBA",
    template_title: "แบบประเมินสมมติ", counts_for_board: code !== "EPA-8", attempts_used: 0,
    attempts_cap: code.startsWith("PBA") || code === "EPA-8" ? null : 3,
    attempts_this_year: 0, met: false, done: false, attempts_completed: 0, completed_this_year: 0, has_pending: false,
    // Deliberately unexpected private fields must never reach any cell.
    staff_name: "Staff สมมติ ลับ", scores: "PRIVATE_SCORE_SENTINEL", request_text: "PRIVATE_REQUEST_SENTINEL",
    email: "fake-contact@example.invalid", phone: "PRIVATE_PHONE_SENTINEL",
  })));
}
function workbook() {
  const rows = fixture();
  const form = (id, code) => rows.find((row) => row.resident_id === id && row.template_code === code);
  Object.assign(form(residents[0].id, "EPA-1"), { attempts_used: 2, attempts_this_year: 1, met: true });
  Object.assign(form(residents[1].id, "EPA-1"), { attempts_used: 3, attempts_cap: 4, has_pending: true });
  Object.assign(form(residents[0].id, "EPA-8"), { attempts_used: 1, met: true });
  Object.assign(form(residents[0].id, "PBA-01"), { attempts_used: 3, done: true, attempts_completed: 2, completed_this_year: 2, has_pending: true });
  Object.assign(form(residents[0].id, "PBA-02"), { attempts_used: 1, attempts_this_year: 1, has_pending: true });
  Object.assign(form(residents[1].id, "PBA-03"), { attempts_used: 1, done: true, attempts_completed: 1, completed_this_year: 0 });
  return buildAdminProgressWorkbook(ExcelJS, { rows, generatedAt: at });
}

test("workbook has ordered Thai sheets, all forms, frozen name/header, fixed widths", () => {
  const book = workbook();
  assert.deepEqual(book.worksheets.map((sheet) => sheet.name), ["อ่านก่อน", "EPA", "PBA"]);
  const epa = book.getWorksheet("EPA");
  const pba = book.getWorksheet("PBA");
  assert.equal(epa.rowCount, 4); assert.equal(pba.rowCount, 4);
  assert.deepEqual(epa.getRow(1).values.slice(1, 3), ["ชื่อ Resident", "PGY"]);
  assert.deepEqual(EPA_CODES.map((_, i) => epa.getRow(1).getCell(3 + i * 3).value), EPA_CODES.map((code) => `${code}${code === "EPA-8" ? " (ไม่นับในเกณฑ์สอบบอร์ด)" : ""} ใช้แล้ว/เพดาน`));
  assert.equal(epa.getRow(1).getCell(30).value, "EPA ถึงเกณฑ์ x/8");
  assert.deepEqual(pba.getRow(1).values.slice(3, 6), ["ทำแล้ว n เรื่อง (เป้า 16)", "ปีนี้ n เรื่อง (เป้าปีละ 4)", "รอประเมิน k"]);
  assert.deepEqual(pba.getRow(1).values.slice(6), PBA_CODES);
  for (const sheet of book.worksheets) {
    assert.equal(sheet.views[0].xSplit, 1); assert.equal(sheet.views[0].ySplit, 1);
    assert.ok(sheet.columns.every((column) => column.width > 0));
  }
});

test("EPA displays 2/3, extra cap, pending, unlimited and excludes EPA-8 from x/8", () => {
  const epa = workbook().getWorksheet("EPA");
  assert.equal(epa.getRow(2).getCell("EPA-1_used").value, "2/3");
  assert.equal(epa.getRow(2).getCell("EPA-1_year").value, 1);
  assert.equal(epa.getRow(2).getCell("EPA-1_met").value, "ใช่");
  assert.equal(epa.getRow(2).getCell("EPA-8_used").value, "1/ไม่จำกัด");
  assert.equal(epa.getRow(2).getCell("summary").value, "1/8");
  assert.equal(epa.getRow(3).getCell("EPA-1_used").value, "3/4 · รอประเมิน");
  assert.equal(epa.getRow(3).getCell("EPA-1_met").value, "ไม่ใช่");
  assert.equal(epa.getRow(4).getCell("summary").value, "0/8");
});

test("PBA counts finished forms, sums completed_this_year, counts waiting and renders ✓ / … / empty", () => {
  const pba = workbook().getWorksheet("PBA");
  assert.equal(pba.getRow(2).getCell("done").value, 1);
  assert.equal(pba.getRow(2).getCell("year").value, 2);
  assert.equal(pba.getRow(2).getCell("pending").value, 2);
  assert.equal(pba.getRow(2).getCell("PBA-01").value, "✓");
  assert.equal(pba.getRow(2).getCell("PBA-02").value, "…");
  assert.equal(pba.getRow(2).getCell("PBA-03").value, "");
  assert.equal(pba.getRow(3).getCell("done").value, 1);
  assert.equal(pba.getRow(3).getCell("year").value, 0);
  assert.equal(pba.getRow(4).getCell("done").value, 0);
});

test("serialized Excel round trip contains definitions and no private fields or formulas", async () => {
  const book = workbook();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(await book.xlsx.writeBuffer());
  const cells = [];
  for (const sheet of restored.worksheets) sheet.eachRow((row) => row.eachCell((cell) => {
    assert.notEqual(cell.type, ExcelJS.ValueType.Formula);
    cells.push(String(cell.value));
  }));
  const text = cells.join("\n");
  assert.ok(text.includes(PROGRESS_WARNING));
  assert.match(text, /ผลประเมินเสร็จ/); assert.match(text, /completed_this_year/); assert.match(text, /หนึ่งคำขอ/);
  assert.doesNotMatch(text, /PRIVATE_|Staff สมมติ ลับ|fake-contact@|staff_name|request_text|scores|phone|email/);
  assert.equal(restored.getWorksheet("PBA").getRow(2).getCell(6).value, "✓");
});

test("Bangkok dates use Buddhist display and Gregorian download filename across UTC midnight", () => {
  assert.match(bangkokProgressTime(at), /2569/);
  assert.match(bangkokProgressTime(at), /8/);
  assert.equal(progressFileName(at), "Resident_Corner_progress_2026-10-08.xlsx");
  assert.equal(progressFileName(new Date("2026-12-31T18:00:00Z")), "Resident_Corner_progress_2027-01-01.xlsx");
});

test("empty and missing forms stay blank without invented progress", () => {
  assert.deepEqual(progressResidents([]), []);
  const book = buildAdminProgressWorkbook(ExcelJS, { rows: [], generatedAt: at });
  assert.equal(book.getWorksheet("EPA").rowCount, 1);
  assert.equal(book.getWorksheet("PBA").rowCount, 1);
  const subset = buildAdminProgressWorkbook(ExcelJS, { rows: fixture().slice(0, 1), generatedAt: at });
  assert.equal(subset.getWorksheet("EPA").getRow(2).getCell("EPA-8_used").value, null);
});

test("Thai error mapping covers four database errors and hides unknown backend details", () => {
  for (const [message, expected] of [
    ["Active Admin account required", "ไม่มีสิทธิ์ใช้หน้านี้"],
    ["A reason of 5-500 characters is required", "กรุณาระบุเหตุผล 5–500 ตัวอักษร"],
    ["Resident is inactive or unavailable", "Resident นี้ไม่ได้ใช้งานหรือไม่พบในระบบ กรุณาโหลดข้อมูลใหม่"],
    ["This form has no attempt limit to extend", "แบบประเมินนี้ไม่จำกัดจำนวนครั้ง จึงไม่ต้องเพิ่มครั้ง"],
  ]) { assert.equal(adminAttemptError({ message }), expected); assert.equal(adminAttemptError(message), expected); }
  assert.doesNotMatch(adminAttemptError({ message: "SQL internal secret" }), /SQL|secret/);
});

test("admin-only integration and pre-mount gate; existing API behavior is extended only", async () => {
  const platform = await readFile(new URL("../src/features/ResidentPlatform.jsx", import.meta.url), "utf8");
  const panels = await readFile(new URL("../src/features/AdminAttemptPages.jsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../src/residentApi.js", import.meta.url), "utf8");
  assert.match(platform, /workspace\.user\.role === "admin" && <AdminAttemptPages workspace=\{workspace\}/);
  assert.match(panels, /if \(workspace\.user\.role !== "admin"\) return null;\s*return <AdminAttemptContent/);
  assert.match(panels, /ย้อนกลับจากหน้านี้ไม่ได้ \(ถ้าเพิ่มผิด ให้แจ้งผู้พัฒนา\)/);
  for (const rpc of ["admin_list_epa_pba_progress", "admin_list_attempt_grants", "admin_grant_resident_extra_attempt"]) assert.match(api, new RegExp(`supabase\\.rpc\\("${rpc}"`));
  assert.match(api, /p_resident_id: residentId, p_template_id: templateId, p_reason: reason/);
  const exporter = await readFile(new URL("../src/adminProgressExcelExport.js", import.meta.url), "utf8");
  assert.match(exporter, /await import\("exceljs"\)/);
});
