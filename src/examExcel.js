// Excel export of one exam's results. Pure workbook building (tested in Node with
// exceljs); the browser download lives in examExcelExport.js.
import { outcomeLabel, participantOutcome, resultKey } from "./examScoring.js";

const OVERALL = { pass: "ผ่านทุก part", fail: "ไม่ผ่านอย่างน้อย 1 part", pending: "ยังไม่ครบ" };
const NO_MPL = "ยังไม่ตั้งเกณฑ์";
const number = (value) => (value === null || value === undefined || value === "" ? "" : Number(value));

// The first 8 hex digits of the exam id keep two exams of the same day and type apart.
export function examExportFileName(event) {
  const shortId = String(event.id || "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 8);
  return `ExamResults-${event.date}-${event.type}${shortId ? `-${shortId}` : ""}.xlsx`;
}

function styleSheet(sheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF155426" } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
  sheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
}

export function buildExamWorkbook(ExcelJS, event) {
  const computed = event.scoringMode === "mpl";
  const parts = event.type === "mcq" ? [{ id: null, name: "MCQ", maxScore: event.maxScore }] : event.parts;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Resident Surgery Assessment";

  const sheet = workbook.addWorksheet("ผลสอบ", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  const header = ["Resident", "PGY ตอนสอบ"];
  parts.forEach((part) => {
    if (computed) header.push(`${part.name} คะแนน`, `${part.name} เต็ม`, `${part.name} MPL`, `${part.name} ผล`);
    else if (event.type === "mcq") header.push(`${part.name} คะแนน`, `${part.name} เต็ม`, `${part.name} ผล`);
    else header.push(`${part.name} ผล`);
  });
  header.push("ผลรวม");
  sheet.addRow(header);
  event.participants.forEach((participant) => {
    const line = [participant.name, participant.pgy ?? ""];
    parts.forEach((part) => {
      const key = resultKey(participant.id, part.id);
      const result = event.results.get(key);
      const label = result ? outcomeLabel(result.outcome, computed ? "computed" : "manual") : "";
      if (computed) line.push(number(result?.score), number(part.maxScore), number(event.mpls.get(key)), label);
      else if (event.type === "mcq") line.push(number(result?.score), number(part.maxScore), label);
      else line.push(label);
    });
    line.push(OVERALL[participantOutcome(event, participant)]);
    sheet.addRow(line);
  });

  const sheets = [sheet];
  if (computed) {
    const standards = workbook.addWorksheet("เกณฑ์ MPL", { views: [{ state: "frozen", ySplit: 1 }] });
    standards.addRow(["Part", "PGY", "คะแนนเต็ม", "MPL"]);
    const levels = [...new Set(event.participants.map((participant) => participant.pgy).filter(Boolean))].sort((a, b) => a - b);
    parts.forEach((part) => levels.forEach((pgy) => {
      const holder = event.participants.find((participant) => participant.pgy === pgy && event.mpls.has(resultKey(participant.id, part.id)));
      standards.addRow([part.name, pgy, number(part.maxScore), holder ? Number(event.mpls.get(resultKey(holder.id, part.id))) : NO_MPL]);
    }));
    sheets.push(standards);
  }
  const info = workbook.addWorksheet("ข้อมูลรายการ");
  info.columns = [{ width: 18 }, { width: 46 }];
  info.addRows([
    ["ชื่อข้อสอบ", event.title],
    ["ประเภท", event.type === "mcq" ? "MCQ" : "X-ray & Anatomy"],
    ["วันที่สอบ", event.date],
    ["สถานะ", event.status === "published" ? "เผยแพร่แล้ว" : "Draft"],
    ["โหมดคะแนน", computed ? "MPL (คำนวณผ่าน/ไม่ผ่านอัตโนมัติ)" : "กรอกผลเอง"],
    ["จำนวนผู้สอบ", event.participants.length],
  ]);
  info.getColumn(1).font = { bold: true };
  sheets.forEach(styleSheet);
  return workbook;
}
