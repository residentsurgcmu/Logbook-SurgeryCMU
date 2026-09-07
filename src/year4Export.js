import { statusLabels, year4Activities } from "./year4Data";
import { formatYear4Timestamp } from "./year4Time";
import { programQualitySummary } from "./year4Analytics";

const today = () => new Date().toISOString().slice(0, 10);
const safeName = (value) => String(value || "all").replace(/[^a-zA-Z0-9ก-๙_-]+/g, "-").replace(/^-|-$/g, "");
const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);

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

export function selectYear4ExportData(students, entries, approvalEvents, filter, activities = year4Activities, enrollments = []) {
  const groupStudentIds = new Set(enrollments.filter((item) => item.groupCode === filter.studentGroup
    && (!filter.curriculumId || filter.curriculumId === "all" || item.curriculumId === filter.curriculumId)).map((item) => item.studentId));
  const selectedStudents = filter.scope === "student"
    ? students.filter((student) => student.id === filter.studentId)
    : filter.scope === "group"
      ? students.filter((student) => groupStudentIds.size ? groupStudentIds.has(student.id) : student.studentGroup === filter.studentGroup)
      : students;
  const studentIds = new Set(selectedStudents.map((student) => student.id));
  const selectedEntries = entries.filter((entry) => studentIds.has(entry.studentId)
    && (!filter.curriculumId || filter.curriculumId === "all" || entry.curriculumId === filter.curriculumId));
  const entryIds = new Set(selectedEntries.map((entry) => entry.id));
  const selectedEvents = (approvalEvents || []).filter((event) => studentIds.has(event.student_id) && entryIds.has(event.entry_id));
  return { students: selectedStudents, entries: selectedEntries, approvalEvents: selectedEvents, activities };
}

