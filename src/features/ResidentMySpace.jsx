import React, { useEffect, useId, useMemo, useState } from "react";
import { buildMySpace, PBA_TARGET, PBA_YEAR_TARGET, STUCK_TEXT } from "../mySpace";
import { assessmentDisplayName, assessmentTopic } from "../mySpacePresentation";
import AssessmentTopicIcon from "../components/AssessmentTopicIcon";
import { academicYearStart, thaiDate } from "../residentAssessmentRules";
import { loadOwnRoundAttendanceSince } from "../residentApi";
import { ManagedPersonalScores } from "./ManagedExams";

const TABS = [["overview", "ภาพรวม"], ["assessment", "EPA / PBA"], ["exams", "ผลสอบ"], ["attendance", "การประชุม"]];
const checkInTime = (iso) => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(iso));
const statusText = { reached: "ถึงเกณฑ์แล้ว", finished: "ประเมินเสร็จแล้ว", waiting: "รอประเมิน", stuck: "ใช้ครบจำนวนครั้ง", open: "ยังไม่ถึงเกณฑ์", empty: "ยังไม่ส่ง", unknown: "ยังโหลดไม่ได้" };

function TopicLabel({ item }) {
  const topic = assessmentTopic(item.code);
  return <><span className="ms-topic-icon"><AssessmentTopicIcon topic={topic.icon} code={item.code} /></span><span className="ms-form-name"><small>{item.code} · {topic.label}</small><strong>{assessmentDisplayName(item.code, item.title)}</strong></span></>;
}
function Status({ state }) {
  return <span className={`ms-status ms-status-${state}`}>{statusText[state]}</span>;
}
function FormRow({ item, epa = false }) {
  return <details className="ms-form-row">
    <summary><TopicLabel item={item} /><Status state={item.state} /><span className="ms-expand" aria-hidden="true">+</span></summary>
    <div className="ms-form-detail">
      {epa ? item.state === "unknown" ? <p>ยังโหลดความคืบหน้าไม่ได้ ลองรีเฟรชหน้านี้</p> : <>
        <p>ใช้แล้ว {item.used} จาก {item.cap == null ? "ไม่จำกัด" : item.cap} ครั้ง · ปีการศึกษานี้ {item.perYear == null ? `${item.thisYear} ครั้ง` : `${item.thisYear}/${item.perYear}`}</p>
        {item.belowCount > 0 && <p>ข้อที่ยังต่ำกว่า {item.level}: {item.belowCount} ข้อ</p>}
        {item.state === "stuck" && <p className="ms-stuck">{STUCK_TEXT}</p>}
        {item.state === "waiting" && <p>รอ Staff ประเมิน</p>}
        {item.state === "reached" && <p>ถึงเกณฑ์การประเมินแล้ว</p>}
      </> : <p>{item.state === "finished" ? "มีผลประเมินแล้ว นับเป็น 1 เรื่องโดยไม่ซ้ำแบบ" : item.state === "waiting" ? "ส่งคำขอแล้ว อยู่ระหว่างรอ Staff ประเมิน" : "ยังไม่มีผลประเมินที่บันทึกแล้ว"}</p>}
    </div>
  </details>;
}
function Progress({ label, count, total, unit, children }) {
  return <div className="ms-progress-item"><div className="ms-progress-heading"><h3>{label}</h3><span className="ms-fraction">{count == null ? "—" : count}<small> / {total} {unit}</small></span></div>
    {count != null && <div className="ms-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(count, total)}><span style={{ width: `${Math.min(100, count / total * 100)}%` }} /></div>}
    <div className="ms-progress-meta">{children}</div>
  </div>;
}

export default function ResidentMySpace({ workspace, onOpenHistory, onOpenRequest }) {
  const yearStart = academicYearStart(new Date());
  const [tab, setTab] = useState("overview"), [filter, setFilter] = useState("all"), [allPba, setAllPba] = useState(false);
  const [attendance, setAttendance] = useState({ rows: null, error: "", loading: true });
  const id = useId();
  useEffect(() => {
    let live = true;
    setAttendance({ rows: null, error: "", loading: true });
    loadOwnRoundAttendanceSince(yearStart)
      .then((rows) => { if (live) setAttendance({ rows, error: "", loading: false }); })
      .catch(() => { if (live) setAttendance({ rows: null, error: "โหลดข้อมูลการประชุมไม่สำเร็จ ลองรีเฟรชหน้านี้", loading: false }); });
    return () => { live = false; };
  }, [yearStart, workspace.user.id]);
  const data = useMemo(() => buildMySpace({ user: workspace.user, requests: workspace.requests, assessments: workspace.assessments,
    templates: workspace.templates, epaProgress: workspace.epaProgress, attendance: attendance.rows,
    profiles: workspace.allProfiles || workspace.profiles || [], now: new Date() }), [workspace, attendance.rows]);
  const { counters } = data;
  const matches = (item) => filter === "all" || (filter === "waiting" ? item.state === "waiting" : filter === "finished" ? ["reached", "finished"].includes(item.state) : ["empty", "open", "stuck"].includes(item.state));
  const epa = data.board.epa.filter(matches), pba = data.board.pba.forms.filter(matches);
  const changeTab = (next) => { setTab(next); setFilter("all"); setAllPba(false); };
  const openWaiting = () => { setTab("assessment"); setFilter("waiting"); setAllPba(true); };
  const attendanceSummary = attendance.loading ? <p className="ms-empty" role="status">กำลังโหลด…</p> : attendance.error ? <p className="ms-error" role="alert">{attendance.error}</p> : <><p className="ms-attendance-count"><b>{data.attendance.countThisYear}</b> ครั้งที่เช็คชื่อแล้ว</p><p className="ms-muted">{data.year.label}</p></>;
  const waiting = <section className="ms-card" aria-labelledby={`${id}-waiting`}><div className="ms-card-heading"><h2 id={`${id}-waiting`}>รอการประเมิน</h2></div>
    {data.waitingList.length === 0 ? <p className="ms-empty">ตอนนี้ไม่มีแบบที่รอ Staff ประเมิน</p> : <ul className="ms-activity-list">{data.waitingList.slice(0, 3).map((item) => <li key={item.id}><TopicLabel item={item} /><div className="ms-activity-meta">Staff: {item.staffName} · ส่งเมื่อ {thaiDate(item.submittedAt)} · รอมา {item.daysWaiting} วัน</div></li>)}</ul>}
    {data.waitingList.length > 3 && <p className="ms-muted">ยังมีอีก {data.waitingList.length - 3} คำขอ</p>}
    {data.waitingList.length > 0 && <button type="button" className="ms-link ms-link-quiet" onClick={openWaiting}>ดูแบบที่กำลังรอประเมิน →</button>}
    <button type="button" className="ms-link ms-link-quiet" onClick={onOpenHistory}>ดูสถานะทั้งหมด →</button>
  </section>;
  const recent = <section className="ms-card" aria-labelledby={`${id}-recent`}><h2 id={`${id}-recent`}>กิจกรรมล่าสุด</h2>
    {data.recent.length === 0 ? <p className="ms-empty">ยังไม่มีผลการประเมิน</p> : <ul className="ms-activity-list">{data.recent.slice(0, 3).map((item) => <li key={item.id}><TopicLabel item={item} /><div className="ms-activity-meta">{thaiDate(item.date)} · Staff: {item.staffName}</div></li>)}</ul>}
    <button type="button" className="ms-link ms-link-quiet" onClick={onOpenHistory}>ดูผลการประเมินทั้งหมด →</button>
  </section>;

  return <div className="ms-page">
    <div className="ms-page-heading"><div><h1>My space</h1><p>{data.greeting.name || "Resident"}{data.greeting.pgy ? ` · PGY ${data.greeting.pgy}` : ""} · {data.year.label}</p></div><button type="button" className="primary-button" onClick={onOpenRequest}>ส่งแบบประเมิน</button></div>
    <div className="ms-tabs" role="tablist" aria-label="หมวดใน My space">{TABS.map(([key, label], index) => <button type="button" role="tab" key={key} id={`${id}-tab-${key}`} aria-selected={tab === key} aria-controls={`${id}-panel`} onClick={() => changeTab(key)} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
      changeTab(TABS[next][0]); event.currentTarget.parentElement.children[next].focus();
    }}>{label}</button>)}</div>
    {counters.waitingUnknown > 0 && <p className="ms-note" role="status">มีคำขอรอประเมินที่ระบุประเภท EPA/PBA ไม่ได้ {counters.waitingUnknown} คำขอ กรุณาตรวจรายการในประวัติหรือติดต่อ Admin</p>}
    {!data.epaAvailable && <p className="ms-note" role="status">ยังโหลดความคืบหน้า EPA ไม่ได้ ลองรีเฟรชหน้านี้ ส่วนอื่นยังใช้ได้ตามปกติ</p>}
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
      {tab === "overview" && <div className="ms-overview-grid"><div className="ms-stack"><section className="ms-card" aria-labelledby={`${id}-progress`}><div className="ms-card-heading"><h2 id={`${id}-progress`}>ความก้าวหน้าของฉัน</h2></div>
        <Progress label="EPA ถึงเกณฑ์" count={counters.epaReached} total={counters.epaTotal} unit="ข้อ"><span>ประเมินเสร็จปีนี้ (EPA) <b>{counters.finishedEpaThisYear}</b> ครั้ง</span><span>รอประเมิน (EPA) <b>{counters.waitingEpa}</b> ครั้ง</span></Progress>
        <Progress label="PBA เสร็จแล้ว" count={counters.pbaFinished} total={counters.pbaTarget} unit="เรื่อง"><span>ประเมินเสร็จปีนี้ (PBA) <b>{counters.finishedPbaThisYear}</b> เรื่อง</span><span>รอประเมิน (PBA) <b>{counters.waitingPba}</b> เรื่อง</span></Progress>
        <button type="button" className="ms-link ms-link-quiet" onClick={() => changeTab("assessment")}>ดูเกณฑ์และรายการทั้งหมด →</button>
      </section>{waiting}</div><div className="ms-stack"><section className="ms-card ms-private-summary"><div><h2>ผลการสอบของฉัน</h2><p className="ms-muted">ซ่อนคะแนนอยู่ · เปิดดูเมื่อพร้อม</p></div><button type="button" className="ms-link" onClick={() => changeTab("exams")}>เปิดดู</button></section>{recent}<section className="ms-card"><h2>การเข้าร่วมประชุมของฉัน</h2>{attendanceSummary}<p className="ms-muted">ข้อมูลประกอบ ไม่ใช่คะแนน</p><button type="button" className="ms-link ms-link-quiet" onClick={() => changeTab("attendance")}>ดูประวัติประชุม →</button></section></div></div>}
      {tab === "assessment" && <><div className="ms-filters" aria-label="กรองสถานะแบบประเมิน">{[["all", "ทั้งหมด"], ["waiting", "รอประเมิน"], ["unfinished", "ยังไม่เสร็จ"], ["finished", "เสร็จ / ถึงเกณฑ์"]].map(([key, label]) => <button type="button" key={key} className="ms-link" aria-pressed={filter === key} onClick={() => { setFilter(key); setAllPba(false); }}>{label}</button>)}</div>
        <div className="ms-assessment-grid"><section className="ms-card" aria-labelledby={`${id}-board`}><div className="ms-card-heading"><h2 id={`${id}-board`}>เช็กลิสต์ก่อนสอบบอร์ด</h2><span className="ms-muted">EPA {counters.epaReached == null ? "—" : counters.epaReached}/{counters.epaTotal} ข้อ</span></div>
          {epa.map((item) => <FormRow key={item.code} item={item} epa />)}{epa.length === 0 && <p className="ms-empty">ไม่มีแบบ EPA ในสถานะที่เลือก</p>}
          <details className="ms-rules"><summary>วิธีนับ EPA</summary><p>นับต่อปีการศึกษา (เริ่ม 1 ก.ค.) · “ถึงเกณฑ์” = ทุกข้อใน 1 แบบประเมินได้ระดับ L4/L5 (EPA 7 ได้ M/E) · เป้า EPA 7 ข้อ ไม่นับ EPA-8 และ EPA 7 นับ 1 ข้อเมื่อถึงเกณฑ์ทั้ง L1-L2 และ L3</p></details>
        </section><div className="ms-stack"><section className="ms-card"><div className="ms-card-heading"><h2>PBA</h2><span className="ms-muted">{data.board.pba.finished}/{PBA_TARGET} เรื่อง</span></div><p className="ms-muted">มีให้เลือก {data.board.pba.forms.length} แบบ · เป้าหมาย {PBA_TARGET} เรื่อง</p>
          {(allPba ? pba : pba.slice(0, 6)).map((form) => <FormRow key={form.code} item={form} />)}{pba.length === 0 && <p className="ms-empty">ไม่มีแบบ PBA ในสถานะที่เลือก</p>}
          {pba.length > 6 && <button type="button" className="ms-link ms-link-quiet" aria-expanded={allPba} onClick={() => setAllPba((value) => !value)}>{allPba ? "แสดงน้อยลง" : `ดูครบ ${pba.length} แบบตามสถานะที่เลือก`} →</button>}
        </section><section className="ms-card"><h2>เป้าปีการศึกษานี้</h2><p className="ms-muted">{data.year.label} · นับต่อปีการศึกษา (เริ่ม 1 ก.ค.)</p><h3>PBA ปีนี้</h3><p className="ms-attendance-count"><b>{data.plan.pbaThisYear}/{PBA_YEAR_TARGET}</b> เรื่อง</p>
          <details className="ms-rules"><summary>EPA ที่ยังส่งได้ปีนี้ ({data.epaAvailable ? `${data.plan.epaCanSend.length} แบบ` : "รอข้อมูล"})</summary>{!data.epaAvailable ? <p className="ms-empty">ยังโหลดความคืบหน้า EPA ไม่ได้</p> : data.plan.epaCanSend.length === 0 ? <p className="ms-empty">ไม่มีแบบ EPA ที่ต้องส่งเพิ่มในปีนี้</p> : <ul className="ms-plan-list">{data.plan.epaCanSend.map((item) => <li key={item.code}><TopicLabel item={item} /></li>)}</ul>}</details>
          <button type="button" className="ms-link ms-link-quiet" onClick={onOpenRequest}>ไปส่งแบบประเมิน →</button>
        </section></div></div></>}
      {tab === "exams" && <ManagedPersonalScores key={workspace.user.id} userId={workspace.user.id} personalLayout />}
      {tab === "attendance" && <section className="ms-card"><h2>การเข้าร่วมประชุมของฉัน</h2><p className="ms-muted">ข้อมูลประกอบ ไม่ใช่คะแนน</p>{attendanceSummary}
        {!attendance.loading && !attendance.error && (data.attendance.last5.length === 0 ? <p className="ms-empty">ยังไม่มีการเช็คชื่อในปีการศึกษานี้</p> : <ul className="ms-meeting-list">{data.attendance.last5.map((iso, i) => <li key={`${iso}-${i}`}><strong>ครั้งที่ {data.attendance.countThisYear - i}</strong><span>{checkInTime(iso)}</span></li>)}</ul>)}
      </section>}
    </div>
  </div>;
}
