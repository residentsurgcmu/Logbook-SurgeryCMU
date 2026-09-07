import React, { useEffect, useMemo, useState } from "react";
import { LockIcon, MailIcon, UserIcon } from "../components/Icons";

const emptyForm = { id: "", firstName: "", lastName: "", studentCode: "", email: "", curriculumId: "", studentGroup: "", password: "" };

function splitName(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

export default function AdminStudentManager({ students = [], curricula = [], onSave }) {
  const availableCurricula = useMemo(() => curricula.filter((item) => item.status === "published"), [curricula]);
  const [form, setForm] = useState(() => ({ ...emptyForm, curriculumId: availableCurricula[0]?.id || "" }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: "", error: false });

  useEffect(() => {
    if (!form.curriculumId && availableCurricula[0]?.id) setForm((current) => ({ ...current, curriculumId: availableCurricula[0].id }));
  }, [availableCurricula, form.curriculumId]);

  function startEdit(student) {
    const names = splitName(student.name);
    setForm({
      ...emptyForm,
      id: student.id,
      firstName: names.firstName,
      lastName: names.lastName,
      studentCode: student.studentCode,
      email: student.email,
      curriculumId: student.activeEnrollment?.curriculumId || availableCurricula[0]?.id || "",
      studentGroup: student.studentGroup || "",
    });
    setMessage({ text: "", error: false });
  }

  function resetForm() {
    setForm({ ...emptyForm, curriculumId: availableCurricula[0]?.id || "" });
    setMessage({ text: "", error: false });
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setMessage({ text: "", error: false });
    try {
      const result = await onSave({
        id: form.id,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        studentCode: form.studentCode.trim(),
        email: form.email.trim().toLowerCase(),
        curriculumId: form.curriculumId,
        studentGroup: form.studentGroup.trim(),
      }, form.password);
      const emailDetail = result.setupEmailSent
        ? " ระบบส่งลิงก์ตั้งรหัสผ่านไปทางอีเมลแล้ว"
        : result.created ? " สร้างบัญชีแล้ว แต่ส่งลิงก์ตั้งรหัสผ่านไม่สำเร็จ ให้ Student กด ‘ลืมรหัสผ่าน’" : "";
      setMessage({ text: `${result.created ? "เพิ่ม" : "แก้ไข"} ${result.student?.name || "Student"} สำเร็จ${emailDetail}`, error: false });
      setForm({ ...emptyForm, curriculumId: form.curriculumId });
    } catch (error) {
      setMessage({ text: error.message || "บันทึก Student ไม่สำเร็จ", error: true });
    } finally { setBusy(false); }
  }

  return (
    <section className="content-panel student-manager">
      <div className="section-title"><div><h2>จัดการบัญชี Student</h2><p>เพิ่มหรือแก้ไขชื่อ สกุล รหัสนักศึกษา อีเมล ชั้นปี และกลุ่ม</p></div><UserIcon size={27} /></div>
      <div className="student-manager-summary"><strong>{students.length}</strong><span>บัญชี Student ที่เปิดใช้งาน</span></div>
      <div className="student-manager-layout">
        <form className="student-manager-form" onSubmit={submit}>
          <div className="student-manager-form-title"><strong>{form.id ? "แก้ไขข้อมูล Student" : "เพิ่ม Student ใหม่"}</strong>{form.id && <button type="button" className="text-button" onClick={resetForm}>ยกเลิกการแก้ไข</button>}</div>
          <div className="student-manager-fields">
            <label>ชื่อ<div className="input-wrap"><UserIcon size={18} /><input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} autoComplete="given-name" required /></div></label>
            <label>นามสกุล<div className="input-wrap"><UserIcon size={18} /><input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} autoComplete="family-name" required /></div></label>
            <label>รหัสนักศึกษา<div className="input-wrap"><UserIcon size={18} /><input inputMode="numeric" pattern="[0-9]{6,20}" value={form.studentCode} onChange={(event) => setForm({ ...form, studentCode: event.target.value.replace(/\D/g, "") })} required /></div></label>
            <label>อีเมล<div className="input-wrap"><MailIcon size={18} /><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" required /></div></label>
            <label>ชั้นปี / ปีการศึกษา<select value={form.curriculumId} onChange={(event) => setForm({ ...form, curriculumId: event.target.value })} required><option value="" disabled>เลือกชั้นปี</option>{availableCurricula.map((item) => <option key={item.id} value={item.id}>Year {item.classYear} · {item.academicYear} · {item.name}</option>)}</select></label>
            <label>กลุ่ม Student<input inputMode="numeric" pattern="[0-9]{1,3}" value={form.studentGroup} onChange={(event) => setForm({ ...form, studentGroup: event.target.value.replace(/\D/g, "") })} placeholder="เช่น 1" required /></label>
            <label className="student-manager-password">รหัสผ่าน Admin<div className="input-wrap"><LockIcon size={18} /><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="current-password" required /></div></label>
          </div>
          <button className="primary-button" type="submit" disabled={busy || !availableCurricula.length}>{busy ? "กำลังบันทึก…" : form.id ? "บันทึกการแก้ไข" : "เพิ่ม Student และส่งลิงก์ตั้งรหัสผ่าน"}</button>
          {!availableCurricula.length && <div className="form-error">ต้อง Publish Curriculum ก่อนเพิ่ม Student</div>}
          {message.text && <div className={message.error ? "form-error student-manager-message" : "form-success student-manager-message"} role="status">{message.text}</div>}
        </form>
        <div className="student-manager-list" aria-label="รายชื่อ Student">
          {students.map((student) => <button type="button" key={student.id} className={form.id === student.id ? "active" : ""} onClick={() => startEdit(student)}>
            <span><strong>{student.name}</strong><small>{student.studentCode} · {student.email}</small></span>
            <em>Year {student.activeEnrollment?.classYear || student.classYear || "—"} · กลุ่ม {student.studentGroup || "—"}</em>
          </button>)}
          {!students.length && <div className="admin-entry-empty">ยังไม่มีบัญชี Student</div>}
        </div>
      </div>
    </section>
  );
}
