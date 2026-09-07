import React, { useState } from "react";
import { DownloadIcon, FileIcon } from "../components/Icons";
import { essentialProcedures, essentialRoles } from "../data";
import { getRoleProgress } from "./Essential";

const today = () => new Date().toISOString().slice(0, 10);
const cleanFileName = (value) => String(value || "Fellow").replace(/[^a-zA-Z0-9ก-๙_-]+/g, "-").replace(/^-|-$/g, "");
const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const flattenObject = (value) => Object.entries(value || {}).map(([key, item]) => `${key}: ${item}`).join(" | ");

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function assessmentRows(items, type, fellowName) {
  return items.map((item) => ({
    type,
    date: item.date,
    fellow: fellowName,
    activity: `${item.templateId} - ${item.templateTitle}`,
    role: "Assessed",
    supervisor: item.supervisorName,
    level: item.globalLevel,
    reference: item.caseRef,
    detail: item.comments,
  }));
}

function allExportRows(record) {
  return [
    ...record.logbook.map((item) => ({ type: "Logbook", date: item.date, fellow: record.fellowName, activity: item.operationSummary || item.operation, role: item.participation, supervisor: item.supervisor, level: "", reference: item.hn, detail: [item.diagnosis, item.note].filter(Boolean).join(" | ") })),
    ...assessmentRows(record.epaAssessments, "EPA", record.fellowName),
    ...assessmentRows(record.pbaAssessments, "PBA", record.fellowName),
    ...record.topics.map((item) => ({ type: "Topic", date: item.date, fellow: record.fellowName, activity: item.title, role: item.status, supervisor: "", level: "", reference: "", detail: item.note })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function addWorksheet(workbook, name, columns, rows) {
  const worksheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
  };
  worksheet.pageSetup.printTitlesRow = "1:1";
  worksheet.addRow(columns.map((column) => column.label));
  rows.forEach((row) => worksheet.addRow(columns.map((column) => row[column.key] ?? "")));
  const header = worksheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF9F1239" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  columns.forEach((column, index) => {
    const values = rows.slice(0, 200).map((row) => String(row[column.key] ?? "").length);
    worksheet.getColumn(index + 1).width = Math.min(Math.max(column.width || 12, ...values.map((length) => Math.min(length + 2, 42))), 42);
    worksheet.getColumn(index + 1).alignment = { vertical: "top", wrapText: true };
  });
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return worksheet;
}

