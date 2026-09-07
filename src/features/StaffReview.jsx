import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, QrIcon, ScanIcon, SearchIcon, ShieldIcon, XIcon } from "../components/Icons";
import { year4Activities } from "../year4Data";
import { formatYear4Timestamp } from "../year4Time";
import ActivityIcon from "../components/ActivityIcon";
import Year4CertificationPanel from "./Year4CertificationPanel";
import { getStaffApprovalStudentIds } from "../logbookUtils";

function tokenFromValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    return url.pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return normalized;
  }
}

export default function StaffReview({ currentStaff, students, entries, activities = year4Activities, certifications = [], selectedStudentId, onSelectStudent, onReview, onReviewCertification }) {
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [comments, setComments] = useState({});
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [studentApprovalFilter, setStudentApprovalFilter] = useState("all");
  const scannerRef = useRef(null);
  const approvalStudentIds = useMemo(() => getStaffApprovalStudentIds(entries, currentStaff), [entries, currentStaff.id, currentStaff.email]);
  const filteredStudents = useMemo(() => studentApprovalFilter === "all"
    ? students
    : students.filter((student) => approvalStudentIds[studentApprovalFilter]?.has(student.id)), [students, studentApprovalFilter, approvalStudentIds]);
  const selectedStudent = filteredStudents.find((student) => student.id === selectedStudentId) || null;
  const selectedEnrollment = selectedStudent?.activeEnrollment;
  const currentActivities = useMemo(() => activities.filter((item) => !selectedEnrollment || item.curriculumId === selectedEnrollment.curriculumId), [activities, selectedEnrollment]);
  const activityMap = useMemo(() => new Map(currentActivities.map((item) => [item.id, item])), [currentActivities]);
  const activityGroups = useMemo(() => [...new Set(currentActivities.map((item) => item.group))], [currentActivities]);
  const pending = entries.filter((entry) => entry.status === "submitted"
    && [currentStaff.id, currentStaff.email].includes(entry.selectedApproverId)
    && (!selectedStudent || entry.studentId === selectedStudent.id)
    && (!selectedEnrollment || entry.enrollmentId === selectedEnrollment.id)
    && (categoryFilter === "all" || activityMap.get(entry.activityType)?.group === categoryFilter));

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return filteredStudents.slice(0, 8);
    return filteredStudents.filter((student) => [student.name, student.studentCode, student.qrToken].some((value) => String(value || "").toLocaleLowerCase().includes(needle))).slice(0, 8);
  }, [query, filteredStudents]);

  function resolveStudent(scannedValue) {
    const token = tokenFromValue(scannedValue).toLocaleLowerCase();
    const student = students.find((item) => item.qrToken.toLocaleLowerCase() === token || item.qrToken.toLocaleLowerCase().startsWith(token));
    if (!student) {
      setScannerError("ไม่พบ QR นี้ในรายชื่อนักศึกษาที่ได้รับอนุญาต");
      return false;
    }
    setStudentApprovalFilter("all");
    onSelectStudent(student.id);
    setQuery(student.studentCode);
    const submittedForOtherStaff = entries.some((entry) => entry.studentId === student.id && entry.status === "submitted" && ![currentStaff.id, currentStaff.email].includes(entry.selectedApproverId));
    const submittedForCurrentStaff = entries.some((entry) => entry.studentId === student.id && entry.status === "submitted" && [currentStaff.id, currentStaff.email].includes(entry.selectedApproverId));
    if (submittedForOtherStaff && !submittedForCurrentStaff) {
      window.alert("รายชื่ออาจารย์ approve ไม่ตรงกับที่ระบุในหัตถการ");
      setMessage("รายชื่ออาจารย์ approve ไม่ตรงกับที่ระบุในหัตถการ");
      return true;
    }
    setMessage(`พบ ${student.name} กรุณาตรวจยืนยันชื่อก่อนอนุมัติ`);
    return true;
  }

  useEffect(() => {
    const nextStudentId = filteredStudents.some((student) => student.id === selectedStudentId)
      ? selectedStudentId
      : filteredStudents[0]?.id || "";
    if (nextStudentId !== selectedStudentId) onSelectStudent(nextStudentId);
  }, [filteredStudents, selectedStudentId, onSelectStudent]);

  useEffect(() => {
    if (!scanning) return undefined;
    let disposed = false;
    let scanner;
    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (disposed) return;
      scanner = new Html5Qrcode("year4-qr-reader");
      scannerRef.current = scanner;
      return scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodedText) => {
          if (!resolveStudent(decodedText)) return;
          await scanner.stop().catch(() => {});
          setScanning(false);
        },
        () => {},
      );
    }).catch((error) => {
      setScannerError(error?.message?.includes("Permission") ? "ไม่ได้รับสิทธิ์ใช้กล้อง กรุณาอนุญาตกล้องหรือค้นหาด้วยรหัสนักศึกษา" : "ไม่สามารถเปิดกล้องได้ กรุณาใช้ช่องค้นหาแทน");
      setScanning(false);
    });
    return () => {
      disposed = true;
      if (scannerRef.current?.isScanning) scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    };
  }, [scanning]);

  async function review(entry, decision) {
    const comment = comments[entry.id] || "";
    if (decision === "rejected" && !comment.trim()) {
      setMessage("กรุณาระบุเหตุผลก่อนส่งกลับแก้ไข");
      return;
    }
    setBusyId(entry.id);
    setMessage("");
    try {
      await onReview(entry, decision, comment);
      setMessage(decision === "approved" ? "อนุมัติรายการและบันทึก audit trail แล้ว" : "ส่งรายการกลับให้นักศึกษาแก้ไขแล้ว");
      setComments((current) => ({ ...current, [entry.id]: "" }));
    } catch (error) {
      if (error.message === "รายชื่ออาจารย์ approve ไม่ตรงกับที่ระบุในหัตถการ") window.alert(error.message);
      setMessage(error.message || "ไม่สามารถบันทึกผลการประเมินได้");
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      <div className="page-heading"><div><h1>ตรวจและอนุมัติ Logbook</h1><p>แสดงเฉพาะรายการที่นักศึกษาเลือก {currentStaff.name} เป็นผู้อนุมัติ</p></div><button className="primary-button with-icon" onClick={() => { setScannerError(""); setScanning((value) => !value); }}>{scanning ? <XIcon size={18} /> : <ScanIcon size={18} />}{scanning ? "ปิดกล้อง" : "สแกน QR"}</button></div>

      {scanning && <section className="content-panel scanner-panel"><div id="year4-qr-reader" /><p>วาง QR ของนักศึกษาให้อยู่ในกรอบ</p></section>}
      {scannerError && <div className="form-error" role="alert">{scannerError}</div>}
      {message && <div className="review-message" role="status">{message}</div>}

      <div className="staff-review-layout">
        <aside className="content-panel student-finder">
          <div className="section-title"><div><h2>เลือกนักศึกษา</h2><p>ตรวจชื่อและรหัสก่อนประเมิน</p></div></div>
          <label className="staff-student-status-filter">สถานะการอนุมัติ
            <select value={studentApprovalFilter} onChange={(event) => setStudentApprovalFilter(event.target.value)}>
              <option value="all">Student ทั้งหมด ({students.length})</option>
              <option value="pending">มีรายการรอฉันอนุมัติ ({approvalStudentIds.pending.size})</option>
              <option value="approved">มีรายการอนุมัติแล้ว ({approvalStudentIds.approved.size})</option>
            </select>
          </label>
          <label className="search-field"><SearchIcon size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ชื่อ รหัสนักศึกษา หรือรหัสใต้ QR" /></label>
          <div className="student-result-list">{matches.map((student) => <button key={student.id} className={selectedStudent?.id === student.id ? "active" : ""} onClick={() => { const mismatch = entries.some((entry) => entry.studentId === student.id && entry.status === "submitted" && ![currentStaff.id, currentStaff.email].includes(entry.selectedApproverId)); const assigned = entries.some((entry) => entry.studentId === student.id && entry.status === "submitted" && [currentStaff.id, currentStaff.email].includes(entry.selectedApproverId)); if (mismatch && !assigned) window.alert("รายชื่ออาจารย์ approve ไม่ตรงกับที่ระบุในหัตถการ"); onSelectStudent(student.id); }}><span>{student.name.slice(0, 1)}</span><div><strong>{student.name}</strong><small>{student.studentCode}</small></div></button>)}</div>
        </aside>

        <section className="review-queue">
          <div className="review-category-filter">
            <label>หมวดกิจกรรม
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="all">ทุกหมวด</option>
                {activityGroups.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
            </label>
            <span>{pending.length} รายการรออนุมัติ</span>
          </div>
          {selectedStudent ? (
            <div className="student-identity-banner"><span>{selectedStudent.name.slice(0, 1)}</span><div><h2>{selectedStudent.name}</h2><p>{selectedStudent.studentCode} · Year {selectedStudent.classYear || 4} · ปีการศึกษา {selectedStudent.academicYear || selectedStudent.cohortYear}</p></div><QrIcon size={30} /></div>
          ) : <div className="content-panel empty-state"><QrIcon size={32} /><h3>เลือกหรือสแกนนักศึกษาก่อน</h3><p>ระบบจะแสดงเฉพาะรายการที่นักศึกษาส่งมาแล้ว</p></div>}

          {selectedStudent && pending.length === 0 && <div className="content-panel empty-state"><CheckIcon size={32} /><h3>ไม่มีรายการรออนุมัติ</h3><p>รายการใหม่จะแสดงหลัง Student กดส่งให้ Staff</p></div>}

          {selectedStudent && pending.map((entry) => {
            const activity = activityMap.get(entry.activityType);
            return (
              <article className="content-panel review-card" key={entry.id}>
                <div className="review-card-head"><div><span>{activity?.group}</span><h2><ActivityIcon activityType={entry.activityType} size={22} />{activity?.title || entry.activityType}</h2><p>{entry.date}{entry.weekNumber ? ` · สัปดาห์ที่ ${entry.weekNumber}` : ""}</p><small className="review-submitted-at"><CheckIcon size={14} />นักศึกษาบันทึก: {formatYear4Timestamp(entry.submittedAt)}</small></div><ShieldIcon size={28} /></div>
                <dl><div><dt>หน่วย/Ward</dt><dd>{entry.unitName || "—"}</dd></div><div><dt>รหัสเคส</dt><dd>{entry.patientReference || "—"}</dd></div><div><dt>Diagnosis/ประสบการณ์</dt><dd>{entry.diagnosis || "—"}</dd></div><div><dt>Procedure/หัวข้อ</dt><dd>{entry.procedureName || entry.activityTitle || "—"}</dd></div><div><dt>ผู้ควบคุมที่ระบุ</dt><dd>{entry.supervisorName || "—"}</dd></div><div><dt>รายละเอียด</dt><dd>{entry.detail || "—"}</dd></div></dl>
                <label>ความคิดเห็นของผู้ประเมิน <span className="field-optional">จำเป็นเมื่อส่งกลับแก้ไข</span><textarea rows="3" value={comments[entry.id] || ""} onChange={(event) => setComments((current) => ({ ...current, [entry.id]: event.target.value }))} placeholder="ระบุข้อเสนอแนะหรือเหตุผลที่ต้องแก้ไข" /></label>
                <div className="review-actions"><button className="danger-button" onClick={() => review(entry, "rejected")} disabled={busyId === entry.id}>ส่งกลับแก้ไข</button><button className="primary-button with-icon" onClick={() => review(entry, "approved")} disabled={busyId === entry.id}><CheckIcon size={18} />ยืนยันอนุมัติ</button></div>
              </article>
            );
          })}
          {selectedStudent && (() => { const certification = certifications.find((item) => item.enrollmentId === selectedEnrollment?.id && item.status === "submitted" && item.selectedCertifierEmail === currentStaff.email); return certification ? <Year4CertificationPanel user={currentStaff} student={selectedStudent} entries={entries} activities={currentActivities} certification={certification} onReview={onReviewCertification} /> : null; })()}
        </section>
      </div>
    </>
  );
}
