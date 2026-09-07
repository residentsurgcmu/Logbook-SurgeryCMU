import React, { useMemo, useState } from "react";
import { BookIcon, CheckIcon, ClockIcon, PlusIcon } from "../components/Icons";
import { statusLabels, year4Activities } from "../year4Data";
import { formatYear4Timestamp } from "../year4Time";
import ActivityIcon from "../components/ActivityIcon";

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = (activities = year4Activities) => ({
  activityType: activities[0]?.id || "",
  date: today(),
  weekNumber: "",
  unitName: "",
  patientReference: "",
  diagnosis: "",
  procedureName: "",
  participation: "Observe",
  activityTitle: "",
  selectedApproverId: "",
  detail: "",
});

const fromEntry = (entry) => ({ ...entry, weekNumber: entry.weekNumber || "" });

export default function Year4Logbook({ entries, activities = year4Activities, staff, onSave, onUpdate, onSubmitted, locked = false }) {
  const classYear = activities.find((item) => item.classYear)?.classYear || 4;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(() => emptyForm(activities));
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activityMap = useMemo(() => new Map(activities.map((item) => [item.id, item])), [activities]);
  const activityGroups = useMemo(() => [...new Set(activities.map((item) => item.group))], [activities]);
  const activity = activityMap.get(form.activityType) || activities[0] || year4Activities[0];
  const isEditing = Boolean(form.id);
  const filtered = useMemo(() => entries.filter((entry) => {
    const activityGroup = activityMap.get(entry.activityType)?.group;
    return (statusFilter === "all" || entry.status === statusFilter)
      && (categoryFilter === "all" || activityGroup === categoryFilter);
  }), [entries, statusFilter, categoryFilter, activityMap]);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }

  function closeForm() {
    setShowForm(false);
    setForm(emptyForm(activities));
    setError("");
  }

  function openEdit(entry) {
    setForm(fromEntry(entry));
    setShowForm(true);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validate() {
    const missing = [];
    if (!form.activityType) missing.push("ประเภทกิจกรรม");
    if (!form.date) missing.push("วันที่");
    if (activity.fields.includes("week") && !form.weekNumber) missing.push("สัปดาห์");
    if (activity.fields.includes("patient") && !form.patientReference.trim()) missing.push("รหัสเคส/HN แบบปกปิด");
    if (activity.fields.includes("diagnosis") && !form.diagnosis.trim()) missing.push("Diagnosis/ประสบการณ์");
    if (activity.fields.includes("procedure") && !form.procedureName.trim()) missing.push("Procedure");
    if (activity.fields.includes("unit") && !form.unitName.trim()) missing.push("หน่วย/Ward");
    if (activity.fields.includes("title") && !form.activityTitle.trim()) missing.push("หัวข้อกิจกรรม");
    if (!form.detail.trim()) missing.push("รายละเอียดกิจกรรม");
    if (!form.selectedApproverId) missing.push("Staff ผู้อนุมัติ");
    if (missing.length) {
      setError(`กรุณากรอกข้อมูลที่จำเป็นให้ครบ: ${missing.join(", ")}`);
      return false;
    }
    return true;
  }

  async function persist(status) {
    if (!validate()) return;
    setSaving(true);
    setError("");
    try {
      const saved = isEditing ? await onUpdate(form, status) : await onSave(form, status);
      closeForm();
      if (status === "submitted") onSubmitted(saved);
    } catch (nextError) {
      setError(nextError.message || "ไม่สามารถบันทึก Logbook ได้");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div><h1>Logbook นักศึกษา</h1><p>บันทึกกิจกรรมตามสมุด Logbook ศัลยศาสตร์ ชั้นปีที่ {classYear}</p></div>
        {!locked && <button className="primary-button with-icon" onClick={() => showForm ? closeForm() : setShowForm(true)}><PlusIcon size={18} />{showForm ? "ปิดแบบฟอร์ม" : "เพิ่มกิจกรรม"}</button>}
      </div>

      {locked && <div className="form-success logbook-locked" role="status">Logbook นี้ได้รับการรับรองและล็อกแล้ว หากจำเป็นต้องแก้ไข กรุณาติดต่อ Admin เพื่อเปิดใหม่</div>}

      {showForm && !locked && (
        <section className="content-panel year4-entry-form">
          <div className="form-section-heading"><h2>{isEditing ? "แก้ไขรายการ" : "เพิ่มกิจกรรมใหม่"}</h2><p>กรอกข้อมูลให้ครบและเลือก Staff ผู้อนุมัติก่อนบันทึก</p></div>
          {form.status === "rejected" && <div className="review-alert rejected"><strong>เหตุผลที่ส่งกลับ:</strong> {form.approverComment}</div>}
          <div className="form-grid">
            <label className="span-2">ประเภทกิจกรรม <span className="field-required">จำเป็น</span>
              <select value={form.activityType} onChange={(event) => setField("activityType", event.target.value)} disabled={isEditing}>
                {activities.map((item) => <option key={item.id} value={item.id}>{item.group} · {item.title}</option>)}
              </select>
            </label>
            <label>วันที่ <span className="field-required">จำเป็น</span><input type="date" value={form.date} onChange={(event) => setField("date", event.target.value)} /></label>
            {activity.fields.includes("week") && <label>สัปดาห์ <span className="field-required">จำเป็น</span><select value={form.weekNumber} onChange={(event) => setField("weekNumber", event.target.value)}><option value="">เลือกสัปดาห์</option>{[1,2,3,4,5,6,7,8].map((week) => <option key={week} value={week}>สัปดาห์ที่ {week}</option>)}</select></label>}
            {activity.fields.includes("patient") && <label>รหัสเคส/HN แบบปกปิด <span className="field-required">จำเป็น</span><input value={form.patientReference} onChange={(event) => setField("patientReference", event.target.value)} placeholder="เช่น เคส ••1042" maxLength="80" /></label>}
            {activity.fields.includes("unit") && <label>หน่วย/Ward <span className="field-required">จำเป็น</span><input value={form.unitName} onChange={(event) => setField("unitName", event.target.value)} placeholder="ระบุหน่วยที่ปฏิบัติงาน" maxLength="120" /></label>}
            {activity.fields.includes("diagnosis") && <label className="span-2">Diagnosis หรือประสบการณ์ที่ได้รับ <span className="field-required">จำเป็น</span><input value={form.diagnosis} onChange={(event) => setField("diagnosis", event.target.value)} maxLength="240" /></label>}
            {activity.fields.includes("procedure") && <label className="span-2">Procedure <span className="field-required">จำเป็น</span><input value={form.procedureName} onChange={(event) => setField("procedureName", event.target.value)} maxLength="240" /></label>}
            {activity.fields.includes("title") && <label className="span-2">ชื่อ Conference/หัวข้อที่สอน <span className="field-required">จำเป็น</span><input value={form.activityTitle} onChange={(event) => setField("activityTitle", event.target.value)} maxLength="240" /></label>}
            {activity.fields.includes("participation") && <label>บทบาท <select value={form.participation} onChange={(event) => setField("participation", event.target.value)}><option>Observe</option><option>Assist</option><option>Perform</option></select></label>}
            <label className="span-2">รายละเอียดกิจกรรม <span className="field-required">จำเป็น</span><textarea rows="3" value={form.detail} onChange={(event) => setField("detail", event.target.value)} maxLength="1000" placeholder="สรุปสิ่งที่ได้ปฏิบัติหรือเรียนรู้" /></label>
            <label className="span-2">เลือก Staff ผู้อนุมัติ <span className="field-required">จำเป็น</span>
              <select value={form.selectedApproverId} onChange={(event) => setField("selectedApproverId", event.target.value)}>
                <option value="">เลือก Staff</option>
                {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
              <small className="field-help">เฉพาะ Staff คนที่เลือกเท่านั้นจึงจะอนุมัติรายการนี้ได้</small>
            </label>
          </div>
          <div className="privacy-note">ห้ามระบุชื่อผู้ป่วย เลขบัตรประชาชน หรือข้อมูลที่ระบุตัวบุคคลได้ ใช้เฉพาะรหัสเคส/HN แบบปกปิดตามนโยบายภาควิชา</div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="form-actions">
            <button className="primary-button" type="button" onClick={() => persist("submitted")} disabled={saving || staff.length === 0}>{saving ? "กำลังบันทึก…" : "บันทึกและแสดง QR"}</button>
          </div>
        </section>
      )}

      <div className="logbook-filter-bar">
        <label>หมวดกิจกรรม
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">ทุกหมวด</option>
            {activityGroups.map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
        </label>
        <div className="status-filter" role="tablist" aria-label="กรองสถานะ">
          {[['all','ทั้งหมด'],['draft','ฉบับร่าง'],['submitted','รออนุมัติ'],['approved','อนุมัติแล้ว'],['rejected','ส่งกลับแก้ไข']].map(([value,label]) => <button key={value} className={statusFilter === value ? "active" : ""} onClick={() => setStatusFilter(value)}>{label}</button>)}
        </div>
      </div>

      <section className="entry-list" aria-label="รายการ Logbook">
        {filtered.length === 0 ? <div className="content-panel empty-state"><BookIcon size={30} /><h3>ไม่พบรายการตามตัวกรอง</h3><p>ลองเลือกหมวดกิจกรรมหรือสถานะอื่น</p></div> : filtered.map((entry) => {
          const item = activityMap.get(entry.activityType);
          const editable = entry.status === "draft" || entry.status === "rejected";
          return (
            <article className="content-panel entry-card" key={entry.id}>
              <div className={`entry-status-icon ${entry.status}`}><ActivityIcon activityType={entry.activityType} size={21} /></div>
              <div className="entry-main"><div className="entry-title-line"><h2>{item?.title || entry.activityType}</h2><span className={`status ${entry.status}`}>{statusLabels[entry.status]}</span></div><p>{entry.date}{entry.weekNumber ? ` · สัปดาห์ที่ ${entry.weekNumber}` : ""}{entry.unitName ? ` · ${entry.unitName}` : ""}</p><small>{entry.procedureName || entry.activityTitle || entry.diagnosis || entry.detail || "ไม่มีรายละเอียดเพิ่มเติม"}</small><small className="assigned-staff">Staff ผู้อนุมัติ: {entry.selectedApproverName || "—"}</small><div className="entry-timestamps"><small><ClockIcon size={14} />นักศึกษาบันทึก: {formatYear4Timestamp(entry.submittedAt)}</small>{entry.approvedAt && <small><CheckIcon size={14} />Staff อนุมัติ: {formatYear4Timestamp(entry.approvedAt)}</small>}</div>{entry.status === "rejected" && <div className="inline-rejection">{entry.approverComment}</div>}</div>
              {editable && <button className="text-button entry-edit" onClick={() => openEdit(entry)}>แก้ไข</button>}
            </article>
          );
        })}
      </section>
    </>
  );
}