function reportTable(title, headers, rows) {
  if (!rows.length) return `<section><h2>${htmlEscape(title)}</h2><p class="empty">ยังไม่มีข้อมูล</p></section>`;
  return `<section><h2>${htmlEscape(title)}</h2><table><thead><tr>${headers.map((header) => `<th>${htmlEscape(header.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${htmlEscape(row[header.key])}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`;
}

export default function ExportCenter({ record }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const baseName = `Breast-Training-${cleanFileName(record.fellowName)}-${today()}`;

  function exportCsv() {
    const columns = ["Type", "Date", "Fellow", "Activity / Operation", "Role / Status", "Supervisor", "Level", "Reference", "Detail"];
    const rows = allExportRows(record).map((item) => [item.type, item.date, item.fellow, item.activity, item.role, item.supervisor, item.level, item.reference, item.detail]);
    const csv = `\uFEFF${[columns, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${baseName}.csv`);
    setMessage("ดาวน์โหลด CSV แล้ว");
  }

  async function exportXlsx() {
    setBusy("xlsx"); setMessage("");
    try {
      const ExcelModule = await import("exceljs");
      const Workbook = ExcelModule.Workbook || ExcelModule.default?.Workbook;
      const workbook = new Workbook();
      workbook.creator = "Breast & Endocrine Surgery CMU";
      workbook.created = new Date();
      addWorksheet(workbook, "Overview", [{ key: "metric", label: "Metric", width: 28 }, { key: "value", label: "Value", width: 18 }], [
        { metric: "Fellow", value: record.fellowName }, { metric: "Export date", value: today() }, { metric: "Logbook cases", value: record.logbook.length },
        { metric: "EPA assessments", value: record.epaAssessments.length }, { metric: "PBA assessments", value: record.pbaAssessments.length }, { metric: "Topics", value: record.topics.length },
      ]);
      addWorksheet(workbook, "Logbook", [
        { key: "date", label: "Date" }, { key: "operation", label: "Operation 1", width: 32 }, { key: "operation2", label: "Operation 2", width: 32 }, { key: "operation3", label: "Operation 3", width: 32 }, { key: "participation", label: "Role" }, { key: "supervisor", label: "Supervisor", width: 24 },
        { key: "hn", label: "Case reference" }, { key: "diagnosis", label: "Diagnosis", width: 28 }, { key: "note", label: "Note", width: 30 },
      ], record.logbook);
      const assessmentColumns = [
        { key: "date", label: "Date" }, { key: "templateId", label: "Template" }, { key: "templateTitle", label: "Title", width: 34 }, { key: "supervisorName", label: "Supervisor", width: 24 },
        { key: "assessor", label: "Recorded by", width: 24 }, { key: "globalLevel", label: "Level" }, { key: "caseRef", label: "Reference" }, { key: "scoreText", label: "Checklist scores", width: 38 },
        { key: "itemCommentText", label: "Item comments", width: 38 }, { key: "comments", label: "Summary comments", width: 38 },
      ];
      const enrichAssessment = (item) => ({ ...item, scoreText: flattenObject(item.scores), itemCommentText: flattenObject(item.itemComments) });
      addWorksheet(workbook, "EPA", assessmentColumns, record.epaAssessments.map(enrichAssessment));
      addWorksheet(workbook, "PBA", assessmentColumns, record.pbaAssessments.map(enrichAssessment));
      addWorksheet(workbook, "Essential", [
        { key: "category", label: "Category", width: 24 }, { key: "operation", label: "Operation", width: 36 }, { key: "role", label: "Role" }, { key: "completed", label: "Completed" }, { key: "target", label: "Target" }, { key: "remaining", label: "Remaining" },
      ], essentialProcedures.flatMap((procedure) => essentialRoles.map((role) => ({ category: procedure.category, operation: procedure.operation, role, ...getRoleProgress(procedure, record.logbook, role) }))));
      addWorksheet(workbook, "Topics", [
        { key: "date", label: "Date" }, { key: "title", label: "Topic", width: 34 }, { key: "status", label: "Status" }, { key: "note", label: "Detail", width: 42 },
      ], record.topics);
      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${baseName}.xlsx`);
      setMessage("ดาวน์โหลด Excel แล้ว");
    } catch (error) {
      setMessage(`ไม่สามารถสร้าง Excel ได้: ${error.message}`);
    } finally {
      setBusy("");
    }
  }

  function exportPdf() {
    const popup = window.open("", "_blank");
    if (!popup) return setMessage("Browser ปิดกั้นหน้าต่าง PDF กรุณาอนุญาต Pop-up แล้วลองอีกครั้ง");
    popup.opener = null;
    const logbookHeaders = [{ key: "date", label: "วันที่" }, { key: "operation", label: "Operation 1" }, { key: "operation2", label: "Operation 2" }, { key: "operation3", label: "Operation 3" }, { key: "participation", label: "Role" }, { key: "supervisor", label: "Supervisor" }];
    const assessmentHeaders = [{ key: "date", label: "วันที่" }, { key: "templateId", label: "แบบ" }, { key: "templateTitle", label: "หัวข้อ" }, { key: "globalLevel", label: "Level" }, { key: "supervisorName", label: "อาจารย์ผู้ควบคุม" }];
    popup.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${htmlEscape(baseName)}</title><style>
      @page{size:A4 landscape;margin:13mm}*{box-sizing:border-box}body{font-family:"Noto Sans Thai",Tahoma,Arial,sans-serif;color:#202124;margin:0;font-size:10px}header{display:flex;align-items:center;border-bottom:3px solid #155426;padding-bottom:10px;margin-bottom:16px}header img{width:70px;height:70px;object-fit:contain;margin-right:14px}h1{font-size:22px;color:#155426;margin:0 0 4px}h2{font-size:15px;color:#155426;margin:18px 0 7px}p{margin:2px 0}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.summary div{border:1px solid #ddd;padding:8px}.summary strong{display:block;font-size:16px;color:#155426}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #d7dce0;padding:5px;vertical-align:top;overflow-wrap:anywhere}th{background:#155426;color:white;text-align:left}.empty{color:#687078;border:1px solid #ddd;padding:10px}section{break-inside:avoid}footer{margin-top:18px;color:#687078;font-size:8px}@media print{button{display:none}}
    </style></head><body><header><img src="${window.location.origin}/surgery-cmu-logo.png" alt=""><div><h1>Surgery CMU Training Report</h1><p>Fellow: <strong>${htmlEscape(record.fellowName)}</strong></p><p>Exported: ${today()}</p></div></header>
    <div class="summary"><div><strong>${record.logbook.length}</strong>Logbook cases</div><div><strong>${record.epaAssessments.length}</strong>EPA assessments</div><div><strong>${record.pbaAssessments.length}</strong>PBA assessments</div><div><strong>${record.topics.length}</strong>Topics</div></div>
    ${reportTable("Logbook", logbookHeaders, record.logbook)}${reportTable("EPA", assessmentHeaders, record.epaAssessments)}${reportTable("PBA", assessmentHeaders, record.pbaAssessments)}
    <footer>Breast &amp; Endocrine Surgery CMU · Generated from Supabase · ห้ามเผยแพร่ข้อมูลผู้ป่วยนอกระบบที่ได้รับอนุญาต</footer><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));<\/script></body></html>`);
    popup.document.close();
    setMessage("เปิดหน้าต่าง Print แล้ว เลือก Save as PDF เพื่อบันทึกไฟล์");
  }

  return (
    <>
      <div className="page-heading"><div><h1>Export</h1><p>ดาวน์โหลดข้อมูลของ <strong>{record.fellowName}</strong> เพื่อสำรองหรือจัดทำรายงาน</p></div></div>
      <div className="export-grid">
        <article className="content-panel export-card"><span><FileIcon size={28} /></span><h2>Excel Workbook</h2><p>แยก worksheet สำหรับ Overview, Logbook, EPA, PBA, Essential และ Topic</p><button className="primary-button" onClick={exportXlsx} disabled={busy === "xlsx"}><DownloadIcon size={18} />{busy === "xlsx" ? "กำลังสร้าง…" : "ดาวน์โหลด .xlsx"}</button></article>
        <article className="content-panel export-card"><span><FileIcon size={28} /></span><h2>CSV</h2><p>ข้อมูลกิจกรรมทั้งหมดในตารางเดียว เหมาะกับการสำรองและนำเข้าระบบอื่น</p><button className="secondary-button" onClick={exportCsv}><DownloadIcon size={18} />ดาวน์โหลด .csv</button></article>
        <article className="content-panel export-card"><span><FileIcon size={28} /></span><h2>PDF Report</h2><p>เปิดรายงานที่จัดหน้าไว้แล้ว จากนั้นเลือก Save as PDF ในหน้าต่าง Print</p><button className="secondary-button" onClick={exportPdf}><DownloadIcon size={18} />พิมพ์ / บันทึก .pdf</button></article>
      </div>
      {message && <div className="export-message" role="status">{message}</div>}
      <div className="privacy-note export-privacy">ไฟล์ที่ดาวน์โหลดอาจมีข้อมูลอ้างอิงผู้ป่วย โปรดบันทึกไว้ในพื้นที่ Google Drive ขององค์กรหรือพื้นที่ที่ได้รับอนุญาตเท่านั้น และไม่ส่งต่อผ่านช่องทางสาธารณะ</div>
    </>
  );
}
