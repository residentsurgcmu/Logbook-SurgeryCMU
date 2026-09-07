import React, { useEffect, useMemo, useState } from "react";
import { LockIcon, MailIcon, ShieldIcon, UserIcon } from "../components/Icons";

const emptyForm = { firstName: "", lastName: "", email: "", curriculumId: "", unitName: "", password: "" };

export default function AdminStaffManager({ staff = [], curricula = [], onSave }) {
  const availableCurricula = useMemo(() => curricula.filter((item) => item.status !== "archived"), [curricula]);
  const [form, setForm] = useState(() => ({ ...emptyForm, curriculumId: availableCurricula[0]?.id || "" }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: "", error: false, activationUrl: "" });

  useEffect(() => {
    if (!form.curriculumId && availableCurricula[0]?.id) setForm((current) => ({ ...current, curriculumId: availableCurricula[0].id }));
  }, [availableCurricula, form.curriculumId]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setMessage({ text: "", error: false, activationUrl: "" });
    try {
      const result = await onSave({
        firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim().toLowerCase(),
        assignments: [{ curriculumId: form.curriculumId, unitName: form.unitName.trim() }],
      }, form.password);
      setMessage({ text: `เพิ่ม ${result.staff?.name || "Staff"} (${result.staff?.email || form.email}) แล้ว`, error: false, activationUrl: result.activationUrl || "" });
      setForm({ ...emptyForm, curriculumId: form.curriculumId });
    } catch (error) {
      setMessage({ text: error.message || "เพิ่ม Staff ไม่สำเร็จ", error: true, activationUrl: "" });
    } finally { setBusy(false); }
  }

  return (
    <section className="content-panel staff-manager">
      <div className="section-title"><div><h2>จัดการรายชื่อ Staff</h2><p>เพิ่มชื่อ สกุล และอีเมล พร้อมกำหนดชั้นปีที่ดูแลและหน่วยสำหรับการอนุมัติ</p></div><ShieldIcon size={27} /></div>
      <div className="staff-manager-summary"><strong>{staff.length}</strong><span>รายชื่อ Staff ที่เปิดใช้งานในระบบ</span></div>
      <form className="staff-manager-form" onSubmit={submit}>
        <label>ชื่อ<div className="input-wrap"><UserIcon size={18} /><input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} placeholder="เช่น อ.นพ.สมชาย" required /></div></label>
        <label>นามสกุล<div className="input-wrap"><UserIcon size={18} /><input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} placeholder="นามสกุล" required /></div></label>
        <label>อีเมล<div className="input-wrap"><MailIcon size={18} /><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@example.com" required /></div></label>
        <label>ชั้นปีที่ดูแล<select value={form.curriculumId} onChange={(event) => setForm({ ...form, curriculumId: event.target.value })} required><option value="" disabled>เลือกชั้นปี</option>{availableCurricula.map((item) => <option key={item.id} value={item.id}>ชั้นปีที่ {item.classYear} · ปีการศึกษา {item.academicYear}</option>)}</select></label>
        <label>หน่วย / สาขา<input value={form.unitName} onChange={(event) => setForm({ ...form, unitName: event.target.value })} placeholder="เช่น Trauma, Urology" required /></label>
        <label>รหัสผ่าน Admin<div className="input-wrap"><LockIcon size={18} /><input type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></div></label>
        <button className="primary-button with-icon" type="submit" disabled={busy || !onSave}><ShieldIcon size={18} />{busy ? "กำลังเพิ่ม Staff…" : "เพิ่ม Staff"}</button>
      </form>
      {message.text && <div className={message.error ? "form-error staff-manager-message" : "form-success staff-manager-message"} role="status">{message.text}{message.activationUrl && <><br /><a href={message.activationUrl} target="_blank" rel="noreferrer">เปิดลิงก์ลงทะเบียน Staff</a></>}</div>}
      <details className="staff-directory-list"><summary>ดูรายชื่อ Staff ทั้งหมด ({staff.length})</summary>{staff.map((person) => <div key={person.email}><span><strong>{person.name}</strong><small>{person.email}</small></span><small>{person.curriculumAssignments?.map((item) => item.unitName).filter(Boolean).join(" · ") || "ยังไม่กำหนดหน่วย"}</small></div>)}</details>
    </section>
  );
}
