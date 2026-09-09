import React, { useMemo, useState } from "react";
import { DownloadIcon, FileIcon, ShieldIcon } from "../components/Icons";
import { buildExportRecords, filterExportRecords, getResidentProfiles } from "../residentAnalytics";
import { exportResidentExcel, exportResidentPdf } from "../residentExport";

const scopes = [
  ["resident-one", "Resident รายคน", "เลือก Resident หนึ่งคน"], ["template-one", "EPA/PBA รายแบบ", "เลือกแบบประเมินหนึ่งแบบ"],
  ["resident-all", "Resident ทั้งหมด", "ผลประเมินของ Resident ทุกคน"], ["epa-all", "EPA ทั้งหมด", "รวมผล EPA ทุกแบบ"], ["pba-all", "PBA ทั้งหมด", "รวมผล PBA ทุกแบบ"],
];

export default function ResidentExportCenter({ workspace }) {
  const residents = useMemo(() => getResidentProfiles(workspace), [workspace]);
  const records = useMemo(() => buildExportRecords(workspace), [workspace]);
  const [filters, setFilters] = useState({ scope: "resident-one", residentId: residents[0]?.id || "", templateId: workspace.templates[0]?.id || "", dateFrom: "", dateTo: "" });
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const selected = useMemo(() => filterExportRecords(records, filters), [records, filters]);
  const selectedScope = scopes.find(([id]) => id === filters.scope)?.[1] || "EPA-PBA";
  async function run(format) { setBusy(format); setError(""); try { const stamp = new Date().toISOString().slice(0, 10); const label = `Resident-${selectedScope}-${stamp}`; if (format === "pdf") await exportResidentPdf(selected, label); else await exportResidentExcel(selected, label); } catch (nextError) { setError(nextError.message || "สร้างไฟล์ไม่สำเร็จ"); } finally { setBusy(""); } }
  return <div className="export-layout">
    <section className="resident-panel export-scope-panel"><div className="section-heading"><h2>เลือกขอบเขตข้อมูล</h2><p>Admin เท่านั้น · ส่งออกเฉพาะข้อมูลการศึกษา</p></div><div className="scope-list">{scopes.map(([id, title, detail]) => <label className={filters.scope === id ? "scope-option active" : "scope-option"} key={id}><input type="radio" name="export-scope" checked={filters.scope === id} onChange={() => setFilters({ ...filters, scope: id })} /><span><strong>{title}</strong><small>{detail}</small></span></label>)}</div></section>
    <div>
      <section className="resident-panel export-filter-panel"><div className="section-heading"><h2>ตัวกรองและรูปแบบไฟล์</h2><p>ตรวจสอบตัวอย่างก่อนดาวน์โหลด</p></div><div className="resident-form-grid">{filters.scope === "resident-one" && <label>Resident<select value={filters.residentId} onChange={(event) => setFilters({ ...filters, residentId: event.target.value })}><option value="">เลือก Resident</option>{residents.map((resident) => <option key={resident.id} value={resident.id}>{resident.name} · PGY {resident.pgy}</option>)}</select></label>}{filters.scope === "template-one" && <label>แบบประเมิน<select value={filters.templateId} onChange={(event) => setFilters({ ...filters, templateId: event.target.value })}><option value="">เลือก EPA/PBA</option>{workspace.templates.map((template) => <option key={template.id} value={template.id}>{template.template_code} · {template.title}</option>)}</select></label>}<label>ตั้งแต่วันที่<input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label><label>ถึงวันที่<input type="date" min={filters.dateFrom} value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label></div><div className="export-actions"><button className="primary-button icon-button" disabled={Boolean(busy)} onClick={() => run("pdf")}><FileIcon />{busy === "pdf" ? "กำลังสร้าง PDF…" : "ดาวน์โหลด PDF"}</button><button className="secondary-button icon-button" disabled={Boolean(busy)} onClick={() => run("excel")}><DownloadIcon />{busy === "excel" ? "กำลังสร้าง Excel…" : "ดาวน์โหลด Excel"}</button><span>{selected.length.toLocaleString("th-TH")} รายการ</span></div>{error && <p className="form-error">{error}</p>}<div className="privacy-note"><ShieldIcon /><p><strong>คุ้มครองข้อมูลผู้ป่วย</strong><br />ไฟล์นี้ไม่มีชื่อผู้ป่วย HN หรือบริบททางคลินิก</p></div></section>
      <section className="resident-panel"><h2>ตัวอย่างข้อมูลที่จะส่งออก</h2><div className="resident-table-wrap"><table><thead><tr><th>วันที่</th><th>Resident</th><th>แบบประเมิน</th><th>Staff</th><th>ผลสรุป</th></tr></thead><tbody>{selected.slice(0, 8).map((record) => <tr key={record.id}><td>{record.assessmentDate}</td><td>{record.residentName}</td><td>{record.templateCode} · {record.templateTitle}</td><td>{record.staffName}</td><td>{record.outcome}</td></tr>)}{!selected.length && <tr><td colSpan="5" className="table-empty">ไม่พบข้อมูลตามตัวกรอง</td></tr>}</tbody></table></div>{selected.length > 8 && <p className="table-caption">แสดง 8 จาก {selected.length.toLocaleString("th-TH")} รายการ</p>}</section>
    </div>
  </div>;
}
