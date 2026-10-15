import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { groupExamRecords } from "../src/examScoring.js";
import { buildExamWorkbook, examExportFileName } from "../src/examExcel.js";

const row = (changes) => ({
  event_id: "e1", exam_type: "xray_anatomy", exam_date: "2026-10-15", title: "X-ray & Anatomy", max_score: null, status: "published",
  scoring_mode: "mpl", participant_id: "r1", resident_name: "Resident A", resident_pgy: 1, pgy_at_exam: 1,
  part_id: "p1", part_name: "Anatomy", part_sort_order: 1, part_max_score: 100, score: "70", outcome: "pass", outcome_source: "computed", mpl: "60", ...changes,
});
const mplRecords = [
  row({}),
  row({ part_id: "p2", part_name: "X-ray", part_sort_order: 2, part_max_score: 50, score: "20", outcome: "remediation", mpl: "25" }),
  row({ participant_id: "r2", resident_name: "Resident B", pgy_at_exam: 4, resident_pgy: 4, mpl: null, score: "80", outcome: null }),
  row({ participant_id: "r2", resident_name: "Resident B", pgy_at_exam: 4, resident_pgy: 4, part_id: "p2", part_name: "X-ray", part_sort_order: 2, part_max_score: 50, mpl: "30", score: "45", outcome: "pass" }),
];
const [mplEvent] = groupExamRecords(mplRecords);
const sheetRows = (sheet) => sheet.getSheetValues().slice(1).map((values) => values.slice(1));

test("an MPL exam exports score, full score, MPL and the outcome for every part, plus an overall result", () => {
  const sheet = buildExamWorkbook(ExcelJS, mplEvent).getWorksheet("ผลสอบ");
  const [header, a, b] = sheetRows(sheet);
  assert.deepEqual(header, ["Resident", "PGY ตอนสอบ", "Anatomy คะแนน", "Anatomy เต็ม", "Anatomy MPL", "Anatomy ผล", "X-ray คะแนน", "X-ray เต็ม", "X-ray MPL", "X-ray ผล", "ผลรวม"]);
  assert.deepEqual(a, ["Resident A", 1, 70, 100, 60, "ผ่าน", 20, 50, 25, "ไม่ผ่าน", "ไม่ผ่านอย่างน้อย 1 part"]);
  assert.deepEqual(b, ["Resident B", 4, 80, 100, "", "ยังไม่ตั้งเกณฑ์", 45, 50, 30, "ผ่าน", "ยังไม่ครบ"]);
});

test("the MPL sheet lists the standard used for each part and PGY of this exam", () => {
  const rows = sheetRows(buildExamWorkbook(ExcelJS, mplEvent).getWorksheet("เกณฑ์ MPL"));
  assert.deepEqual(rows[0], ["Part", "PGY", "คะแนนเต็ม", "MPL"]);
  assert.deepEqual(rows.slice(1), [["Anatomy", 1, 100, 60], ["Anatomy", 4, 100, "ยังไม่ตั้งเกณฑ์"], ["X-ray", 1, 50, 25], ["X-ray", 4, 50, 30]]);
});

test("an MCQ exam has one score column, and a manual exam exports only its outcomes", () => {
  const [mcq] = groupExamRecords([
    row({ event_id: "e2", exam_type: "mcq", title: "MCQ", max_score: 100, part_id: null, part_name: null, part_sort_order: null, part_max_score: null, score: "55", mpl: "50" }),
  ]);
  assert.deepEqual(sheetRows(buildExamWorkbook(ExcelJS, mcq).getWorksheet("ผลสอบ"))[1], ["Resident A", 1, 55, 100, 50, "ผ่าน", "ผ่านทุก part"]);
  const [manual] = groupExamRecords([
    row({ event_id: "e3", scoring_mode: "manual", part_max_score: null, score: null, outcome: "remediation", outcome_source: "manual", mpl: null, pgy_at_exam: null }),
  ]);
  const workbook = buildExamWorkbook(ExcelJS, manual);
  assert.deepEqual(sheetRows(workbook.getWorksheet("ผลสอบ")).slice(0, 2), [["Resident", "PGY ตอนสอบ", "Anatomy ผล", "ผลรวม"], ["Resident A", 1, "ต้องซ่อม", "ไม่ผ่านอย่างน้อย 1 part"]]);
  assert.equal(workbook.getWorksheet("เกณฑ์ MPL"), undefined);
});

test("values that look like formulas stay text, and the file name carries the exam date and type", () => {
  const [evil] = groupExamRecords([row({ resident_name: "=1+1" })]);
  const cell = buildExamWorkbook(ExcelJS, evil).getWorksheet("ผลสอบ").getCell("A2");
  assert.equal(cell.type, ExcelJS.ValueType.String);
  assert.equal(examExportFileName(mplEvent), "ExamResults-2026-10-15-xray_anatomy-e1.xlsx");
  assert.equal(examExportFileName({ ...mplEvent, id: "ab12CD34-ef56-7890-abcd-ef1234567890" }), "ExamResults-2026-10-15-xray_anatomy-ab12cd34.xlsx");
});

test("an information sheet says which exam the file is, so two exams of the same day are told apart", () => {
  const rows = sheetRows(buildExamWorkbook(ExcelJS, mplEvent).getWorksheet("ข้อมูลรายการ"));
  assert.deepEqual(rows, [["ชื่อข้อสอบ", "X-ray & Anatomy"], ["ประเภท", "X-ray & Anatomy"], ["วันที่สอบ", "2026-10-15"], ["สถานะ", "เผยแพร่แล้ว"], ["โหมดคะแนน", "MPL (คำนวณผ่าน/ไม่ผ่านอัตโนมัติ)"], ["จำนวนผู้สอบ", 2]]);
  const [evil] = groupExamRecords([row({ title: "=HYPERLINK(\"x\")" })]);
  assert.equal(buildExamWorkbook(ExcelJS, evil).getWorksheet("ข้อมูลรายการ").getCell("B1").type, ExcelJS.ValueType.String);
  assert.equal(buildExamWorkbook(ExcelJS, mplEvent).worksheets[0].name, "ผลสอบ");
});
