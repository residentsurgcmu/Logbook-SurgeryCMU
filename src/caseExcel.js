// Excel export of admission cases. Pure helpers + workbook building (tested in
// Node with exceljs); the browser download lives in caseExcelExport.js.
import { caseSexLabel, caseStatusLabel } from "./residentCases.js";
import { bangkokIsoDate, shiftIsoDate } from "./roundSchedule.js";

const nameOf = (people, id) => people.find((person) => person.user_id === id)?.full_name || "ไม่ทราบชื่อ";
const bangkokDateTime = (value) =>
  value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "";
const isoDay = (year, month, day) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const MAX_RANGE_DAYS = 366;

export function caseExportRange(preset, at = new Date()) {
  const today = bangkokIsoDate(at);
  const [year, month] = today.split("-").map(Number);
  if (preset === "week") {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay();
    const monday = shiftIsoDate(today, day === 0 ? -6 : 1 - day);
    return { from: monday, to: shiftIsoDate(monday, 6) };
  }
  if (preset === "last-month") {
    const lastYear = month === 1 ? year - 1 : year;
    const lastMonth = month === 1 ? 12 : month - 1;
    return { from: isoDay(lastYear, lastMonth, 1), to: isoDay(lastYear, lastMonth + 1, 0) };
  }
  return { from: isoDay(year, month, 1), to: isoDay(year, month + 1, 0) };
}

export function validateExportRange(from, to) {
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  if (!valid(from) || !valid(to)) return "กรุณาเลือกวันที่เริ่มและวันที่สิ้นสุด";
  if (Number(from.slice(0, 4)) > 2400 || Number(to.slice(0, 4)) > 2400) return "ปีที่ใส่น่าจะเป็นปี พ.ศ. กรุณาใช้ปี ค.ศ.";
  if (from > to) return "วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด";
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (days > MAX_RANGE_DAYS) return "ช่วงเวลาต้องไม่เกิน 1 ปี";
  return "";
}

export function filterCasesForExport(cases, { from, to, unit = "all" }) {
  return cases
    .filter((row) => !row.deleted_at && row.admit_date >= from && row.admit_date <= to && (unit === "all" || row.unit_name === unit))
    .sort((a, b) => a.admit_date.localeCompare(b.admit_date) || a.case_code.localeCompare(b.case_code));
}

export function caseExportFileName({ from, to, unit = "all" }) {
  const unitPart = unit && unit !== "all" ? `-${String(unit).replace(/[^A-Za-z0-9ก-๙_-]+/g, "-").replace(/^-|-$/g, "")}` : "";
  return `Admissions-${from}_to_${to}${unitPart}.xlsx`;
}

function styleSheet(sheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF155426" } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
  sheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
}

export function buildCaseWorkbook(ExcelJS, { rows, notes = [], people = [] }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Resident Surgery Assessment";
  const list = workbook.addWorksheet("รายการเคส", { views: [{ state: "frozen", ySplit: 1 }] });
  list.columns = [
    ["รหัสเคส", "code", 13], ["วันที่รับ", "admit", 12], ["อายุ (ปี)", "age", 9], ["เพศ", "sex", 9], ["หน่วย", "unit", 14],
    ["Diagnosis", "dx", 34], ["Management", "management", 38], ["Operation", "operation", 28], ["สถานะ", "status", 12],
    ["Owner", "owner", 24], ["จำนวนภาพ", "media", 10], ["ผู้บันทึก", "creator", 24], ["แก้ไขล่าสุด", "updated", 18],
  ].map(([header, key, width]) => ({ header, key, width }));
  rows.forEach((row) => list.addRow({
    code: row.case_code, admit: row.admit_date, age: row.age_years, sex: caseSexLabel(row.sex), unit: row.unit_name,
    dx: row.diagnosis, management: row.management || "", operation: row.operation || "", status: caseStatusLabel(row.status),
    owner: nameOf(people, row.owner_id), media: row.media_count || 0, creator: nameOf(people, row.created_by), updated: bangkokDateTime(row.updated_at),
  }));
  const discussion = workbook.addWorksheet("ข้ออภิปราย", { views: [{ state: "frozen", ySplit: 1 }] });
  discussion.columns = [["รหัสเคส", "code", 13], ["Diagnosis", "dx", 34], ["ผู้เขียน", "author", 24], ["เวลา", "time", 18], ["ข้อความ", "body", 70]]
    .map(([header, key, width]) => ({ header, key, width }));
  const order = new Map(rows.map((row, index) => [row.id, index]));
  notes
    .filter((note) => order.has(note.case_id))
    .sort((a, b) => order.get(a.case_id) - order.get(b.case_id) || String(a.created_at).localeCompare(String(b.created_at)))
    .forEach((note) => {
      const row = rows[order.get(note.case_id)];
      discussion.addRow({ code: row.case_code, dx: row.diagnosis, author: nameOf(people, note.author_id), time: bangkokDateTime(note.created_at), body: note.body });
    });
  [list, discussion].forEach(styleSheet);
  return workbook;
}
