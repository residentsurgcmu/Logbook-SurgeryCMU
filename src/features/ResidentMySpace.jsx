import React, { useEffect, useMemo, useState } from "react";
import { buildMySpace, PBA_TARGET, PBA_YEAR_TARGET, STUCK_TEXT } from "../mySpace";
import { academicYearStart, thaiDate } from "../residentAssessmentRules";
import { loadOwnRoundAttendanceSince } from "../residentApi";

const checkInTime = (iso) =>
  new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(iso));

function EpaRow({ item }) {
  if (item.state === "unknown") return <li className="ms-row"><strong>{item.code}</strong><span className="ms-muted">ยังโหลดความคืบหน้าไม่ได้</span></li>;
  if (item.state === "reached") return <li className="ms-row ms-ok"><strong>{item.code}</strong><span>✓ ถึงเกณฑ์แล้ว</span></li>;
  const limit = item.cap == null ? "ไม่จำกัด" : item.cap;
  const year = item.perYear == null ? `${item.thisYear} ครั้ง` : `${item.thisYear}/${item.perYear}`;
  return (
    <li className={`ms-row${item.state === "stuck" ? " ms-warn" : ""}`}>
      <strong>{item.code}</strong>
      <span>ใช้แล้ว {item.used} จาก {limit} ครั้ง · ปีการศึกษานี้ {year}</span>
      {item.belowCount > 0 && <span>ข้อที่ยังต่ำกว่า {item.level}: {item.belowCount} ข้อ</span>}
      {item.state === "stuck" && <span className="ms-stuck">{STUCK_TEXT}</span>}
      {item.state === "waiting" && <span className="ms-muted">รอ Staff ประเมิน</span>}
    </li>
  );
}