function exportLabel(filter, students) {
  if (filter.scope === "student") return students[0] ? `${students[0].studentCode}-${students[0].name}` : "student";
  if (filter.scope === "group") return `group-${filter.studentGroup}`;
  return "all-students";
}

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.columns = columns.map((column) => ({ header: column.label, key: column.key, width: column.width || 16 }));
  rows.forEach((row) => sheet.addRow(row));
  const header = sheet.getRow(1);
  header.height = 28;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF155426" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });
  if (columns.length) sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(columns.length).letter}1` };
  return sheet;
}

export async function exportYear4Excel(data, filter) {
  const ExcelModule = await import("exceljs");
  const Workbook = ExcelModule.Workbook || ExcelModule.default?.Workbook;
  const workbook = new Workbook();
  workbook.creator = "Surgery CMU Logbook";
  workbook.created = new Date();
  const students = new Map(data.students.map((student) => [student.id, student]));
  const exportActivityMap = new Map((data.activities || year4Activities).map((activity) => [activity.id, activity]));
  const quality = programQualitySummary(data.students, data.entries, [], data.activities || year4Activities);

  addSheet(workbook, "Summary", [
    { key: "metric", label: "รายการ", width: 30 },
    { key: "value", label: "ค่า", width: 42 },
  ], [
    { metric: "วันที่ส่งออก", value: new Date().toLocaleString("th-TH") },
    { metric: "ขอบเขต", value: filter.scope === "all" ? "นักศึกษาทุกคน" : filter.scope === "group" ? `กลุ่ม ${filter.studentGroup}` : data.students[0]?.name || "รายคน" },
    { metric: "จำนวนนักศึกษา", value: data.students.length },
    { metric: "จำนวน Logbook", value: data.entries.length },
    { metric: "อนุมัติแล้ว", value: data.entries.filter((entry) => entry.status === "approved").length },
    { metric: "รออนุมัติ", value: data.entries.filter((entry) => entry.status === "submitted").length },
  ]);

  addSheet(workbook, "Students", [
    { key: "studentCode", label: "รหัสนักศึกษา", width: 18 },
    { key: "studentGroup", label: "กลุ่มที่", width: 12 },
    { key: "name", label: "ชื่อ-นามสกุล", width: 30 },
    { key: "email", label: "อีเมล", width: 34 },
    { key: "classYear", label: "ชั้นปี", width: 10 }, { key: "academicYear", label: "ปีการศึกษา", width: 14 },
  ], data.students);

  addSheet(workbook, "Logbook", [
    { key: "date", label: "วันที่", width: 14 }, { key: "classYear", label: "ชั้นปี", width: 10 }, { key: "academicYear", label: "ปีการศึกษา", width: 14 }, { key: "enrollmentId", label: "Enrollment ID", width: 38 }, { key: "studentCode", label: "รหัสนักศึกษา", width: 17 },
    { key: "studentGroup", label: "กลุ่มที่", width: 11 }, { key: "studentName", label: "ชื่อนักศึกษา", width: 28 },
    { key: "category", label: "หมวดกิจกรรม", width: 22 }, { key: "activity", label: "กิจกรรม", width: 34 }, { key: "week", label: "สัปดาห์", width: 10 },
    { key: "unit", label: "หน่วย/Ward", width: 22 }, { key: "caseReference", label: "รหัสเคสแบบปกปิด", width: 20 },
    { key: "diagnosis", label: "Diagnosis/ประสบการณ์", width: 30 }, { key: "procedure", label: "Procedure/หัวข้อ", width: 30 },
    { key: "participation", label: "บทบาท", width: 16 }, { key: "detail", label: "รายละเอียด", width: 34 },
    { key: "selectedApprover", label: "Staff ที่เลือก", width: 28 }, { key: "status", label: "สถานะ", width: 16 },
    { key: "submittedAt", label: "นักศึกษาบันทึก", width: 22 }, { key: "approvedAt", label: "Staff อนุมัติ", width: 22 },
    { key: "comment", label: "ความคิดเห็น", width: 34 }, { key: "revision", label: "Revision", width: 10 },
  ], data.entries.map((entry) => {
    const student = students.get(entry.studentId) || {};
    return {
      date: entry.date, classYear: entry.classYear || student.classYear || "", academicYear: entry.academicYear || student.academicYear || "", enrollmentId: entry.enrollmentId || "", studentCode: student.studentCode || "", studentGroup: entry.enrollmentGroup || student.studentGroup || "", studentName: student.name || entry.studentId,
      category: exportActivityMap.get(entry.activityType)?.group || "", activity: exportActivityMap.get(entry.activityType)?.title || entry.activityType, week: entry.weekNumber || "", unit: entry.unitName,
      caseReference: entry.patientReference, diagnosis: entry.diagnosis, procedure: entry.procedureName || entry.activityTitle,
      participation: entry.participation, detail: entry.detail, selectedApprover: entry.selectedApproverName || entry.supervisorName,
      status: statusLabels[entry.status] || entry.status, submittedAt: entry.submittedAt || "", approvedAt: entry.approvedAt || "",
      comment: entry.approverComment, revision: entry.revision,
    };
  }));

  addSheet(workbook, "Approval Audit", [
    { key: "created_at", label: "เวลา", width: 24 }, { key: "entry_id", label: "Entry ID", width: 38 },
    { key: "student_id", label: "Student ID", width: 38 }, { key: "actor_id", label: "Actor ID", width: 38 },
    { key: "from_status", label: "จากสถานะ", width: 16 }, { key: "to_status", label: "เป็นสถานะ", width: 16 },
    { key: "comment", label: "ความคิดเห็น", width: 38 }, { key: "revision", label: "Revision", width: 10 },
  ], data.approvalEvents);

  addSheet(workbook, "Program Quality", [
    { key: "studentCode", label: "รหัสนักศึกษา", width: 18 }, { key: "studentGroup", label: "กลุ่ม", width: 10 },
    { key: "name", label: "นักศึกษา", width: 30 }, { key: "progress", label: "ความก้าวหน้า", width: 18 },
    { key: "pending", label: "รออนุมัติ", width: 14 }, { key: "stalePending", label: "ค้างเกิน 48 ชม.", width: 17 },
    { key: "rejected", label: "ส่งกลับ", width: 12 }, { key: "risk", label: "สถานะติดตาม", width: 18 },
  ], quality.monitoring.map((student) => ({ ...student, progress: `${student.completed}/${student.required} · ${student.percent}%`, risk: student.atRisk ? "ควรติดตาม" : student.percent >= student.passPercent ? `ผ่าน ${student.passPercent}%` : "กำลังดำเนินการ" })));

  addSheet(workbook, "Data Anomalies", [
    { key: "student", label: "นักศึกษา", width: 30 }, { key: "entryId", label: "Entry ID", width: 38 },
    { key: "type", label: "ประเภท", width: 20 }, { key: "severity", label: "ระดับ", width: 14 }, { key: "message", label: "รายละเอียด", width: 48 },
  ], quality.anomalies.map((item) => ({ ...item, student: students.get(item.studentId)?.name || item.studentId })));

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `Surgery-Logbook-${safeName(exportLabel(filter, data.students))}-${today()}.xlsx`;
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
  return fileName;
}

function studentSection(student, entries, exportActivityMap) {
  const rows = entries.filter((entry) => entry.studentId === student.id);
  const body = rows.length ? rows.map((entry) => `<tr>
    <td>${htmlEscape(entry.date)}</td><td>${htmlEscape(exportActivityMap.get(entry.activityType)?.group || "—")}</td><td>${htmlEscape(exportActivityMap.get(entry.activityType)?.title || entry.activityType)}</td>
    <td>${htmlEscape(entry.unitName)}</td><td>${htmlEscape(entry.procedureName || entry.activityTitle || entry.diagnosis)}</td>
    <td>${htmlEscape(entry.selectedApproverName || entry.supervisorName)}</td><td>${htmlEscape(statusLabels[entry.status] || entry.status)}</td>
    <td>${htmlEscape(formatYear4Timestamp(entry.submittedAt))}</td><td>${htmlEscape(formatYear4Timestamp(entry.approvedAt))}</td>
  </tr>`).join("") : '<tr><td colspan="9" class="empty">ยังไม่มีข้อมูล Logbook</td></tr>';
  return `<section class="student"><h2>${htmlEscape(student.name)}</h2><p>รหัสนักศึกษา ${htmlEscape(student.studentCode)} · Year ${htmlEscape(student.classYear || 4)} · ปีการศึกษา ${htmlEscape(student.academicYear || student.cohortYear)} · กลุ่ม ${htmlEscape(student.studentGroup || "ยังไม่ระบุ")}</p>
  <table><thead><tr><th>วันที่</th><th>หมวด</th><th>กิจกรรม</th><th>หน่วย</th><th>Procedure/หัวข้อ</th><th>Staff</th><th>สถานะ</th><th>บันทึกเมื่อ</th><th>อนุมัติเมื่อ</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

