import React, { useEffect, useMemo, useState } from "react";
import { CloudBackupIcon, DownloadIcon, FileIcon, LockIcon, ShieldIcon, TrashIcon, UserIcon } from "../components/Icons";
import { exportYear4Excel, exportYear4Pdf, selectYear4ExportData } from "../year4Export";
import ActivityIcon from "../components/ActivityIcon";
import { formatYear4Timestamp } from "../year4Time";
import Year4QualityDashboard from "./Year4QualityDashboard";
import Year4RotationManager from "./Year4RotationManager";
import CurriculumManager from "./CurriculumManager";
import AdminStaffManager from "./AdminStaffManager";
import AdminStudentManager from "./AdminStudentManager";
import AdminOverviewDashboard from "./AdminOverviewDashboard";

export default function Year4Admin({ students, staff = [], entries, approvalEvents, rotations = [], certifications = [], curricula = [], activities = [], enrollments = [], onDelete, onDeleteEntry, onDeleteAvatars, onDeleteStudents, onSaveStudent, onSaveStaff, onSaveRotation, onSaveCurriculum, onImportActivities, onPublishCurriculum, onBackup }) {
  const groups = useMemo(() => [...new Set([...students.map((student) => student.studentGroup), ...enrollments.map((item) => item.groupCode)].filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "th", { numeric: true })), [students, enrollments]);
  const [filter, setFilter] = useState({ scope: "all", studentId: students[0]?.id || "", studentGroup: groups[0] || "", curriculumId: "all" });
  const [password, setPassword] = useState("");
  const [avatarFilter, setAvatarFilter] = useState({ scope: "student", studentId: students[0]?.id || "", studentGroup: groups[0] || "" });
  const [avatarPassword, setAvatarPassword] = useState("");
  const [entryPassword, setEntryPassword] = useState("");
  const [studentDeleteIds, setStudentDeleteIds] = useState([]);
  const [studentDeletePassword, setStudentDeletePassword] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState({ text: "", error: false });
  const selected = useMemo(() => selectYear4ExportData(students, entries, approvalEvents, filter, activities, enrollments), [students, entries, approvalEvents, filter, activities, enrollments]);
  const selectedStudent = students.find((student) => student.id === filter.studentId);
  const selectedCurriculum = curricula.find((item) => item.id === filter.curriculumId);
  const scopeLabel = `${filter.scope === "all" ? "นักศึกษาทุกคน" : filter.scope === "group" ? `นักศึกษากลุ่ม ${filter.studentGroup}` : selectedStudent?.name || "นักศึกษารายคน"}${selectedCurriculum ? ` · Year ${selectedCurriculum.classYear}/${selectedCurriculum.academicYear}` : " · ทุก Curriculum"}`;
  const avatarStudents = useMemo(() => students.filter((student) => avatarFilter.scope === "student"
    ? student.id === avatarFilter.studentId
    : student.studentGroup === avatarFilter.studentGroup), [students, avatarFilter]);
  const avatarCount = avatarStudents.filter((student) => student.avatarPath).length;

  useEffect(() => {
    setFilter((current) => ({
      ...current,
      studentId: students.some((student) => student.id === current.studentId) ? current.studentId : students[0]?.id || "",
      studentGroup: groups.includes(current.studentGroup) ? current.studentGroup : groups[0] || "",
    }));
    setAvatarFilter((current) => ({
      ...current,
      studentId: students.some((student) => student.id === current.studentId) ? current.studentId : students[0]?.id || "",
      studentGroup: groups.includes(current.studentGroup) ? current.studentGroup : groups[0] || "",
    }));
  }, [students, groups]);

  async function exportExcel() {
    setBusy("excel"); setMessage({ text: "", error: false });
    try {
      const fileName = await exportYear4Excel(selected, filter);
      setMessage({ text: `ดาวน์โหลด ${fileName} แล้ว`, error: false });
    } catch (error) {
      setMessage({ text: `สร้าง Excel ไม่สำเร็จ: ${error.message}`, error: true });
    } finally {
      setBusy("");
    }
  }

  async function deleteAvatars(event) {
    event.preventDefault();
    if (!avatarCount) return setMessage({ text: "ไม่พบรูปนักศึกษาในขอบเขตที่เลือก", error: true });
    const avatarScopeLabel = avatarFilter.scope === "group"
      ? `นักศึกษากลุ่ม ${avatarFilter.studentGroup}`
      : students.find((student) => student.id === avatarFilter.studentId)?.name || "นักศึกษาที่เลือก";
    if (!window.confirm(`ยืนยันลบรูปนักศึกษา ${avatarCount} ไฟล์ของ ${avatarScopeLabel}? การดำเนินการนี้ย้อนกลับไม่ได้`)) return;
    setBusy("delete-avatars"); setMessage({ text: "", error: false });
    try {
      const result = await onDeleteAvatars(avatarFilter, avatarPassword);
      setAvatarPassword("");
      setMessage({ text: `ลบรูปนักศึกษา ${result.deletedCount || 0} ไฟล์แล้ว Logbook และบัญชี Student ยังคงอยู่`, error: false });
    } catch (error) {
      setMessage({ text: error.message || "ลบรูปนักศึกษาไม่สำเร็จ", error: true });
    } finally {
      setBusy("");
    }
  }

  function exportPdf() {
    setMessage({ text: "", error: false });
    try {
      exportYear4Pdf(selected, filter);
      setMessage({ text: "เปิดหน้าต่าง Print แล้ว กรุณาเลือก Save as PDF", error: false });
    } catch (error) {
      setMessage({ text: error.message, error: true });
    }
  }

  async function backupToGoogleDrive() {
    setBusy("backup"); setMessage({ text: "", error: false });
    try {
      const result = await onBackup();
      setMessage({ text: `สำรอง ${result.fileNames?.join(" และ ") || result.fileName || "Surgery Logbook"} ไป Google Drive สำเร็จ`, error: false });
      if (result.folderUrl) window.open(result.folderUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage({ text: error.message || "สำรองข้อมูลไป Google Drive ไม่สำเร็จ", error: true });
    } finally {
      setBusy("");
    }
  }

  async function deleteData(event) {
    event.preventDefault();
    if (!selected.entries.length) return setMessage({ text: "ไม่มีข้อมูล Logbook ในขอบเขตที่เลือก", error: true });
    if (!window.confirm(`ยืนยันลบข้อมูล Logbook ${selected.entries.length} รายการของ ${scopeLabel}? การดำเนินการนี้ย้อนกลับไม่ได้`)) return;
    setBusy("delete"); setMessage({ text: "", error: false });
    try {
      const result = await onDelete(filter, password);
      setPassword("");
      setMessage({ text: `ลบ Logbook ${result.deletedCount || 0} รายการแล้ว บัญชี Student ยังคงอยู่`, error: false });
    } catch (error) {
      setMessage({ text: error.message || "ลบข้อมูลไม่สำเร็จ", error: true });
    } finally {
      setBusy("");
    }
  }

  async function deleteEntry(entry) {
    if (!entryPassword) return setMessage({ text: "กรุณากรอกรหัสผ่าน Admin", error: true });
    const activity = entries.find((item) => item.id === entry.id);
    if (!window.confirm(`ยืนยันลบหัตถการวันที่ ${entry.date} ของ ${selectedStudent?.name || "นักศึกษาที่เลือก"}? การดำเนินการนี้ย้อนกลับไม่ได้`)) return;
    setBusy(`entry-${entry.id}`); setMessage({ text: "", error: false });
    try { await onDeleteEntry(activity, entryPassword); setEntryPassword(""); setMessage({ text: "ลบหัตถการที่เลือกแล้ว โดยไม่กระทบรายการอื่น", error: false }); }
    catch (error) { setMessage({ text: error.message || "ลบหัตถการไม่สำเร็จ", error: true }); }
    finally { setBusy(""); }
  }

  async function deleteStudentAccounts(event) {
    event.preventDefault();
    if (!studentDeleteIds.length) return setMessage({ text: "กรุณาเลือก Student ที่ต้องการลบ", error: true });
    const names = students.filter((student) => studentDeleteIds.includes(student.id)).map((student) => student.name).join(", ");
    if (!window.confirm(`ยืนยันลบบัญชี Student ${studentDeleteIds.length} คน (${names}) รวม Auth, Logbook, Enrollment และรูปใน Storage? การดำเนินการนี้ย้อนกลับไม่ได้`)) return;
    setBusy("delete-students"); setMessage({ text: "", error: false });
    try {
      const result = await onDeleteStudents(studentDeleteIds, studentDeletePassword);
      setStudentDeleteIds([]); setStudentDeletePassword("");
      setMessage({ text: `ลบบัญชี Student ${result.deletedCount || 0} คน และรูป ${result.deletedAvatarCount || 0} ไฟล์แล้ว`, error: false });
    } catch (error) { setMessage({ text: error.message || "ลบบัญชี Student ไม่สำเร็จ", error: true }); }
    finally { setBusy(""); }
  }

  return (
    <>
      <div className="page-heading"><div><h1>จัดการข้อมูล Logbook</h1><p>จัดการ Curriculum, Staff, Student และประวัติ Logbook ด้วยสิทธิ์ Admin</p></div></div>

      <AdminOverviewDashboard students={students} entries={entries} activities={activities} rotations={rotations} curricula={curricula} />

      <Year4QualityDashboard students={students} entries={entries} activities={activities} rotations={rotations} />

      <CurriculumManager curricula={curricula} activities={activities} onSaveCurriculum={onSaveCurriculum} onImportActivities={onImportActivities} onPublish={onPublishCurriculum} />

      <AdminStudentManager students={students} curricula={curricula} onSave={onSaveStudent} />

      <AdminStaffManager staff={staff} curricula={curricula} onSave={onSaveStaff} />

      <Year4RotationManager curricula={curricula} rotations={rotations} onSave={onSaveRotation} />

      <section className="content-panel admin-filter-panel">
        <div className="section-title"><div><h2>เลือกขอบเขตข้อมูล</h2><p>ใช้ตัวกรองเดียวกันสำหรับ PDF, Excel และการลบข้อมูล</p></div><ShieldIcon size={26} /></div>
        <div className="admin-filter-grid">
          <label>Curriculum<select value={filter.curriculumId} onChange={(event) => setFilter((current) => ({ ...current, curriculumId: event.target.value }))}><option value="all">ทุก Curriculum / ทุกชั้นปี</option>{curricula.map((item) => <option key={item.id} value={item.id}>Year {item.classYear} · {item.academicYear} · {item.name}</option>)}</select></label>
          <label>ขอบเขต<select value={filter.scope} onChange={(event) => setFilter((current) => ({ ...current, scope: event.target.value }))}><option value="all">นักศึกษาทุกคน</option><option value="student">นักศึกษารายคน</option><option value="group">ตามกลุ่ม Student</option></select></label>
          {filter.scope === "student" && <label>นักศึกษา<select value={filter.studentId} onChange={(event) => setFilter((current) => ({ ...current, studentId: event.target.value }))}>{students.map((student) => <option key={student.id} value={student.id}>{student.studentGroup ? `กลุ่ม ${student.studentGroup} · ` : ""}{student.studentCode} · {student.name}</option>)}</select></label>}
          {filter.scope === "group" && <label>กลุ่มที่<select value={filter.studentGroup} onChange={(event) => setFilter((current) => ({ ...current, studentGroup: event.target.value }))}>{groups.map((group) => <option key={group} value={group}>กลุ่ม {group}</option>)}</select></label>}
        </div>
        <div className="admin-scope-summary">
          <span><UserIcon size={18} /><strong>{selected.students.length}</strong> นักศึกษา</span>
          <span><FileIcon size={18} /><strong>{selected.entries.length}</strong> รายการ Logbook</span>
          <span><ShieldIcon size={18} /><strong>{selected.entries.filter((entry) => entry.status === "approved").length}</strong> อนุมัติแล้ว</span>
        </div>
      </section>

      <section className="content-panel admin-backup-panel">
        <div className="section-title"><div><h2>สำรองข้อมูล Google Drive</h2><p>สำรองข้อมูล Logbook ทั้งระบบไปยังบัญชี edusurgcmu@gmail.com</p></div><CloudBackupIcon size={28} /></div>
        <div className="admin-backup-body">
          <p>ระบบจะสร้างทั้ง Excel และ PDF พร้อม Students, Logbook, Category, Approval Audit, รายงานคุณภาพ, ความผิดปกติ และ Timestamp ตอนนักศึกษาส่ง/Staff อนุมัติ</p>
          <button className="primary-button with-icon" type="button" onClick={backupToGoogleDrive} disabled={busy || !onBackup}><CloudBackupIcon size={18} />{busy === "backup" ? "กำลังสำรองไป Google Drive…" : "สำรองข้อมูลทั้งหมด"}</button>
        </div>
      </section>

      <div className="admin-action-grid">
        <section className="content-panel admin-export-panel">
          <div className="section-title"><div><h2>Export ข้อมูล</h2><p>{scopeLabel}</p></div><DownloadIcon size={26} /></div>
          <div className="admin-export-actions">
            <button className="primary-button with-icon" onClick={exportExcel} disabled={busy || !selected.students.length}><FileIcon size={18} />{busy === "excel" ? "กำลังสร้าง Excel…" : "ดาวน์โหลด Excel"}</button>
            <button className="secondary-button with-icon" onClick={exportPdf} disabled={busy || !selected.students.length}><FileIcon size={18} />พิมพ์ / บันทึก PDF</button>
          </div>
          <p className="admin-help">Excel มี Summary, Students, Logbook และ Approval Audit ส่วน PDF จัดหน้าแยกตามนักศึกษา</p>
        </section>

        <form className="content-panel admin-delete-panel" onSubmit={deleteData}>
          <div className="section-title"><div><h2>ลบข้อมูล Logbook</h2><p>{scopeLabel}</p></div><TrashIcon size={26} /></div>
          <div className="admin-delete-body">
            <div className="danger-note"><strong>ลบเฉพาะ Logbook และ Approval Audit ที่เกี่ยวข้อง</strong><span>บัญชี Student, รูปนักศึกษา และข้อมูล Auth จะไม่ถูกลบ</span></div>
            <label>รหัสผ่าน Admin เพื่อยืนยัน<div className="input-wrap"><LockIcon size={19} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></div></label>
            <button className="danger-button with-icon" type="submit" disabled={busy || !password || !selected.entries.length}><TrashIcon size={18} />{busy === "delete" ? "กำลังตรวจรหัสผ่านและลบ…" : `ลบ ${selected.entries.length} รายการ`}</button>
          </div>
        </form>
      </div>

      <section className="content-panel admin-entry-delete-panel">
        <div className="section-title"><div><h2>ลบข้อมูลรายหัตถการ</h2><p>เลือกขอบเขต “นักศึกษารายคน” ด้านบน แล้วลบเฉพาะรายการที่ต้องการ</p></div><TrashIcon size={26} /></div>
        {filter.scope !== "student" ? <div className="admin-entry-empty">กรุณาเลือกขอบเขตเป็น “นักศึกษารายคน” ก่อน</div> : <>
          <div className="admin-entry-password"><label>รหัสผ่าน Admin เพื่อยืนยัน<div className="input-wrap"><LockIcon size={19} /><input type="password" value={entryPassword} onChange={(event) => setEntryPassword(event.target.value)} autoComplete="current-password" /></div></label></div>
          <div className="admin-entry-list">{selected.entries.map((entry) => <div key={entry.id}><span className="admin-entry-icon"><ActivityIcon activityType={entry.activityType} size={20} /></span><div><strong>{entry.date} · {entry.procedureName || entry.activityTitle || entry.diagnosis || entry.activityType}</strong><small>นักศึกษาบันทึก {formatYear4Timestamp(entry.submittedAt)} · Staff อนุมัติ {formatYear4Timestamp(entry.approvedAt)}</small></div><button className="danger-button with-icon" type="button" onClick={() => deleteEntry(entry)} disabled={busy || !entryPassword}><TrashIcon size={17} />{busy === `entry-${entry.id}` ? "กำลังลบ…" : "ลบรายการนี้"}</button></div>)}{!selected.entries.length && <div className="admin-entry-empty">นักศึกษาคนนี้ยังไม่มีรายการ Logbook</div>}</div>
        </>}
      </section>

      <form className="content-panel admin-delete-panel" onSubmit={deleteAvatars}>
        <div className="section-title"><div><h2>ลบรูปนักศึกษาใน Supabase Storage</h2><p>เลือกได้เป็นรายคนหรือตามกลุ่ม Student</p></div><TrashIcon size={26} /></div>
        <div className="admin-filter-grid">
          <label>ขอบเขตรูป<select value={avatarFilter.scope} onChange={(event) => setAvatarFilter((current) => ({ ...current, scope: event.target.value }))}><option value="student">นักศึกษารายคน</option><option value="group">ตามกลุ่ม Student</option></select></label>
          {avatarFilter.scope === "student" && <label>นักศึกษา<select value={avatarFilter.studentId} onChange={(event) => setAvatarFilter((current) => ({ ...current, studentId: event.target.value }))}>{students.map((student) => <option key={student.id} value={student.id}>{student.studentGroup ? `กลุ่ม ${student.studentGroup} · ` : ""}{student.studentCode} · {student.name}</option>)}</select></label>}
          {avatarFilter.scope === "group" && <label>กลุ่มที่<select value={avatarFilter.studentGroup} onChange={(event) => setAvatarFilter((current) => ({ ...current, studentGroup: event.target.value }))}>{groups.map((group) => <option key={group} value={group}>กลุ่ม {group}</option>)}</select></label>}
        </div>
        <div className="admin-delete-body">
          <div className="danger-note"><strong>พบรูป {avatarCount} ไฟล์ จากนักศึกษา {avatarStudents.length} คนในขอบเขตนี้</strong><span>ลบเฉพาะไฟล์ใน bucket student-avatars และล้างค่า avatar_path ไม่ลบ Logbook, บัญชี Student, Auth หรือไฟล์สำรอง Google Drive</span></div>
          <label>รหัสผ่าน Admin เพื่อยืนยัน<div className="input-wrap"><LockIcon size={19} /><input type="password" value={avatarPassword} onChange={(event) => setAvatarPassword(event.target.value)} autoComplete="current-password" required /></div></label>
          <button className="danger-button with-icon" type="submit" disabled={busy || !avatarPassword || !avatarCount || !onDeleteAvatars}><TrashIcon size={18} />{busy === "delete-avatars" ? "กำลังตรวจรหัสผ่านและลบรูป…" : `ลบรูป ${avatarCount} ไฟล์`}</button>
        </div>
      </form>

      <form className="content-panel admin-delete-panel student-account-delete" onSubmit={deleteStudentAccounts}>
        <div className="section-title"><div><h2>ลบบัญชี Student</h2><p>ลบ Auth, Profile, Enrollment, Logbook, Approval Audit และรูปใน Supabase Storage</p></div><TrashIcon size={26} /></div>
        <div className="student-account-list">{students.map((student) => <label key={student.id}><input type="checkbox" checked={studentDeleteIds.includes(student.id)} onChange={(event) => setStudentDeleteIds((current) => event.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id))} /><span><strong>{student.name}</strong><small>{student.studentCode} · {student.email} · กลุ่ม {student.studentGroup || "—"}</small></span></label>)}{!students.length && <div className="admin-entry-empty">ไม่มีบัญชี Student ในระบบ</div>}</div>
        <div className="admin-delete-body">
          <div className="danger-note"><strong>ลบถาวรและย้อนกลับไม่ได้</strong><span>อีเมลจะถูกลบออกจาก Auth ด้วย จึงสามารถนำอีเมลเดิมมาสมัครบัญชีใหม่ได้ภายหลัง</span></div>
          <label>รหัสผ่าน Admin เพื่อยืนยัน<div className="input-wrap"><LockIcon size={19} /><input type="password" value={studentDeletePassword} onChange={(event) => setStudentDeletePassword(event.target.value)} autoComplete="current-password" required /></div></label>
          <button className="danger-button with-icon" type="submit" disabled={busy || !studentDeletePassword || !studentDeleteIds.length || !onDeleteStudents}><TrashIcon size={18} />{busy === "delete-students" ? "กำลังลบบัญชี…" : `ลบ Student ${studentDeleteIds.length} คน`}</button>
        </div>
      </form>

      {message.text && <div className={message.error ? "form-error admin-message" : "form-success admin-message"} role="status">{message.text}</div>}
      <div className="privacy-note">ไฟล์ที่ส่งออกอาจมีรหัสเคสแบบปกปิด โปรดเก็บเฉพาะในพื้นที่ที่ภาควิชาอนุญาต และสำรองข้อมูลก่อนลบจำนวนมาก</div>
    </>
  );
}