export default function ResidentMySpace({ workspace, onOpenHistory, onOpenRequest }) {
  const yearStart = academicYearStart(new Date());
  const [attendance, setAttendance] = useState({ rows: null, error: "", loading: true });
  useEffect(() => {
    let live = true;
    setAttendance({ rows: null, error: "", loading: true });
    loadOwnRoundAttendanceSince(yearStart)
      .then((rows) => { if (live) setAttendance({ rows, error: "", loading: false }); })
      .catch((error) => { if (live) setAttendance({ rows: null, error: "โหลดข้อมูลการประชุมไม่สำเร็จ ลองรีเฟรชหน้านี้", loading: false }); });
    return () => { live = false; };
  }, [yearStart]);

  const data = useMemo(
    () =>
      buildMySpace({
        user: workspace.user,
        requests: workspace.requests,
        assessments: workspace.assessments,
        templates: workspace.templates,
        epaProgress: workspace.epaProgress,
        attendance: attendance.rows,
        profiles: workspace.allProfiles || workspace.profiles || [],
        now: new Date(),
      }),
    [workspace, attendance.rows],
  );
  const { counters } = data;

  return (
    <div className="ms-page">
      <section className="ms-hero">
        <h2>สวัสดี {data.greeting.name || "Resident"}</h2>
        <p>{data.greeting.pgy ? `PGY ${data.greeting.pgy} · ` : ""}{data.year.label}</p>
      </section>

      <ul className="ms-counters" aria-label="ตัวเลขสรุปของฉัน">
        <li><b>{counters.waiting}</b><span>รอประเมิน</span></li>
        <li><b>{counters.finishedThisYear}</b><span>ประเมินเสร็จปีนี้</span></li>
        <li><b>{counters.epaReached == null ? "—" : `${counters.epaReached}/${counters.epaTotal}`}</b><span>EPA ถึงเกณฑ์</span></li>
        <li><b>{counters.pbaFinished}/{counters.pbaTarget}</b><span>PBA เสร็จแล้ว</span></li>
      </ul>
      {!data.epaAvailable && <p className="ms-note" role="status">ยังโหลดความคืบหน้า EPA ไม่ได้ ลองรีเฟรชหน้านี้ ส่วนอื่นยังใช้ได้ตามปกติ</p>}

      <section className="ms-card" aria-labelledby="ms-waiting">
        <h2 id="ms-waiting">รอการประเมิน</h2>
        {data.waitingList.length === 0 ? (
          <p className="ms-empty">ตอนนี้ไม่มีแบบที่รอ Staff ประเมิน</p>
        ) : (
          <ul className="ms-list">
            {data.waitingList.map((item) => (
              <li key={item.id} className="ms-row">
                <strong>{item.code}</strong>
                <span className="ms-title">{item.title}</span>
                <span>Staff: {item.staffName} · ส่งเมื่อ {thaiDate(item.submittedAt)} · รอมา {item.daysWaiting} วัน</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="ms-link" onClick={onOpenHistory}>ดูสถานะทั้งหมด</button>
      </section>

      <section className="ms-card" aria-labelledby="ms-recent">
        <h2 id="ms-recent">กิจกรรมล่าสุด</h2>
        {data.recent.length === 0 ? (
          <p className="ms-empty">ยังไม่มีผลการประเมิน</p>
        ) : (
          <ul className="ms-list">
            {data.recent.map((item) => (
              <li key={item.id} className="ms-row">
                <strong>{item.code}</strong>
                <span className="ms-title">{item.title}</span>
                <span>{thaiDate(item.date)} · Staff: {item.staffName}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="ms-link" onClick={onOpenHistory}>ดูผลการประเมินทั้งหมด</button>
      </section>

      <section className="ms-card" aria-labelledby="ms-board">
        <h2 id="ms-board">เช็กลิสต์ก่อนสอบบอร์ด</h2>
        <p className="ms-muted">นับต่อปีการศึกษา (เริ่ม 1 ก.ค.) · “ถึงเกณฑ์” = ทุกข้อใน 1 แบบประเมินได้ระดับ L4/L5 (EPA 7 ได้ M/E)</p>
        <h3>EPA</h3>
        <ul className="ms-list">{data.board.epa.map((item) => <EpaRow key={item.code} item={item} />)}</ul>
        <h3>PBA</h3>
        <p>เสร็จแล้ว {data.board.pba.finished} เรื่อง (เป้า {PBA_TARGET})</p>
        <ul className="ms-chips">
          {data.board.pba.forms.map((form) => (
            <li key={form.code} className={`ms-chip ms-chip-${form.state}`} title={form.title}>
              <span>{form.code.replace("PBA-", "")}</span>
              <small>{form.state === "finished" ? "✓ เสร็จแล้ว" : form.state === "waiting" ? "… รอประเมิน" : "ยังไม่ส่ง"}</small>
            </li>
          ))}
        </ul>
      </section>

      <section className="ms-card" aria-labelledby="ms-plan">
        <h2 id="ms-plan">เป้าปีการศึกษานี้</h2>
        <p className="ms-muted">{data.year.label} · นับต่อปีการศึกษา (เริ่ม 1 ก.ค.)</p>
        <h3>EPA ที่ยังส่งได้ปีนี้</h3>
        {!data.epaAvailable ? (
          <p className="ms-empty">ยังโหลดความคืบหน้า EPA ไม่ได้</p>
        ) : data.plan.epaCanSend.length === 0 ? (
          <p className="ms-empty">ไม่มีแบบ EPA ที่ต้องส่งเพิ่มในปีนี้</p>
        ) : (
          <ul className="ms-list">{data.plan.epaCanSend.map((item) => <li key={item.code} className="ms-row"><strong>{item.code}</strong><span className="ms-title">{item.title}</span></li>)}</ul>
        )}
        <h3>PBA ปีนี้</h3>
        <p><b>{data.plan.pbaThisYear}/{PBA_YEAR_TARGET}</b> เรื่อง</p>
        <button type="button" className="ms-link" onClick={onOpenRequest}>ไปส่งแบบประเมิน</button>
      </section>

      <section className="ms-card" aria-labelledby="ms-attendance">
        <h2 id="ms-attendance">การเข้าร่วมประชุมของฉัน</h2>
        <p className="ms-badge">ข้อมูลประกอบ ไม่ใช่คะแนน</p>
        {attendance.loading ? (
          <p className="ms-empty" role="status">กำลังโหลด…</p>
        ) : attendance.error ? (
          <p className="ms-error" role="alert">{attendance.error}</p>
        ) : (
          <>
            <p>{data.year.label}: เช็คชื่อแล้ว <b>{data.attendance.countThisYear}</b> ครั้ง</p>
            {data.attendance.last5.length === 0 ? (
              <p className="ms-empty">ยังไม่มีการเช็คชื่อในปีการศึกษานี้</p>
            ) : (
              <ul className="ms-list">{data.attendance.last5.map((iso, i) => <li key={`${iso}-${i}`} className="ms-row"><span>ครั้งที่ {data.attendance.countThisYear - i} · {checkInTime(iso)}</span></li>)}</ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
