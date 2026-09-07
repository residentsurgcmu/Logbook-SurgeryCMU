import React, { useState } from "react";
import { BookIcon, ClipboardIcon, ProcedureIcon, ChevronIcon, CheckIcon, CloudBackupIcon } from "../components/Icons";
import { epaTemplates, pbaTemplates, essentialProcedures } from "../data";
import { getProcedureProgress } from "./Essential";

const SummaryMetric = ({ icon, label, value, detail }) => (
  <div className="summary-metric">
    <span className="metric-icon">{icon}</span>
    <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
  </div>
);

function AssessmentProgress({ type, templates, assessments, onNavigate }) {
  const latestByTemplate = assessments
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .reduce((latest, assessment) => {
      if (!latest.has(assessment.templateId)) latest.set(assessment.templateId, assessment);
      return latest;
    }, new Map());

  return (
    <section className="content-panel assessment-progress-card">
      <div className="section-title">
        <div><h2>{type} ที่มีผลประเมินแล้ว</h2><p>{latestByTemplate.size} จาก {templates.length} รายการ</p></div>
        <button className="text-button" onClick={() => onNavigate(type.toLowerCase())}>ดูแบบประเมิน <ChevronIcon size={17} /></button>
      </div>
      <div className="assessment-step-list">
        {templates.map((template) => {
          const assessment = latestByTemplate.get(template.id);
          return (
            <button className={`assessment-step ${assessment ? "assessed" : "pending"}`} key={template.id} onClick={() => onNavigate(type.toLowerCase())} aria-label={`${template.id} ${assessment ? `ประเมินแล้ว ระดับ ${assessment.globalLevel}` : "ยังไม่มีผลประเมิน"}`}>
              <span className="assessment-step-marker">{assessment ? <CheckIcon size={18} /> : template.id.replace(`${type} `, "")}</span>
              <span><strong>{template.id}</strong><small>{assessment ? `ประเมินแล้ว · Level ${assessment.globalLevel}` : "รอการประเมิน"}</small></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function Dashboard({ user, record, onNavigate, onBackup }) {
  const [backupState, setBackupState] = useState({ busy: false, message: "", url: "", error: false });
  const progress = essentialProcedures.map((procedure) => getProcedureProgress(procedure, record.logbook));
  const measurable = progress.filter((item) => item.target !== null);
  const essentialDone = measurable.reduce((sum, item) => sum + Math.min(item.completed, item.target), 0);
  const essentialTarget = measurable.reduce((sum, item) => sum + item.target, 0);
  const epaPercent = Math.round((new Set(record.epaAssessments.map((assessment) => assessment.templateId)).size / epaTemplates.length) * 100);
  const pbaPercent = Math.round((new Set(record.pbaAssessments.map((assessment) => assessment.templateId)).size / pbaTemplates.length) * 100);
  const essentialPercent = essentialTarget ? Math.round((essentialDone / essentialTarget) * 100) : 0;
  const recent = [
    ...record.logbook.map((item) => ({ type: "Logbook", title: item.operationSummary || item.operation, date: item.date })),
    ...record.epaAssessments.map((item) => ({ type: "EPA", title: `${item.templateId} · ${item.templateTitle}`, date: item.date })),
    ...record.pbaAssessments.map((item) => ({ type: "PBA", title: `${item.templateId} · ${item.templateTitle}`, date: item.date })),
    ...record.topics.map((item) => ({ type: "Topic", title: item.title, date: item.date })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);

  async function backupNow() {
    setBackupState({ busy: true, message: "", url: "", error: false });
    try {
      const result = await onBackup();
      setBackupState({ busy: false, message: `สำรอง Excel ${result.fileCount || 3} ไฟล์ไปยัง Google Drive สำเร็จ`, url: result.folderUrl || "", error: false });
    } catch (error) {
      setBackupState({ busy: false, message: error.message, url: "", error: true });
    }
  }

  return (
    <>
      <div className="page-heading">
        <div><h1>ภาพรวมการฝึกอบรม</h1><p>{user.role === "staff" ? "สรุปความก้าวหน้าของ Fellow" : "ยินดีต้อนรับ"} <strong>{record.fellowName}</strong></p></div>
        <div className="dashboard-heading-actions">
          {user.role === "staff" && <button className="primary-button with-icon" onClick={backupNow} disabled={backupState.busy}><CloudBackupIcon size={19} />{backupState.busy ? "กำลังสำรอง…" : "สำรองข้อมูลตอนนี้"}</button>}
          <span className="role-note">{user.role === "staff" ? "Staff view · ประเมินผลได้" : "Fellow view · ดูผลและบันทึกกิจกรรม"}</span>
        </div>
      </div>
      {backupState.message && <div className={`backup-message ${backupState.error ? "error" : "success"}`} role="status">{backupState.message}{backupState.url && <> · <a href={backupState.url} target="_blank" rel="noreferrer">เปิดโฟลเดอร์สำรอง</a></>}</div>}
      <section className="summary-band" aria-label="สรุปความก้าวหน้า">
        <SummaryMetric icon={<BookIcon size={25} />} label="Logbook" value={record.logbook.length} detail="เคสที่บันทึก" />
        <SummaryMetric icon={<ClipboardIcon size={25} />} label="EPA Progress" value={`${epaPercent}%`} detail={`${record.epaAssessments.length} ครั้ง · ${epaTemplates.length} รายการ`} />
        <SummaryMetric icon={<ClipboardIcon size={25} />} label="PBA Progress" value={`${pbaPercent}%`} detail={`${record.pbaAssessments.length} ครั้ง · ${pbaTemplates.length} รายการ`} />
        <SummaryMetric icon={<ProcedureIcon size={25} />} label="Essential Procedure" value={`${essentialPercent}%`} detail={`${essentialDone} / ${essentialTarget} เคสตามเป้าหมายหลัก`} />
      </section>
      <div className="assessment-progress-grid" aria-label="สถานะการประเมิน EPA และ PBA">
        <AssessmentProgress type="EPA" templates={epaTemplates} assessments={record.epaAssessments} onNavigate={onNavigate} />
        <AssessmentProgress type="PBA" templates={pbaTemplates} assessments={record.pbaAssessments} onNavigate={onNavigate} />
      </div>
      <p className="assessment-progress-note">“ประเมินแล้ว” หมายถึงมีผลประเมินจาก Staff อย่างน้อย 1 ครั้ง และแสดง Level จากผลประเมินล่าสุด</p>
      <div className="dashboard-grid">
        <section className="content-panel essential-preview">
          <div className="section-title"><div><h2>ความก้าวหน้า Essential Procedure</h2><p>คำนวณจาก Operation และบทบาทใน Logbook โดยอัตโนมัติ</p></div><button className="text-button" onClick={() => onNavigate("essential")}>ดูทั้งหมด <ChevronIcon size={17} /></button></div>
          <div className="procedure-table compact">
            <div className="procedure-row table-head"><span>รายการหัตถการ</span><span>ทำแล้ว</span><span>เป้าหมาย</span><span>คงเหลือ</span><span>ความก้าวหน้า</span></div>
            {progress.slice(0, 7).map((item) => (
              <div className="procedure-row" key={item.id}>
                <span><strong>{item.operation}</strong><small>{item.targetRole || "Experience as available"}</small></span>
                <span>{item.completed}</span><span>{item.target ?? "—"}</span><span>{item.remaining ?? "—"}</span>
                <span className="progress-cell"><i><b style={{ width: `${item.percent}%` }} /></i><em>{item.target === null ? "ไม่กำหนด" : `${item.percent}%`}</em></span>
              </div>
            ))}
          </div>
        </section>
        <section className="content-panel recent-panel">
          <div className="section-title"><div><h2>กิจกรรมล่าสุด</h2><p>เรียงตามวันที่บันทึก</p></div></div>
          {recent.length === 0 ? (
            <div className="empty-state"><BookIcon size={30} /><h3>ยังไม่มีกิจกรรม</h3><p>เริ่มจากบันทึกเคสแรกใน Logbook</p><button className="secondary-button" onClick={() => onNavigate("logbook")}>เปิด Logbook</button></div>
          ) : (
            <ul className="activity-list">{recent.map((item, index) => <li key={`${item.type}-${index}`}><span>{item.type}</span><div><strong>{item.title}</strong><small>{item.date || "ไม่ระบุวันที่"}</small></div></li>)}</ul>
          )}
        </section>
      </div>
    </>
  );
}