export function exportYear4Pdf(data, filter) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Browser ปิดกั้นหน้าต่าง PDF กรุณาอนุญาต Pop-up แล้วลองอีกครั้ง");
  popup.opener = null;
  const title = filter.scope === "all" ? "นักศึกษาทุกคน" : filter.scope === "group" ? `นักศึกษากลุ่ม ${filter.studentGroup}` : data.students[0]?.name || "รายคน";
  const exportActivityMap = new Map((data.activities || year4Activities).map((activity) => [activity.id, activity]));
  const quality = programQualitySummary(data.students, data.entries, [], data.activities || year4Activities);
  popup.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Surgery-Logbook-${htmlEscape(safeName(title))}</title><style>
    @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:"Noto Sans Thai",Tahoma,Arial,sans-serif;color:#202124;margin:0;font-size:9px}header{display:flex;align-items:center;border-bottom:3px solid #155426;padding-bottom:9px;margin-bottom:14px}header img{width:62px;height:62px;object-fit:contain;margin-right:12px}h1{font-size:20px;color:#155426;margin:0 0 3px}h2{font-size:14px;color:#155426;margin:0 0 2px}p{margin:2px 0}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}.summary div{border:1px solid #d7dce0;padding:8px}.summary strong{display:block;font-size:16px;color:#155426}.student{break-before:page}.student:first-of-type{break-before:auto}.student>p{margin-bottom:7px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #d7dce0;padding:4px;vertical-align:top;overflow-wrap:anywhere}th{background:#155426;color:#fff;text-align:left}.empty{text-align:center;color:#687078;padding:12px}footer{position:fixed;bottom:0;color:#687078;font-size:7px}@media print{button{display:none}}
  </style></head><body><header><img src="${window.location.origin}/surgery-cmu-logo.png" alt=""><div><h1>Surgery CMU Logbook</h1><p>${htmlEscape(title)} · ส่งออก ${htmlEscape(new Date().toLocaleString("th-TH"))}</p></div></header>
  <div class="summary"><div><strong>${data.students.length}</strong>นักศึกษา</div><div><strong>${data.entries.length}</strong>รายการ Logbook</div><div><strong>${data.entries.filter((entry) => entry.status === "approved").length}</strong>อนุมัติแล้ว</div><div><strong>${quality.averageProgress}%</strong>ความก้าวหน้าเฉลี่ย</div><div><strong>${quality.atRiskCount}</strong>นักศึกษาที่ต้องติดตาม</div><div><strong>${quality.anomalies.length}</strong>ข้อมูลผิดปกติ</div></div>
  ${data.students.map((student) => studentSection(student, data.entries, exportActivityMap)).join("")}<footer>ภาควิชาศัลยศาสตร์ คณะแพทยศาสตร์ มหาวิทยาลัยเชียงใหม่ · ข้อมูลอาจมีรหัสเคสแบบปกปิด โปรดเก็บในพื้นที่ที่ได้รับอนุญาต</footer><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));<\/script></body></html>`);
  popup.document.close();
  return `Surgery-Logbook-${safeName(exportLabel(filter, data.students))}-${today()}.pdf`;
}
