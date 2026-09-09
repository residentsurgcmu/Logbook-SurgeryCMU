const bangkokDateTime = (value) => value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
const safeName = (value) => String(value || "resident-assessments").replace(/[^a-zA-Z0-9ก-๙_-]+/g, "-").replace(/-+/g, "-");

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export async function exportResidentExcel(records, label) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Resident Surgery Assessment";
  const summary = workbook.addWorksheet("สรุปการประเมิน", { views: [{ state: "frozen", ySplit: 1 }] });
  summary.columns = [
    ["วันที่กิจกรรม", "assessment_date", 15], ["Resident", "resident_name", 28], ["PGY", "pgy", 8],
    ["ประเภท", "type", 10], ["รหัส", "code", 12], ["แบบประเมิน", "title", 34], ["กิจกรรม", "activity", 34],
    ["Staff", "staff", 28], ["Resident ส่งเมื่อ", "submitted", 21], ["Staff ประเมินเมื่อ", "assessed", 21],
    ["ผลสรุป", "outcome", 22], ["ความเห็น", "comment", 38],
  ].map(([header, key, width]) => ({ header, key, width }));
  records.forEach((record) => summary.addRow({ assessment_date: record.assessmentDate, resident_name: record.residentName, pgy: record.pgy, type: record.templateType, code: record.templateCode, title: record.templateTitle, activity: record.activity, staff: record.staffName, submitted: bangkokDateTime(record.submittedAt), assessed: bangkokDateTime(record.assessedAt), outcome: record.outcome, comment: record.comment }));
  const scores = workbook.addWorksheet("คะแนนรายข้อ", { views: [{ state: "frozen", ySplit: 1 }] });
  scores.columns = [["Resident", "resident_name", 28], ["รหัสแบบ", "template", 14], ["ข้อ", "code", 10], ["เกณฑ์", "criterion", 62], ["ระดับ", "score", 12], ["ข้อเสนอแนะ", "comment", 38]].map(([header, key, width]) => ({ header, key, width }));
  records.forEach((record) => record.scores.forEach((score) => scores.addRow({ resident_name: record.residentName, template: record.templateCode, ...score })));
  [summary, scores].forEach((sheet) => {
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF155426" } };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
    sheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  });
  const data = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${safeName(label)}.xlsx`);
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text ?? "—").split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) { lines.push(line); line = word; } else line = next;
  });
  if (line) lines.push(line);
  return lines.length ? lines : ["—"];
}

export async function exportResidentPdf(records, label) {
  const [{ PDFDocument, rgb }, fontkitModule] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit")]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitModule.default);
  const fontBytes = await fetch("/fonts/NotoSansThai.ttf").then((response) => { if (!response.ok) throw new Error("โหลดฟอนต์ภาษาไทยไม่สำเร็จ"); return response.arrayBuffer(); });
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const green = rgb(0.082, 0.329, 0.149);
  const muted = rgb(0.35, 0.42, 0.37);
  let page; let y;
  const addPage = () => { page = pdf.addPage([595.28, 841.89]); y = 795; page.drawText("Resident Surgery Assessment · EPA / PBA", { x: 42, y, size: 16, font, color: green }); y -= 25; page.drawText(label, { x: 42, y, size: 11, font, color: muted }); y -= 26; };
  addPage();
  if (!records.length) page.drawText("ไม่พบข้อมูลตามตัวกรองที่เลือก", { x: 42, y, size: 12, font });
  records.forEach((record, index) => {
    const details = [
      `${index + 1}. ${record.templateCode} · ${record.templateTitle}`,
      `Resident: ${record.residentName} · PGY ${record.pgy}    Staff: ${record.staffName}`,
      `วันที่กิจกรรม: ${record.assessmentDate}    ส่งเมื่อ: ${bangkokDateTime(record.submittedAt)}    ประเมินเมื่อ: ${bangkokDateTime(record.assessedAt)}`,
      `กิจกรรม: ${record.activity}`,
      `ผลสรุป: ${record.outcome}${record.comment ? ` · ${record.comment}` : ""}`,
    ];
    const lineGroups = details.map((text) => wrapText(text, font, 9, 505));
    const needed = lineGroups.reduce((sum, lines) => sum + lines.length * 13, 18);
    if (y - needed < 48) addPage();
    lineGroups.forEach((lines, detailIndex) => lines.forEach((line) => { page.drawText(line, { x: 42, y, size: detailIndex === 0 ? 10 : 9, font, color: detailIndex === 0 ? green : rgb(0.1, 0.14, 0.11) }); y -= 13; }));
    y -= 9;
    page.drawLine({ start: { x: 42, y }, end: { x: 553, y }, thickness: 0.5, color: rgb(0.82, 0.87, 0.83) });
    y -= 15;
  });
  const pages = pdf.getPages();
  pages.forEach((item, index) => item.drawText(`หน้า ${index + 1}/${pages.length} · ไม่มีข้อมูลระบุตัวผู้ป่วย`, { x: 42, y: 24, size: 8, font, color: muted }));
  downloadBlob(new Blob([await pdf.save()], { type: "application/pdf" }), `${safeName(label)}.pdf`);
}
