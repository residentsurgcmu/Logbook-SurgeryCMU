import React, { useEffect, useMemo, useState } from "react";
import {
  createResidentExam,
  saveResidentExamResults,
  setResidentExamPublication,
} from "../residentApi";

const thaiDate = (value) =>
  new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}T12:00:00+07:00`));
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date());
const outcomeLabel = (outcome) =>
  outcome === "pass" ? "ผ่าน" : outcome === "remediation" ? "ต้องซ่อม" : "—";
const eventTypeLabel = (type) =>
  type === "xray_anatomy" ? "X-ray & Anatomy" : "MCQ";
const resultKey = (residentId, partId) => `${residentId}:${partId || "mcq"}`;

function groupExamRecords(records) {
  const events = new Map();
  for (const row of records || []) {
    if (!events.has(row.event_id)) {
      events.set(row.event_id, {
        id: row.event_id,
        type: row.exam_type,
        date: row.exam_date,
        title: row.title,
        maxScore: row.max_score,
        status: row.status,
        participants: new Map(),
        parts: new Map(),
        results: new Map(),
      });
    }
    const event = events.get(row.event_id);
    if (!event.participants.has(row.participant_id)) {
      event.participants.set(row.participant_id, {
        id: row.participant_id,
        name: row.resident_name,
        pgy: row.resident_pgy,
      });
    }
    if (row.part_id && !event.parts.has(row.part_id)) {
      event.parts.set(row.part_id, {
        id: row.part_id,
        name: row.part_name,
        sortOrder: row.part_sort_order,
      });
    }
    if (row.outcome) {
      event.results.set(resultKey(row.participant_id, row.part_id), {
        score: row.score,
        outcome: row.outcome,
        updatedAt: row.result_updated_at,
      });
    }
  }
  return [...events.values()]
    .map((event) => ({
      ...event,
      participants: [...event.participants.values()].sort((a, b) =>
        a.name.localeCompare(b.name, "th"),
      ),
      parts: [...event.parts.values()].sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .sort((a, b) => `${b.date}:${b.id}`.localeCompare(`${a.date}:${a.id}`));
}

function EventResultTable({ event, participants = event.participants }) {
  if (!participants.length) return null;
  return (
    <div className="resident-table-wrap">
      <table className="exam-result-table">
        <thead>
          <tr>
            <th>Resident</th>
            <th>PGY</th>
            {event.type === "mcq" ? (
              <>
                <th>คะแนน</th>
                <th>ผล</th>
              </>
            ) : (
              event.parts.map((part) => <th key={part.id}>{part.name}</th>)
            )}
          </tr>
        </thead>
        <tbody>
          {participants.map((participant) => {
            const mcqResult = event.results.get(resultKey(participant.id, null));
            return (
              <tr key={participant.id}>
                <td>{participant.name}</td>
                <td>{participant.pgy ? `PGY ${participant.pgy}` : "—"}</td>
                {event.type === "mcq" ? (
                  <>
                    <td>
                      {mcqResult?.score ?? "—"}
                      {event.maxScore != null ? ` / ${event.maxScore}` : ""}
                    </td>
                    <td>{outcomeLabel(mcqResult?.outcome)}</td>
                  </>
                ) : (
                  event.parts.map((part) => (
                    <td key={part.id}>
                      {outcomeLabel(
                        event.results.get(resultKey(participant.id, part.id))
                          ?.outcome,
                      )}
                    </td>
                  ))
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NewExamForm({ residents, onCreated }) {
  const [type, setType] = useState("xray_anatomy");
  const [date, setDate] = useState(today());
  const [title, setTitle] = useState("X-ray & Anatomy");
  const [maxScore, setMaxScore] = useState("");
  const [parts, setParts] = useState([""]);
  const [participantIds, setParticipantIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const residentIds = useMemo(() => residents.map((resident) => resident.id), [residents]);
  useEffect(() => {
    setParticipantIds((current) => (current.length ? current : residentIds));
  }, [residentIds]);

  const toggleParticipant = (id) =>
    setParticipantIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  const changeType = (nextType) => {
    setType(nextType);
    setTitle(nextType === "mcq" ? "MCQ" : "X-ray & Anatomy");
    setError("");
  };
  async function submit(event) {
    event.preventDefault();
    const cleanedParts = parts.map((part) => part.trim());
    if (!participantIds.length) return setError("กรุณาเลือก Resident ที่เข้าสอบอย่างน้อย 1 คน");
    if (!title.trim()) return setError("กรุณาระบุชื่อข้อสอบ");
    if (type === "mcq" && (!maxScore || Number(maxScore) <= 0))
      return setError("กรุณาระบุคะแนนเต็ม MCQ ที่มากกว่า 0");
    if (type === "xray_anatomy" && (!cleanedParts.length || cleanedParts.some((part) => !part)))
      return setError("กรุณาระบุ part X-ray & Anatomy ทุกช่อง");
    if (new Set(cleanedParts.map((part) => part.toLowerCase())).size !== cleanedParts.length)
      return setError("ชื่อ part X-ray & Anatomy ห้ามซ้ำกัน");
    setBusy(true);
    setError("");
    try {
      const eventId = await createResidentExam({
        type,
        date,
        title,
        maxScore,
        partNames: type === "xray_anatomy" ? cleanedParts : [],
        participantIds,
      });
      await onCreated(eventId);
      setParts([""]);
      setMaxScore("");
    } catch (nextError) {
      setError(nextError.message || "สร้างรายการสอบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="resident-panel exam-create-form" onSubmit={submit}>
      <div className="section-heading">
        <h2>สร้างรายการสอบ</h2>
        <p>รายการใหม่เป็น Draft และจะยังไม่แสดงต่อ Resident หรือ Staff</p>
      </div>
      <div className="resident-form-grid">
        <label>
          ประเภทข้อสอบ
          <select value={type} onChange={(event) => changeType(event.target.value)}>
            <option value="xray_anatomy">X-ray &amp; Anatomy</option>
            <option value="mcq">MCQ</option>
          </select>
        </label>
        <label>
          วันที่สอบ
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="wide">
          ชื่อข้อสอบ
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength="160" required />
        </label>
        {type === "mcq" ? (
          <label>
            คะแนนเต็ม
            <input type="number" inputMode="decimal" min="0.01" step="0.01" value={maxScore} onChange={(event) => setMaxScore(event.target.value)} required />
          </label>
        ) : (
          <div className="wide exam-parts">
            <strong>Part X-ray &amp; Anatomy</strong>
            {parts.map((part, index) => (
              <div key={index} className="exam-part-row">
                <input aria-label={`Part ${index + 1}`} value={part} maxLength="120" placeholder="เช่น Upper GI, Breast" onChange={(event) => setParts((current) => current.map((item, position) => position === index ? event.target.value : item))} />
                {parts.length > 1 && <button type="button" className="text-button" onClick={() => setParts((current) => current.filter((_, position) => position !== index))}>ลบ</button>}
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={() => setParts((current) => [...current, ""])}>เพิ่ม part</button>
          </div>
        )}
        <fieldset className="wide exam-participants">
          <legend>Resident ที่เข้าสอบ</legend>
          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => setParticipantIds(residentIds)}>เลือกทั้งหมด</button>
            <button type="button" className="secondary-button" onClick={() => setParticipantIds([])}>ยกเลิกทั้งหมด</button>
          </div>
          <div className="exam-participant-list">
            {residents.map((resident) => (
              <label key={resident.id} className="exam-participant-option">
                <input type="checkbox" checked={participantIds.includes(resident.id)} onChange={() => toggleParticipant(resident.id)} />
                <span>{resident.name} · PGY {resident.pgy}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "กำลังสร้าง…" : "สร้าง Draft"}</button>
    </form>
  );
}

function ExamEditor({ event, onRefresh }) {
  const expectedCells = useMemo(
    () =>
      event.participants.flatMap((participant) =>
        event.type === "mcq"
          ? [{ resident: participant, part: null }]
          : event.parts.map((part) => ({ resident: participant, part })),
      ),
    [event],
  );
  const [cells, setCells] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const initial = {};
    expectedCells.forEach(({ resident, part }) => {
      const current = event.results.get(resultKey(resident.id, part?.id));
      initial[resultKey(resident.id, part?.id)] = {
        score: current?.score ?? "",
        outcome: current?.outcome ?? "",
      };
    });
    setCells(initial);
    setError("");
    setMessage("");
  }, [event.id, event.status]);
  const setCell = (key, changes) =>
    setCells((current) => ({ ...current, [key]: { ...current[key], ...changes } }));
  const payload = (requireComplete) => {
    const records = [];
    for (const { resident, part } of expectedCells) {
      const value = cells[resultKey(resident.id, part?.id)] || {};
      const hasScore = event.type !== "mcq" || value.score !== "";
      const hasOutcome = Boolean(value.outcome);
      if (!hasScore && !hasOutcome) {
        if (requireComplete) throw new Error("กรุณากรอกผลให้ครบทุก Resident ก่อนเผยแพร่");
        continue;
      }
      if (!hasScore || !hasOutcome)
        throw new Error("กรุณากรอกคะแนนและผลให้ครบในรายการที่เริ่มกรอกแล้ว");
      records.push({
        residentId: resident.id,
        partId: part?.id || null,
        score: event.type === "mcq" ? String(value.score) : null,
        outcome: value.outcome,
      });
    }
    return records;
  };
  async function save() {
    setBusy("save");
    setError("");
    setMessage("");
    try {
      await saveResidentExamResults(event.id, payload(false));
      await onRefresh();
      setMessage("บันทึก Draft แล้ว");
    } catch (nextError) {
      setError(nextError.message || "บันทึกผลสอบไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }
  async function publish() {
    setBusy("publish");
    setError("");
    setMessage("");
    try {
      await saveResidentExamResults(event.id, payload(true));
      await setResidentExamPublication(event.id, true);
      await onRefresh();
      setMessage("เผยแพร่ผลสอบแล้ว");
    } catch (nextError) {
      setError(nextError.message || "เผยแพร่ผลสอบไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }
  async function returnToDraft() {
    if (!window.confirm("นำผลสอบกลับเป็น Draft เพื่อแก้ไข? Resident และ Staff จะไม่เห็นผลจนเผยแพร่อีกครั้ง")) return;
    setBusy("draft");
    setError("");
    setMessage("");
    try {
      await setResidentExamPublication(event.id, false);
      await onRefresh();
      setMessage("นำผลสอบกลับเป็น Draft แล้ว");
    } catch (nextError) {
      setError(nextError.message || "ไม่สามารถนำกลับ Draft ได้");
    } finally {
      setBusy("");
    }
  }
  const disabled = event.status !== "draft" || Boolean(busy);
  return (
    <section className="resident-panel exam-editor">
      <div className="section-heading">
        <h2>{event.title}</h2>
        <p>{eventTypeLabel(event.type)} · {thaiDate(event.date)} · <span className={`status-chip ${event.status}`}>{event.status === "published" ? "เผยแพร่แล้ว" : "Draft"}</span></p>
      </div>
      <div className="resident-table-wrap">
        <table className="exam-editor-table">
          <thead>
            <tr>
              <th>Resident</th><th>PGY</th>
              {event.type === "mcq" ? <><th>คะแนน / {event.maxScore}</th><th>ผล</th></> : event.parts.map((part) => <th key={part.id}>{part.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {event.participants.map((participant) => (
              <tr key={participant.id}>
                <td>{participant.name}</td><td>PGY {participant.pgy}</td>
                {event.type === "mcq" ? (() => {
                  const key = resultKey(participant.id, null);
                  const value = cells[key] || {};
                  return <><td><input aria-label={`คะแนน ${participant.name}`} type="number" inputMode="decimal" min="0" max={event.maxScore} step="0.01" value={value.score} disabled={disabled} onChange={(event) => setCell(key, { score: event.target.value })} /></td><td><select aria-label={`ผล ${participant.name}`} value={value.outcome} disabled={disabled} onChange={(event) => setCell(key, { outcome: event.target.value })}><option value="">เลือกผล</option><option value="pass">ผ่าน</option><option value="remediation">ต้องซ่อม</option></select></td></>;
                })() : event.parts.map((part) => {
                  const key = resultKey(participant.id, part.id);
                  const value = cells[key] || {};
                  return <td key={part.id}><select aria-label={`ผล ${part.name} ของ ${participant.name}`} value={value.outcome} disabled={disabled} onChange={(event) => setCell(key, { outcome: event.target.value })}><option value="">เลือกผล</option><option value="pass">ผ่าน</option><option value="remediation">ต้องซ่อม</option></select></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <div className="button-row">
        {event.status === "draft" ? <><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={save}>{busy === "save" ? "กำลังบันทึก…" : "บันทึก Draft"}</button><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={publish}>{busy === "publish" ? "กำลังเผยแพร่…" : "เผยแพร่ผลสอบ"}</button></> : <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={returnToDraft}>{busy === "draft" ? "กำลังดำเนินการ…" : "นำกลับ Draft เพื่อแก้ไข"}</button>}
      </div>
    </section>
  );
}

function ExamResults({ events, user }) {
  const [pgy, setPgy] = useState("");
  const [residentId, setResidentId] = useState("");
  const residents = useMemo(() => {
    const choices = new Map();
    events.forEach((event) => event.participants.forEach((participant) => choices.set(participant.id, participant)));
    return [...choices.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [events]);
  const visibleEvents = events.map((event) => ({
    ...event,
    participants: event.participants.filter((participant) =>
      (!pgy || Number(participant.pgy) === Number(pgy)) && (!residentId || participant.id === residentId),
    ),
  })).filter((event) => event.participants.length);
  return <>
    {user.role === "staff" && <section className="resident-panel exam-filters"><h2>ตัวกรองผลสอบ</h2><div className="round-filter-grid"><label>ชั้นปี (PGY)<select value={pgy} onChange={(event) => setPgy(event.target.value)}><option value="">ทุกชั้นปี</option>{[1, 2, 3, 4].map((year) => <option key={year} value={year}>PGY {year}</option>)}</select></label><label>Resident<select value={residentId} onChange={(event) => setResidentId(event.target.value)}><option value="">Resident ทุกคน</option>{residents.filter((resident) => !pgy || Number(resident.pgy) === Number(pgy)).map((resident) => <option key={resident.id} value={resident.id}>{resident.name} · PGY {resident.pgy}</option>)}</select></label></div></section>}
    {visibleEvents.map((event) => <section className="resident-panel exam-published-result" key={event.id}><div className="section-heading"><h2>{event.title}</h2><p>{eventTypeLabel(event.type)} · {thaiDate(event.date)}</p></div><EventResultTable event={event} /></section>)}
    {!visibleEvents.length && <section className="resident-panel empty"><h2>ยังไม่มีผลสอบที่เผยแพร่</h2><p>ผลสอบจะแสดงเมื่อ Admin เผยแพร่ครบทั้งชุดแล้ว</p></section>}
  </>;
}

export default function ResidentExams({ workspace, onRefresh }) {
  const events = useMemo(() => groupExamRecords(workspace.examRecords), [workspace.examRecords]);
  const [selectedId, setSelectedId] = useState("");
  const admin = workspace.user.role === "admin";
  const residents = useMemo(() => workspace.profiles.filter((profile) => profile.pgy), [workspace.profiles]);
  const selected = events.find((event) => event.id === selectedId) || events[0];
  if (!admin) return <ExamResults events={events} user={workspace.user} />;
  return <div className="exam-layout">
    <NewExamForm residents={residents} onCreated={async (eventId) => { setSelectedId(eventId); await onRefresh(); }} />
    <section className="resident-panel exam-event-picker"><h2>รายการสอบ</h2><label>เลือกข้อสอบ<select value={selected?.id || ""} onChange={(event) => setSelectedId(event.target.value)}>{events.map((event) => <option key={event.id} value={event.id}>{thaiDate(event.date)} · {event.title} · {event.status === "published" ? "เผยแพร่แล้ว" : "Draft"}</option>)}</select></label>{!events.length && <p className="muted-empty">ยังไม่มีรายการสอบ</p>}</section>
    {selected && <ExamEditor event={selected} onRefresh={onRefresh} />}
  </div>;
}
