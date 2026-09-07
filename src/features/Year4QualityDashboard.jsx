import React, { useMemo, useState } from "react";
import { AlertIcon, ChartIcon, ClockIcon, ShieldIcon } from "../components/Icons";
import { programQualitySummary } from "../year4Analytics";

export default function Year4QualityDashboard({ students, entries, activities = [], rotations = [], compact = false, allowYearFilters = true }) {
  const classYears = useMemo(() => [...new Set(students.map((student) => student.classYear).filter(Boolean))].sort((a, b) => a - b), [students]);
  const years = useMemo(() => [...new Set(students.map((student) => student.academicYear || student.cohortYear).filter(Boolean))].sort((a, b) => b - a), [students]);
  const groups = useMemo(() => [...new Set(students.map((student) => student.studentGroup).filter(Boolean))].sort((a, b) => Number(a) - Number(b)), [students]);
  const [year, setYear] = useState("all");
  const [classYear, setClassYear] = useState("all");
  const [group, setGroup] = useState("all");
  const filteredStudents = useMemo(() => students.filter((student) => (classYear === "all" || String(student.classYear) === classYear) && (year === "all" || String(student.academicYear || student.cohortYear) === year) && (group === "all" || student.studentGroup === group)), [students, classYear, year, group]);
  const filteredEntries = useMemo(() => {
    const studentIds = new Set(filteredStudents.map((student) => student.id));
    const enrollmentMap = new Map(filteredStudents.map((student) => [student.id, student.activeEnrollment?.id]));
    return entries.filter((entry) => studentIds.has(entry.studentId) && (!enrollmentMap.get(entry.studentId) || entry.enrollmentId === enrollmentMap.get(entry.studentId)));
  }, [entries, filteredStudents]);
  const quality = useMemo(() => programQualitySummary(filteredStudents, filteredEntries, rotations, activities), [filteredStudents, filteredEntries, rotations, activities]);
  const rows = compact ? quality.monitoring.filter((student) => student.atRisk || student.stalePending || student.rejected).slice(0, 8) : quality.monitoring;

  return (
    <section className="content-panel quality-dashboard">
      <div className="section-title quality-title"><div><h2>Dashboard นักศึกษาที่ต้องติดตาม</h2><p>ความก้าวหน้า ความล่าช้าในการอนุมัติ และความผิดปกติของข้อมูล</p></div><ChartIcon size={27} /></div>
      <div className="quality-filters">
        {allowYearFilters && <label>ชั้นปี<select value={classYear} onChange={(event) => setClassYear(event.target.value)}><option value="all">ทุกชั้นปี</option>{classYears.map((item) => <option key={item} value={item}>Year {item}</option>)}</select></label>}
        {allowYearFilters && <label>ปีการศึกษา<select value={year} onChange={(event) => setYear(event.target.value)}><option value="all">ทุกปีการศึกษา</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
        <label>กลุ่ม Student<select value={group} onChange={(event) => setGroup(event.target.value)}><option value="all">ทุกกลุ่ม</option>{groups.map((item) => <option key={item} value={item}>กลุ่ม {item}</option>)}</select></label>
      </div>
      <div className="quality-metrics">
        <div><ShieldIcon size={20} /><span>ความก้าวหน้าเฉลี่ย<strong>{quality.averageProgress}%</strong></span></div>
        <div><AlertIcon size={20} /><span>ต้องติดตาม<strong>{quality.atRiskCount} คน</strong></span></div>
        <div><ClockIcon size={20} /><span>ค้างเกิน 48 ชม.<strong>{quality.stalePendingCount} รายการ</strong></span></div>
        <div><AlertIcon size={20} /><span>ข้อมูลผิดปกติ<strong>{quality.anomalies.length} จุด</strong></span></div>
        {!compact && <div><ClockIcon size={20} /><span>เวลาอนุมัติเฉลี่ย<strong>{quality.averageApprovalHours} ชม.</strong></span></div>}
      </div>
      <div className="quality-table-wrap"><table className="quality-table"><thead><tr><th>นักศึกษา</th><th>กลุ่ม</th><th>ความก้าวหน้า</th><th>รออนุมัติ</th><th>ส่งกลับ</th><th>สถานะติดตาม</th></tr></thead><tbody>
        {rows.map((student) => <tr key={student.id}><td><strong>{student.name}</strong><small>{student.studentCode} · Year {student.classYear || 4} / {student.academicYear || student.cohortYear}</small></td><td>{student.studentGroup || "—"}</td><td><strong className={student.percent >= student.passPercent ? "quality-good" : "quality-risk"}>{student.completed}/{student.required} · {student.percent}%</strong></td><td>{student.pending}{student.stalePending ? <small className="quality-risk">เกิน 48 ชม. {student.stalePending}</small> : null}</td><td>{student.rejected}</td><td><span className={student.atRisk ? "risk-badge danger" : student.percent >= student.passPercent ? "risk-badge good" : "risk-badge warning"}>{student.atRisk ? "ควรติดตาม" : student.percent >= student.passPercent ? `ผ่าน ${student.passPercent}%` : "กำลังดำเนินการ"}</span></td></tr>)}
        {!rows.length && <tr><td colSpan="6" className="quality-empty">ยังไม่มีนักศึกษาที่เข้าเงื่อนไข</td></tr>}
      </tbody></table></div>
      {!compact && quality.anomalies.length > 0 && <details className="anomaly-list"><summary>ตรวจพบข้อมูลผิดปกติ {quality.anomalies.length} จุด</summary>{quality.anomalies.slice(0, 20).map((item, index) => { const student = students.find((person) => person.id === item.studentId); return <div key={`${item.entryId}-${item.type}-${index}`}><AlertIcon size={16} /><span><strong>{student?.name || "ไม่ทราบชื่อ"}</strong> · {item.message} · Entry {item.entryId.slice(0, 8)}</span></div>; })}</details>}
    </section>
  );
}
