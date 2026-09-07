import React, { useEffect, useState } from "react";
import { CalendarIcon, CheckIcon } from "../components/Icons";

const emptyForm = { id: "", curriculumId: "", groupCode: "", name: "", startDate: "", endDate: "", status: "open" };

export default function Year4RotationManager({ curricula = [], rotations, onSave }) {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { if (!form.id && !form.curriculumId && curricula.length) setForm((current) => ({ ...current, curriculumId: curricula[0].id })); }, [curricula, form.id, form.curriculumId]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await onSave(form); setMessage("บันทึก Curriculum และ rotation แล้ว"); setForm({ ...emptyForm, curriculumId: form.curriculumId }); }
    catch (error) { setMessage(error.message || "บันทึก rotation ไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  return <section className="content-panel rotation-manager"><div className="section-title"><div><h2>จัดการปีการศึกษา / Rotation</h2><p>กำหนดช่วงวันที่ของแต่ละกลุ่มและสถานะการใช้งาน</p></div><CalendarIcon size={27} /></div>
    <form className="rotation-form" onSubmit={save}>
      <label>Curriculum<select value={form.curriculumId} onChange={(event) => update("curriculumId", event.target.value)} required><option value="">เลือก Curriculum</option>{curricula.map((item) => <option key={item.id} value={item.id}>Year {item.classYear} · {item.academicYear} · {item.name}</option>)}</select></label>
      <label>กลุ่มที่<input value={form.groupCode} onChange={(event) => update("groupCode", event.target.value.replace(/[^0-9A-Za-zก-๙-]/g, ""))} required /></label>
      <label>ชื่อ Rotation<input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="เช่น ศัลยศาสตร์ กลุ่ม 1" required /></label>
      <label>วันเริ่ม<input type="date" value={form.startDate} onChange={(event) => update("startDate", event.target.value)} required /></label>
      <label>วันสิ้นสุด<input type="date" value={form.endDate} onChange={(event) => update("endDate", event.target.value)} required /></label>
      <label>สถานะ<select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="planned">วางแผน</option><option value="open">เปิดใช้งาน</option><option value="closed">ปิดรับรายการ</option><option value="archived">เก็บถาวร</option></select></label>
      <button className="primary-button with-icon" disabled={busy}><CheckIcon size={18} />{busy ? "กำลังบันทึก…" : form.id ? "บันทึกการแก้ไข" : "เพิ่ม Rotation"}</button>
    </form>
    {message && <div className="rotation-message" role="status">{message}</div>}
    <div className="rotation-list">{rotations.map((rotation) => <button type="button" key={rotation.id} onClick={() => setForm(rotation)}><CalendarIcon size={18} /><span><strong>{rotation.name}</strong><small>Year {rotation.classYear || "—"} · ปี {rotation.academicYear || "—"} · กลุ่ม {rotation.groupCode} · {rotation.startDate} ถึง {rotation.endDate}</small></span><em>{rotation.status}</em></button>)}</div>
  </section>;
}
