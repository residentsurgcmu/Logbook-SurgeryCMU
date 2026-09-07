import React, { useEffect, useMemo, useState } from "react";
import { AlertIcon, BookIcon, CheckIcon, ChartIcon, ClockIcon, ShieldIcon, UserIcon } from "../components/Icons";
import ActivityIcon from "../components/ActivityIcon";
import { buildAdminDashboardSummary } from "../year4Analytics";
import { formatYear4Timestamp } from "../year4Time";

const Metric = ({ icon, label, value, detail, tone = "" }) => <div className={`admin-overview-metric ${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>;

const weekLabel = (week) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(new Date(`${week}T00:00:00`));

export default function AdminOverviewDashboard({ students = [], entries = [], activities = [], rotations = [], curricula = [] }) {
  const defaultCurriculum = useMemo(() => curricula.find((item) => item.classYear === 5 && item.academicYear === 2569 && item.status === "published")
    || curricula.find((item) => item.status === "published") || curricula[0] || null, [curricula]);
  const [filter, setFilter] = useState({ curriculumId: "", group: "all", rotationId: "all", dateStart: "", dateEnd: "" });
  const [selectedStudentId, setSelectedStudentId] = useState("");
  useEffect(() => {
    if (!filter.curriculumId && defaultCurriculum) setFilter((current) => ({ ...current, curriculumId: defaultCurriculum.id }));
  }, [defaultCurriculum, filter.curriculumId]);
  const curriculumId = filter.curriculumId || defaultCurriculum?.id || "";
  const selectedCurriculum = curricula.find((item) => item.id === curriculumId) || defaultCurriculum;
  const curriculumStudents = useMemo(() => students.filter((student) => student.activeEnrollment?.curriculumId === curriculumId), [students, curriculumId]);
  const groups = useMemo(() => [...new Set(curriculumStudents.map((student) => student.studentGroup).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "th", { numeric: true })), [curriculumStudents]);
  const availableRotations = useMemo(() => rotations.filter((item) => item.curriculumId === curriculumId), [rotations, curriculumId]);
  const scopedStudents = useMemo(() => curriculumStudents.filter((student) => (filter.group === "all" || student.studentGroup === filter.group)
    && (filter.rotationId === "all" || student.activeEnrollment?.rotationId === filter.rotationId)), [curriculumStudents, filter.group, filter.rotationId]);
  const scopedIds = useMemo(() => new Set(scopedStudents.map((student) => student.id)), [scopedStudents]);
  const scopedEntries = useMemo(() => entries.filter((entry) => scopedIds.has(entry.studentId) && entry.curriculumId === curriculumId
    && (!filter.dateStart || entry.date >= filter.dateStart) && (!filter.dateEnd || entry.date <= filter.dateEnd)), [entries, scopedIds, curriculumId, filter.dateStart, filter.dateEnd]);
  const scopedActivities = useMemo(() => activities.filter((activity) => activity.curriculumId === curriculumId), [activities, curriculumId]);
  const summary = useMemo(() => buildAdminDashboardSummary({ students: scopedStudents, entries: scopedEntries, activities: scopedActivities, rotations: availableRotations, passPercent: selectedCurriculum?.passPercent || 80 }), [scopedStudents, scopedEntries, scopedActivities, availableRotations, selectedCurriculum]);
  const selectedStudent = summary.students.find((student) => student.id === selectedStudentId) || null;
  const maxActivity = Math.max(1, ...summary.activities.map((item) => item.recorded));
  const maxWeek = Math.max(1, ...summary.weeks.flatMap((item) => [item.submitted, item.approved]));
  const leastActivities = summary.activities.slice().sort((a, b) => a.coverage - b.coverage || a.approved - b.approved).slice(0, 3);
  const topActivities = summary.activities.slice().sort((a, b) => b.recorded - a.recorded || a.sortOrder - b.sortOrder).slice(0, 3);

  return <section className="admin-overview-dashboard">
    <div className="section-title admin-overview-title"><div><h2>ภาพรวมการดำเนินงาน Logbook</h2><p>ติดตามความครบถ้วน การอนุมัติ และกิจกรรมที่นักศึกษาบันทึกมาก–น้อย</p></div><ChartIcon size={28} /></div>
    <div className="admin-overview-filters">
      <label>Curriculum<select value={curriculumId} onChange={(event) => setFilter((current) => ({ ...current, curriculumId: event.target.value, group: "all", rotationId: "all" }))}>{curricula.map((item) => <option key={item.id} value={item.id}>Year {item.classYear} · {item.academicYear} · {item.name}</option>)}</select></label>
      <label>กลุ่ม Student<select value={filter.group} onChange={(event) => setFilter((current) => ({ ...current, group: event.target.value }))}><option value="all">ทุกกลุ่ม</option>{groups.map((item) => <option key={item} value={item}>กลุ่ม {item}</option>)}</select></label>
      <label>Rotation<select value={filter.rotationId} onChange={(event) => setFilter((current) => ({ ...current, rotationId: event.target.value }))}><option value="all">ทุก rotation</option>{availableRotations.map((item) => <option key={item.id} value={item.id}>{item.groupCode} · {item.name}</option>)}</select></label>
      <label>ตั้งแต่<input type="date" value={filter.dateStart} onChange={(event) => setFilter((current) => ({ ...current, dateStart: event.target.value }))} /></label>
      <label>ถึง<input type="date" value={filter.dateEnd} onChange={(event) => setFilter((current) => ({ ...current, dateEnd: event.target.value }))} /></label>
    </div>
    <div className="admin-overview-metrics">
      <Metric icon={<UserIcon size={21} />} label="นักศึกษา active" value={scopedStudents.length} detail={`ผ่าน ${selectedCurriculum?.passPercent || 80}% แล้ว ${summary.reachedPass} คน`} />
      <Metric icon={<BookIcon size={21} />} label="รายการที่บันทึก" value={summary.recorded} detail={`อนุมัติแล้ว ${summary.approved} รายการ`} />
      <Metric icon={<ShieldIcon size={21} />} label="ความก้าวหน้ารวม" value={`${summary.credited}/${summary.required} · ${summary.progressPercent}%`} detail="นับ approved ไม่เกินเป้าหมาย" />
      <Metric icon={<ClockIcon size={21} />} label="รออนุมัติเกิน 48 ชม." value={summary.stalePending} detail={`รออนุมัติทั้งหมด ${summary.pending} รายการ`} tone={summary.stalePending ? "warning" : ""} />
      <Metric icon={<AlertIcon size={21} />} label="นักศึกษาที่ต้องติดตาม" value={summary.atRisk} detail="ใกล้จบ rotation แต่ยังไม่ถึงเกณฑ์" tone={summary.atRisk ? "warning" : ""} />
    </div>
    <div className="admin-overview-grid">
      <section className="content-panel admin-activity-panel"><div className="section-title"><div><h3>กิจกรรมที่ลงมาก–น้อย</h3><p>จำนวนรายการจริง พร้อมสถานะการอนุมัติ</p></div></div><div className="admin-activity-list">{summary.activities.map((item) => <div key={item.id} className="admin-activity-row"><span className="admin-activity-icon"><ActivityIcon activityType={item.id} size={18} /></span><div className="admin-activity-name"><strong>{item.title}</strong><small>{item.group} · ครบเป้าหมาย {item.coverage}% ของนักศึกษา</small><i><b style={{ width: `${Math.round(item.recorded / maxActivity * 100)}%` }} /></i></div><div className="admin-activity-count"><strong>{item.recorded}</strong><small>อนุมัติ {item.approved} · รอ {item.submitted}</small></div></div>)}{!summary.activities.length && <div className="admin-overview-empty">ยังไม่มี Curriculum หรือกิจกรรมในขอบเขตนี้</div>}</div></section>
      <section className="content-panel admin-insight-panel"><div className="section-title"><div><h3>สัญญาณที่ควรดู</h3><p>ช่วยปรับการจัดการเรียนและ rotation</p></div></div><div className="admin-insight-list"><div><strong>บันทึกมากที่สุด</strong>{topActivities.map((item) => <span key={item.id}>{item.title}<b>{item.recorded} รายการ</b></span>)}</div><div><strong>ครอบคลุมน้อยที่สุด</strong>{leastActivities.map((item) => <span key={item.id}>{item.title}<b>{item.coverage}% ถึงเป้าหมาย</b></span>)}</div></div></section>
    </div>
    <section className="content-panel admin-trend-panel"><div className="section-title"><div><h3>แนวโน้มรายสัปดาห์</h3><p>รายการที่ส่ง เทียบกับรายการที่ Staff อนุมัติ</p></div></div><div className="admin-week-chart">{summary.weeks.map((item) => <div key={item.week}><div className="admin-week-bars"><i style={{ height: `${Math.round(item.submitted / maxWeek * 100)}%` }} title={`ส่ง ${item.submitted}`} /><b style={{ height: `${Math.round(item.approved / maxWeek * 100)}%` }} title={`อนุมัติ ${item.approved}`} /></div><strong>{weekLabel(item.week)}</strong><small>{item.submitted}/{item.approved}</small></div>)}{!summary.weeks.length && <div className="admin-overview-empty">ยังไม่มีรายการ Logbook ในช่วงวันที่เลือก</div>}</div><p className="admin-chart-key"><span>ส่ง Logbook</span><span>Staff อนุมัติ</span></p></section>
      <section className="content-panel admin-student-panel"><div className="section-title"><div><h3>ติดตามนักศึกษารายคน</h3><p>กดแถวเพื่อดู progress แยกรายกิจกรรมและรายการล่าสุด</p></div></div><div className="data-table-wrap"><table className="admin-student-table"><thead><tr><th>นักศึกษา</th><th>กลุ่ม / Rotation</th><th>ความก้าวหน้า</th><th>รอ / ส่งกลับ</th><th>กิจกรรมที่ยังขาด</th><th>บันทึกล่าสุด</th><th>สถานะ</th></tr></thead><tbody>{summary.students.map((student) => <React.Fragment key={student.id}><tr className="admin-student-row" onClick={() => setSelectedStudentId((current) => current === student.id ? "" : student.id)}><td><strong>{student.name}</strong><small>{student.studentCode}</small></td><td>{student.studentGroup ? `กลุ่ม ${student.studentGroup}` : "—"}<small>{student.rotation?.name || "ยังไม่กำหนด rotation"}</small></td><td><strong className={student.percent >= student.passPercent ? "quality-good" : "quality-risk"}>{student.completed}/{student.required} · {student.percent}%</strong></td><td>{student.pending} รอ{student.stalePending ? <small className="quality-risk">เกิน 48 ชม. {student.stalePending}</small> : null}{student.rejected ? <small className="quality-risk">ส่งกลับ {student.rejected}</small> : null}</td><td>{student.activityGaps.length ? student.activityGaps.map((activity) => <small key={activity.id}>{activity.title} · ขาด {activity.remaining}</small>) : <small>ครบแล้ว</small>}</td><td>{student.lastEntry ? formatYear4Timestamp(student.lastEntry.submittedAt || student.lastEntry.date) : "—"}</td><td><span className={student.atRisk ? "risk-badge danger" : student.percent >= student.passPercent ? "risk-badge good" : "risk-badge warning"}>{student.atRisk ? "ควรติดตาม" : student.percent >= student.passPercent ? "ผ่านเกณฑ์" : "กำลังดำเนินการ"}</span></td></tr>{selectedStudent?.id === student.id && <tr className="admin-student-detail"><td colSpan="7"><div><strong>รายละเอียด {student.name}</strong><span>{scopedActivities.map((activity) => { const count = scopedEntries.filter((entry) => entry.studentId === student.id && entry.activityType === activity.id && entry.status === "approved").length; return <small key={activity.id}>{activity.title}: {Math.min(count, activity.target || count)}/{activity.target || "—"}</small>; })}</span></div></td></tr>}</React.Fragment>)}{!summary.students.length && <tr><td colSpan="7" className="quality-empty">ยังไม่มี Student ที่ active ในขอบเขตนี้</td></tr>}</tbody></table></div></section>
  </section>;
}
