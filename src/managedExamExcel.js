// Project workbook code uses the existing ExcelJS dependency. No network or mutations.
import { inspectManagedXlsx, XLSX_LIMITS } from "./managedExamZip.js";
import { managedCellLabel, OVERALL_LABELS } from "./managedExams.js";
export const SHEETS = ["คะแนน", "ส่วนสอบและเกณฑ์", "ข้อมูลรายการ"];
const META = ["template_version", "exam_id", "revision_id", "version", "academic_year", "exam_date", "exam_type", "title"];
const CRITERIA = ["part_id", "column_key", "ชื่อส่วนสอบ", "ลำดับ", "คะแนนเต็ม", "MPL PGY1", "MPL PGY2", "MPL PGY3", "MPL PGY4", "คอลัมน์คะแนน", "คอลัมน์สถานะ"];
const columns = (parts) => ["รหัสผู้สอบ", "ชื่ออ้างอิง", "PGY ณ วันสอบ", ...parts.flatMap((p) => [`${p.name} · คะแนน`, `${p.name} · สถานะ`])];
const empty = (x) => x === null || x === undefined || x === "";
function problem(message, ref = "") { throw new Error(`${ref ? `${ref}: ` : ""}${message}`); }
function cellValue(cell) {
  const value = cell.value;
  if (value !== null && value !== undefined && !["string", "number"].includes(typeof value)) problem("รับเฉพาะข้อความหรือตัวเลข ไม่รับสูตร ลิงก์ หรือชนิดข้อมูลนี้", cell.address);
  return value ?? null;
}
function same(a, b, ref) { if ((empty(a) ? null : a) !== (empty(b) ? null : b)) problem("ข้อมูลแม่แบบไม่ตรงกับฉบับปัจจุบัน กรุณาดาวน์โหลดใหม่", ref); }
function style(sheet, widths) {
  sheet.columns = widths.map((width) => ({ width }));
  sheet.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF155426" } };
  sheet.eachRow((row) => { row.font = { ...row.font, name: "Tahoma", size: 11 }; row.alignment = { vertical: "top", wrapText: true }; });
}
export function buildManagedTemplate(ExcelJS, snapshot) {
  if (!snapshot.importable || snapshot.exam.state !== "working") problem("ดาวน์โหลดแม่แบบได้เฉพาะฉบับร่าง");
  for (const p of snapshot.parts) for (const r of snapshot.roster) if (!Number.isFinite(p.max_score) || !Number.isFinite(p.mpl[String(r.pgy_at_exam)])) problem("กรุณาตั้งคะแนนเต็มและ MPL ให้ครบก่อนดาวน์โหลดแม่แบบ");
  const book = new ExcelJS.Workbook(); book.creator = "Resident Corner";
  const scores = book.addWorksheet(SHEETS[0]); scores.addRow(columns(snapshot.parts));
  const byKey = new Map(snapshot.cells.map((c) => [`${c.resident_id}/${c.part_id}`, c]));
  snapshot.roster.forEach((r) => {
    scores.addRow([r.resident_id, r.reference_name, r.pgy_at_exam, ...snapshot.parts.flatMap((p) => {
      const c = byKey.get(`${r.resident_id}/${p.part_id}`);
      return [c?.value_state === "scored" ? c.score : null, c?.value_state === "absent" ? "ขาดสอบ" : c?.value_state === "awaiting" ? "ยังไม่สอบ" : null];
    })]);
  });
  style(scores, [38, 32, 16, ...snapshot.parts.flatMap(() => [16, 18])]);
  scores.getColumn(1).hidden = true;
  snapshot.parts.forEach((p, i) => {
    for (let row = 2; row <= scores.rowCount; row++) scores.getCell(row, 5 + i * 2).dataValidation = { type: "list", allowBlank: true, formulae: ['"ขาดสอบ,ยังไม่สอบ"'], showErrorMessage: true, error: "เลือกขาดสอบ/ยังไม่สอบ หรือเว้นว่างเมื่อมีคะแนน" };
  });
  const criteria = book.addWorksheet(SHEETS[1]); criteria.addRow(CRITERIA);
  snapshot.parts.forEach((p, i) => criteria.addRow([p.part_id, p.column_key, p.name, p.sort_order, p.max_score, ...[1, 2, 3, 4].map((y) => p.mpl[String(y)] ?? null), 4 + i * 2, 5 + i * 2]));
  style(criteria, [38, 18, 28, 10, 14, 14, 14, 14, 14, 16, 16]);
  const info = book.addWorksheet(SHEETS[2]); info.addRow(["key", "value"]);
  const values = { template_version: snapshot.template_version, ...snapshot.exam };
  META.forEach((k) => info.addRow([k, values[k]]));
  info.addRow(["คำแนะนำ", "กรอกคะแนนตัวเลข หรือเลือกขาดสอบ/ยังไม่สอบเพียงอย่างเดียว ช่องว่างไม่ลบข้อมูลเดิม ห้ามแก้ชื่อ รหัส ชั้นปี หรือเกณฑ์ จากนั้นนำเข้า ตรวจเทียบ และประกาศแยกขั้น"]);
  style(info, [24, 90]);
  return book;
}
export async function parseManagedTemplate(ExcelJS, input, filename, snapshot) {
  const bytes = await inspectManagedXlsx(input, filename);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
  if (book.worksheets.length !== 3 || !SHEETS.every((n) => book.getWorksheet(n))) problem("ชื่อ/จำนวนชีตไม่ครบ กรุณาใช้แม่แบบเดิม");
  for (const sheet of book.worksheets) {
    if (sheet.rowCount > 300 || sheet.columnCount > 103 || Object.keys(sheet.model.merges || {}).length) problem("จำนวนแถว/คอลัมน์เกินกำหนด หรือมีเซลล์รวม");
    sheet.eachRow((row) => row.eachCell((cell) => cellValue(cell)));
  }
  const info = book.getWorksheet(SHEETS[2]), expected = { template_version: snapshot.template_version, ...snapshot.exam };
  same(cellValue(info.getCell(1, 1)), "key", "ข้อมูลรายการ!A1"); same(cellValue(info.getCell(1, 2)), "value", "ข้อมูลรายการ!B1");
  META.forEach((key, i) => { same(cellValue(info.getCell(i + 2, 1)), key, `ข้อมูลรายการ!A${i + 2}`); same(cellValue(info.getCell(i + 2, 2)), expected[key], `ข้อมูลรายการ!B${i + 2}`); });
  const criteria = book.getWorksheet(SHEETS[1]);
  if (criteria.actualRowCount !== snapshot.parts.length + 1 || criteria.columnCount !== CRITERIA.length) problem("รายการส่วนสอบ/เกณฑ์ไม่ครบ");
  CRITERIA.forEach((h, i) => same(cellValue(criteria.getCell(1, i + 1)), h, `ส่วนสอบและเกณฑ์!${i + 1}`));
  snapshot.parts.forEach((p, i) => {
    const values = [p.part_id, p.column_key, p.name, p.sort_order, p.max_score, ...[1, 2, 3, 4].map((y) => p.mpl[String(y)] ?? null), 4 + i * 2, 5 + i * 2];
    values.forEach((v, j) => same(cellValue(criteria.getCell(i + 2, j + 1)), v, `ส่วนสอบและเกณฑ์!${criteria.getCell(i + 2, j + 1).address}`));
  });
  const sheet = book.getWorksheet(SHEETS[0]), header = columns(snapshot.parts);
  if (sheet.columnCount !== header.length || sheet.rowCount > snapshot.roster.length + 1) problem("คอลัมน์หรือจำนวนแถวคะแนนไม่ตรงแม่แบบ");
  header.forEach((v, i) => same(cellValue(sheet.getCell(1, i + 1)), v, `คะแนน!${sheet.getCell(1, i + 1).address}`));
  const roster = new Map(snapshot.roster.map((r) => [r.resident_id, r])), seen = new Set(), cells = [];
  for (let row = 2; row <= sheet.rowCount; row++) {
    const values = Array.from({ length: header.length }, (_, i) => cellValue(sheet.getCell(row, i + 1)));
    if (values.every(empty)) continue;
    const r = roster.get(values[0]);
    if (!r || seen.has(r.resident_id)) problem("รหัสผู้สอบไม่อยู่ในรายการหรือซ้ำ", `คะแนน!A${row}`);
    seen.add(r.resident_id);
    same(values[1], r.reference_name, `คะแนน!B${row}`); same(values[2], r.pgy_at_exam, `คะแนน!C${row}`);
    snapshot.parts.forEach((p, i) => {
      const score = values[3 + i * 2], state = values[4 + i * 2], ref = `คะแนน!${sheet.getCell(row, 4 + i * 2).address}`;
      if (empty(score) && empty(state)) return;
      if (!empty(state) && !["ขาดสอบ", "ยังไม่สอบ"].includes(state)) problem("สถานะต้องเป็นขาดสอบ/ยังไม่สอบ หรือว่าง", ref);
      if (!empty(state) && !empty(score)) problem("ห้ามมีทั้งคะแนนและสถานะขาดสอบ/ยังไม่สอบ", ref);
      if (!empty(score) && (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > p.max_score || Math.abs(score * 100 - Math.round(score * 100)) > 1e-7)) problem("คะแนนต้องเป็นตัวเลข 0 ถึงคะแนนเต็ม ทศนิยมไม่เกิน 2 ตำแหน่ง", ref);
      cells.push({ resident_id: r.resident_id, part_id: p.part_id, state: empty(state) ? "scored" : state === "ขาดสอบ" ? "absent" : "awaiting", ...(empty(state) ? { score } : {}), cell_ref: ref });
    });
  }
  if (!seen.size) problem("ไม่พบรายชื่อผู้สอบในไฟล์");
  if (cells.length > 10000) problem("นำเข้าได้ไม่เกิน 10,000 ช่อง");
  return {
    cells, missingResidents: snapshot.roster.length - seen.size,
    reported: { template_version: expected.template_version, exam_id: expected.exam_id, revision_id: expected.revision_id, version: expected.version, academic_year: expected.academic_year,
      roster: snapshot.roster.filter((r) => seen.has(r.resident_id)).map(({ resident_id, pgy_at_exam }) => ({ resident_id, pgy_at_exam })),
      parts: snapshot.parts.map(({ part_id, max_score, mpl }) => ({ part_id, max_score, mpl })) },
  };
}
export function buildManagedResultsWorkbook(ExcelJS, bundle) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("ผลประกาศ");
  const partKey = (r, id) => `${r.exam_id}/${r.revision_id}/${id}`;
  const partNames = new Map(bundle.rows.map((r) => [partKey(r, r.part_id), r.part_name]));
  sheet.addRow(["exam_id", "revision_id", "ปีการศึกษา", "วันสอบ", "ชื่อการสอบ", "รหัสผู้สอบ", "ชื่ออ้างอิง", "PGY ณ วันสอบ", "ส่วนสอบ", "คะแนน", "เต็ม", "MPL", "สถานะ", "ผล", "ผลรวม", "ส่วนที่ไม่ผ่าน", "ส่วนที่ไม่ผ่าน (รหัส)"]);
  bundle.rows.forEach((r) => {
    const failedNames = r.overall.failed_part_ids.map((id) => {
      const name = partNames.get(partKey(r, id));
      if (typeof name !== "string" || !name.trim()) problem("ข้อมูลชื่อส่วนที่ไม่ผ่านไม่ครบ กรุณาโหลดผลใหม่ทั้งชุด");
      return name;
    }).join(", ");
    const overall = `${OVERALL_LABELS[r.overall.status]}${failedNames ? ` · ส่วนที่ไม่ผ่าน: ${failedNames}` : ""}`;
    sheet.addRow([r.exam_id, r.revision_id, r.academic_year, r.exam_date, r.title, r.resident_id, r.reference_name, r.pgy_at_exam, r.part_name, r.score, r.max_score, r.mpl, r.value_state, managedCellLabel(r), overall, failedNames, r.overall.failed_part_ids.join(", ")]);
  });
  style(sheet, [38, 38, 14, 16, 30, 38, 30, 14, 24, 12, 12, 12, 16, 22, 48, 30, 40]);
  return book;
}
export async function loadManagedExcel() { const { default: ExcelJS } = await import("exceljs"); return ExcelJS; }
export async function downloadManagedBook(book, filename, { signal, assertCurrent = () => {} } = {}) {
  const current = () => { signal?.throwIfAborted(); assertCurrent(); };
  current();
  const bytes = await book.xlsx.writeBuffer();
  current();
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  try { current(); const link = document.createElement("a"); link.href = url; link.download = filename; current(); link.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export { XLSX_LIMITS };
