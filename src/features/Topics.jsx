import React, { useState } from "react";
import { PlusIcon } from "../components/Icons";

const today = () => new Date().toISOString().slice(0, 10);

export default function Topics({ topics, onSave }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ date: today(), title: "", category: "Case conference", status: "Planned", note: "" });
  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await onSave(form);
      setForm({ date: today(), title: "", category: "Case conference", status: "Planned", note: "" }); setOpen(false);
    } catch (nextError) {
      setError(nextError.message || "ไม่สามารถบันทึกหัวข้อได้");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="page-heading"><div><h1>Topic</h1><p>ติดตามหัวข้อเรียนรู้ การประชุม และกิจกรรมวิชาการ</p></div><button className="primary-button with-icon" onClick={() => setOpen((value) => !value)}><PlusIcon size={18} />เพิ่มหัวข้อ</button></div>
      {open && <form className="content-panel record-form" onSubmit={submit}><div className="form-grid"><label>วันที่<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>ประเภท<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Case conference</option><option>Journal club</option><option>Lecture</option><option>Research</option><option>Self-study</option></select></label><label className="span-2">หัวข้อ<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label><label>สถานะ<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Planned</option><option>In progress</option><option>Completed</option></select></label><label>หมายเหตุ<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label></div>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>ยกเลิก</button><button className="primary-button" disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึกหัวข้อ"}</button></div></form>}
      <section className="content-panel topic-list">{topics.length === 0 ? <div className="empty-state"><h3>ยังไม่มีหัวข้อที่บันทึก</h3><p>เพิ่มหัวข้อเรียนรู้หรือกิจกรรมวิชาการรายการแรก</p></div> : topics.map((item) => <article key={item.id}><span className={`status ${item.status.toLowerCase().replace(" ", "-")}`}>{item.status}</span><div><h3>{item.title}</h3><p>{item.category} · {item.date}</p>{item.note && <small>{item.note}</small>}</div></article>)}</section>
    </>
  );
}
