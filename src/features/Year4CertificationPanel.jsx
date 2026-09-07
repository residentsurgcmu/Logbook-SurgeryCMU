import React, { useMemo, useState } from "react";
import { CertificateIcon, CheckIcon, LockIcon } from "../components/Icons";
import { progressSummary } from "../year4Analytics";
import { formatYear4Timestamp } from "../year4Time";

export default function Year4CertificationPanel({ user, student, entries, activities = [], staff = [], certification, onSubmit, onReview }) {
  const studentEntries = useMemo(() => entries.filter((entry) => entry.studentId === student.id && (!student.activeEnrollment || entry.enrollmentId === student.activeEnrollment.id)), [entries, student.id, student.activeEnrollment]);
  const passPercent = student.activeEnrollment?.passPercent || 80;
  const progress = useMemo(() => progressSummary(studentEntries, activities, passPercent), [studentEntries, activities, passPercent]);
  const [staffEmail, setStaffEmail] = useState(staff[0]?.email || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const unresolved = studentEntries.filter((entry) => ["submitted", "rejected"].includes(entry.status)).length;
  const eligible = progress.percent >= passPercent && unresolved === 0;
  const canSubmit = !certification || ["returned", "reopened"].includes(certification.status);
  async function submit() { setBusy(true); setMessage(""); try { await onSubmit(staffEmail); setMessage("ส่ง Logbook ฉบับสมบูรณ์ให้ Staff รับรองแล้ว"); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  async function review(status) { if (status === "returned" && !note.trim()) return setMessage("กรุณาระบุเหตุผลที่ส่งกลับ"); setBusy(true); setMessage(""); try { await onReview(certification, status, note); setMessage(status === "certified" ? "รับรองและล็อก Logbook แล้ว" : "ส่งกลับให้นักศึกษาแก้ไขแล้ว"); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  return <section className="content-panel certification-panel"><div className="section-title"><div><h2>ปิดและรับรอง Logbook</h2><p>รับรองเมื่อความก้าวหน้าครบอย่างน้อย {passPercent}% และไม่มีรายการค้าง</p></div><CertificateIcon size={27} /></div>
    <div className="certification-body">
      <div className="certification-progress"><strong>{progress.completed}/{progress.required} · {progress.percent}%</strong><span>{unresolved ? `มี ${unresolved} รายการที่ต้องจัดการก่อน` : "ไม่มีรายการค้างหรือส่งกลับ"}</span></div>
      {certification ? <div className={`certification-status ${certification.status}`}><LockIcon size={19} /><div><strong>{certification.status === "certified" ? "รับรองและล็อกแล้ว" : certification.status === "submitted" ? "รอ Staff รับรอง" : certification.status === "returned" ? "ส่งกลับแก้ไข" : "เปิดแก้ไขโดย Admin"}</strong><span>ส่งเมื่อ {formatYear4Timestamp(certification.submittedAt)}{certification.certifiedAt ? ` · รับรองเมื่อ ${formatYear4Timestamp(certification.certifiedAt)}` : ""}</span>{certification.certifierNote && <small>{certification.certifierNote}</small>}</div></div> : null}
      {user.role === "student" && canSubmit && <div className="certification-actions"><label>Staff ผู้รับรอง<select value={staffEmail} onChange={(event) => setStaffEmail(event.target.value)}>{staff.map((person) => <option key={person.email} value={person.email}>{person.name}</option>)}</select></label><button className="primary-button with-icon" onClick={submit} disabled={busy || !eligible || !staffEmail}><CertificateIcon size={18} />{certification ? "ส่ง Logbook เพื่อรับรองอีกครั้ง" : "ส่ง Logbook ฉบับสมบูรณ์"}</button></div>}
      {user.role === "staff" && certification?.status === "submitted" && <div className="certification-review"><label>หมายเหตุ<textarea rows="2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="ระบุเมื่อส่งกลับแก้ไข" /></label><div><button className="danger-button" onClick={() => review("returned")} disabled={busy}>ส่งกลับแก้ไข</button><button className="primary-button with-icon" onClick={() => review("certified")} disabled={busy}><CheckIcon size={18} />รับรอง Logbook</button></div></div>}
      {message && <div className="certification-message" role="status">{message}</div>}
    </div></section>;
}
