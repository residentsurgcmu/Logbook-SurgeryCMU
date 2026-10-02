import React, { useEffect, useMemo, useRef, useState } from "react";
import { caseErrorMessage, caseSexLabel, conferenceWeek } from "../residentCases";
import { bangkokIsoDate, shiftIsoDate } from "../roundSchedule";
import { loadAdmissionCases, loadCaseMedia, loadCasePeople } from "../residentCasesApi";
import { CaseNotes, CaseStatusChip, personName, thaiDate } from "./CaseParts";

export default function ResidentConference({ user, initialCase = null }) {
  const [weekStart, setWeekStart] = useState(() => conferenceWeek(initialCase?.admit_date || bangkokIsoDate()).start);
  const [cases, setCases] = useState(null);
  const [people, setPeople] = useState([]);
  const [index, setIndex] = useState(0);
  const [media, setMedia] = useState([]);
  const [photo, setPhoto] = useState(0);
  const [error, setError] = useState("");
  const pendingId = useRef(initialCase?.id || null);
  const seq = useRef(0);
  const mediaSeq = useRef(0);
  const week = useMemo(() => conferenceWeek(weekStart), [weekStart]);

  useEffect(() => { loadCasePeople().then(setPeople).catch((nextError) => setError(caseErrorMessage(nextError))); }, []);

  useEffect(() => {
    const mine = ++seq.current;
    setCases(null);
    setError("");
    loadAdmissionCases({ from: week.start, to: week.end })
      .then((rows) => {
        if (mine !== seq.current) return;
        // Present oldest first: Monday's admissions before Friday's.
        const ordered = [...rows].sort((a, b) => a.admit_date.localeCompare(b.admit_date) || a.case_code.localeCompare(b.case_code));
        const wanted = pendingId.current ? ordered.findIndex((row) => row.id === pendingId.current) : -1;
        pendingId.current = null;
        setCases(ordered);
        setIndex(wanted >= 0 ? wanted : 0);
        setPhoto(0);
      })
      .catch((nextError) => { if (mine === seq.current) setError(caseErrorMessage(nextError)); });
  }, [week.start, week.end]);

  const current = cases?.[Math.min(index, (cases?.length || 1) - 1)] || null;
  useEffect(() => {
    const mine = ++mediaSeq.current;
    setMedia([]);
    setPhoto(0);
    if (!current) return;
    loadCaseMedia(current.id)
      .then((rows) => { if (mine === mediaSeq.current) setMedia(rows); })
      .catch((nextError) => { if (mine === mediaSeq.current) setError(caseErrorMessage(nextError)); });
  }, [current?.id]);

  const label = `${thaiDate(week.start)} – ${thaiDate(week.end)}`;
  return (
    <section className="resident-panel case-present">
      <div className="case-weekbar">
        <button type="button" className="secondary-button" onClick={() => setWeekStart(shiftIsoDate(weekStart, -7))}>สัปดาห์ก่อน</button>
        <strong>{label}</strong>
        <button type="button" className="secondary-button" onClick={() => setWeekStart(shiftIsoDate(weekStart, 7))}>สัปดาห์ถัดไป</button>
        <button type="button" className="link-button" onClick={() => setWeekStart(conferenceWeek(bangkokIsoDate()).start)}>สัปดาห์นี้</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!cases && !error && <p className="case-muted">กำลังโหลดเคส…</p>}
      {cases?.length === 0 && <p className="case-muted">ไม่มีเคสรับใหม่ในสัปดาห์นี้</p>}
      {current && (
        <>
          <div className="case-weekbar">
            <select aria-label="เลือกเคส" value={index} onChange={(event) => setIndex(Number(event.target.value))}>
              {cases.map((row, position) => <option key={row.id} value={position}>{row.case_code} · {row.diagnosis}</option>)}
            </select>
            <button type="button" className="secondary-button" disabled={index === 0} onClick={() => setIndex(index - 1)}>ก่อนหน้า</button>
            <strong>{index + 1} / {cases.length}</strong>
            <button type="button" className="secondary-button" disabled={index >= cases.length - 1} onClick={() => setIndex(index + 1)}>ถัดไป</button>
          </div>
          <div className="case-split">
            <div>
              <p><span className="case-count">{current.case_code}</span> <span className="case-count">{current.unit_name}</span> <CaseStatusChip status={current.status} /></p>
              <h2>{current.diagnosis}</h2>
              <p className="case-muted">{caseSexLabel(current.sex)} {current.age_years} ปี · รับไว้ {thaiDate(current.admit_date)} · Owner: {personName(people, current.owner_id)}</p>
              <div className="case-field"><small>Management</small>{current.management || "ยังไม่ระบุ"}</div>
              <div className="case-field"><small>Operation</small>{current.operation || "ยังไม่ระบุ"}</div>
            </div>
            <div>
              <div className="case-present-image">
                {media[photo]?.url ? <img src={media[photo].url} alt={media[photo].caption || `ภาพ ${photo + 1}`} /> : <span>{media.length ? "โหลดภาพไม่สำเร็จ" : "ยังไม่มีภาพแนบ"}</span>}
              </div>
              <div className="button-row">
                {media.map((item, position) => <button key={item.id} type="button" className={position === photo ? "primary-button" : "secondary-button"} onClick={() => setPhoto(position)}>ภาพ {position + 1}</button>)}
              </div>
            </div>
          </div>
          <CaseNotes key={current.id} caseId={current.id} user={user} people={people} />
        </>
      )}
    </section>
  );
}
