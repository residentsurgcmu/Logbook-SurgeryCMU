import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { caseErrorMessage, caseSexLabel, CASE_TYPES, CASE_UNITS, conferenceWeek, conferenceWeekForCase, conferenceWindow } from "../residentCases";
import { bangkokIsoDate, shiftIsoDate } from "../roundSchedule";
import { loadAdmissionCases, loadCaseMedia, loadCasePeople, loadCasesByIds, loadConferenceSession, resetConferenceAgenda, saveConferenceAgenda } from "../residentCasesApi";
import { exportWeekDeck } from "../casePptxExport";
import { agendaCandidates, buildAgenda, canManageConference, conferenceRangeProblem, includedRows, moveId, moveToIndex } from "../conferenceAgenda";
import { CaseModal, CaseNotes, CaseTypeChip, personName, thaiDate } from "./CaseParts";

// One Friday conference. The agenda = cases admitted in the date range (automatic) minus the cases an organiser
// left out, plus older cases they added, in the order they chose. The organiser's changes are saved per meeting
// date, so everyone sees the same list. Table = the list; Deck = present one case at a time.
export default function ResidentConference({ user, initialCase = null }) {
  const [weekStart, setWeekStart] = useState(
    // A weekend admission is presented at the following Friday conference; with
    // no case selected, open the week that contains (or just ended before) today.
    () => (initialCase ? conferenceWeekForCase(initialCase.admit_date) : conferenceWeek(bangkokIsoDate())).start,
  );
  const [session, setSession] = useState(null);          // saved agenda for this meeting date, or null (= automatic)
  const [cases, setCases] = useState(null);              // cases for the range + the added older ones
  const [people, setPeople] = useState([]);
  const [view, setView] = useState(initialCase ? "deck" : "table");
  const [typeFilter, setTypeFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [index, setIndex] = useState(0);
  const [media, setMedia] = useState([]);
  const [photo, setPhoto] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const pendingId = useRef(initialCase?.id || null);
  const seq = useRef(0);
  const mediaSeq = useRef(0);

  const week = useMemo(() => conferenceWeek(weekStart), [weekStart]);
  const meetingDate = week.end;
  const defaultRange = useMemo(() => conferenceWindow(week.start), [week.start]);
  const range = session ? { from: session.range_from, to: session.range_to } : defaultRange;
  const canManage = canManageConference(user);

  useEffect(() => { loadCasePeople().then(setPeople).catch((nextError) => setError(caseErrorMessage(nextError))); }, []);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setCases(null);
    setError("");
    try {
      const saved = await loadConferenceSession(meetingDate);
      const from = saved?.range_from || defaultRange.from;
      const to = saved?.range_to || defaultRange.to;
      const [inRange, extra] = await Promise.all([
        loadAdmissionCases({ from, to }),
        saved?.added_case_ids?.length ? loadCasesByIds(saved.added_case_ids) : Promise.resolve([]),
      ]);
      if (mine !== seq.current) return;
      const byId = new Map([...inRange, ...extra].map((row) => [row.id, row]));
      setSession(saved);
      setCases([...byId.values()]);
    } catch (nextError) {
      if (mine === seq.current) setError(caseErrorMessage(nextError));
    }
  }, [meetingDate, defaultRange.from, defaultRange.to]);
  useEffect(() => { load(); }, [load]);

  const agenda = useMemo(
    () => buildAgenda({ cases: cases || [], from: range.from, to: range.to, excluded: session?.excluded_case_ids || [], added: session?.added_case_ids || [], order: session?.case_order || [] }),
    [cases, range.from, range.to, session],
  );
  const included = useMemo(() => includedRows(agenda), [agenda]);
  const shown = useMemo(() => included.filter((row) =>
    (typeFilter === "all" || (typeFilter === "unset" ? !row.treatment_type : row.treatment_type === typeFilter)) &&
    (unitFilter === "all" || row.unit_name === unitFilter)), [included, typeFilter, unitFilter]);

  // A case chosen from "New admissions" opens in Deck at that case.
  useEffect(() => {
    if (!cases || !pendingId.current) return;
    const wanted = shown.findIndex((row) => row.id === pendingId.current);
    const missing = wanted < 0;
    pendingId.current = null;
    if (wanted >= 0) setIndex(wanted);
    else if (missing) setError("ไม่พบเคสที่เลือกในรายการประชุมสัปดาห์นี้ (อาจถูกยกเว้น ถูกลบ หรือถูกย้ายไปแล้ว)");
  }, [cases, shown]);

  const current = shown[Math.min(index, Math.max(shown.length - 1, 0))] || null;
  useEffect(() => {
    const mine = ++mediaSeq.current;
    setMedia([]);
    setPhoto(0);
    if (!current || view !== "deck") return;
    loadCaseMedia(current.id)
      .then((rows) => { if (mine === mediaSeq.current) setMedia(rows); })
      .catch((nextError) => { if (mine === mediaSeq.current) setError(caseErrorMessage(nextError)); });
  }, [current?.id, view]);

  async function exportWeek() {
    if (exporting || !included.length) return;
    setExporting(true);
    setError("");
    setNotice("");
    try {
      const missing = await exportWeekDeck({ start: range.from, end: range.to }, included, people);
      if (missing) setError(`ดาวน์โหลด PowerPoint แล้ว แต่ใส่ภาพไม่ได้ ${missing} ภาพ`);
    } catch (nextError) {
      setError(caseErrorMessage(nextError));
    } finally {
      setExporting(false);
    }
  }

  const label = `${thaiDate(week.start)} – ${thaiDate(week.end)}`;
  const changed = session && (session.excluded_case_ids.length || session.added_case_ids.length || session.case_order.length);
  return (
    <section className="resident-panel case-present">
      <div className="case-weekbar">
        <button type="button" className="secondary-button" onClick={() => setWeekStart(shiftIsoDate(weekStart, -7))}>สัปดาห์ก่อน</button>
        <strong>{label}</strong>
        <button type="button" className="secondary-button" onClick={() => setWeekStart(shiftIsoDate(weekStart, 7))}>สัปดาห์ถัดไป</button>
        <button type="button" className="link-button" onClick={() => setWeekStart(conferenceWeek(bangkokIsoDate()).start)}>สัปดาห์นี้</button>
        {canManage && <button type="button" className="secondary-button" disabled={!cases} onClick={() => setEditing(true)}>จัดรายการประชุม</button>}
        <button type="button" className="primary-button" disabled={exporting || !included.length} onClick={exportWeek}>{exporting ? "กำลังสร้างไฟล์…" : `Export PowerPoint ตามรายการ (${included.length})`}</button>
      </div>
      <small className="case-muted">
        รวมเคสที่รับตั้งแต่ {thaiDate(range.from)} ถึง {thaiDate(range.to)}
        {changed ? ` · จัดรายการแล้ว (ยกเว้น ${session.excluded_case_ids.length} · เพิ่มเคสเก่า ${session.added_case_ids.length})` : " · รายการอัตโนมัติ"}
      </small>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
      {!cases && !error && <p className="case-muted">กำลังโหลดเคส…</p>}

      {cases && (
        <>
          <div className="conf-controls">
            <div className="case-view-switch" role="group" aria-label="รูปแบบการแสดงรายการประชุม">
              <button type="button" className={view === "table" ? "active" : ""} aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button>
              <button type="button" className={view === "deck" ? "active" : ""} aria-pressed={view === "deck"} onClick={() => setView("deck")}>Deck</button>
            </div>
            <label>Type<select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setIndex(0); }}><option value="all">ทุก Type</option>{CASE_TYPES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}<option value="unset">ยังไม่ระบุ</option></select></label>
            <label>หน่วย<select value={unitFilter} onChange={(event) => { setUnitFilter(event.target.value); setIndex(0); }}><option value="all">ทุกหน่วย</option>{CASE_UNITS.map((name) => <option key={name}>{name}</option>)}</select></label>
          </div>
          {included.length === 0 && <p className="case-muted">ไม่มีเคสในรายการประชุมสัปดาห์นี้{canManage ? ' กด "จัดรายการประชุม" เพื่อเพิ่มเคส' : ""}</p>}
          {included.length > 0 && shown.length === 0 && <p className="case-muted">ไม่มีเคสที่ตรงกับตัวกรอง</p>}
        </>
      )}

      {cases && view === "table" && shown.length > 0 && (
        <div className="resident-table-wrap">
          <table className="case-table conf-table">
            <thead><tr><th>ลำดับ</th><th>เคส / วันที่รับ</th><th>Diagnosis</th><th>หน่วย / Owner</th><th>Type</th><th /></tr></thead>
            <tbody>
              {shown.map((row, position) => (
                <tr key={row.id}>
                  <td data-label="ลำดับ">{position + 1}</td>
                  <td data-label="เคส"><div className="case-cell"><strong>{row.case_code}</strong>{agenda.find((item) => item.row.id === row.id)?.source === "added" && <span className="case-count">เพิ่มเอง</span>}<br /><small>{thaiDate(row.admit_date)}</small></div></td>
                  <td data-label="Diagnosis"><div className="case-cell">{row.diagnosis}<br /><small>{caseSexLabel(row.sex)} · {row.age_years} ปี</small></div></td>
                  <td data-label="หน่วย / Owner"><div className="case-cell">{row.unit_name}<br /><small>{personName(people, row.owner_id)}</small></div></td>
                  <td data-label="Type"><div className="case-cell"><CaseTypeChip type={row.treatment_type} /></div></td>
                  <td><button type="button" className="secondary-button" onClick={() => { setIndex(position); setView("deck"); }}>เปิด Deck</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cases && view === "deck" && current && (
        <>
          <div className="case-weekbar">
            <select aria-label="เลือกเคส" value={Math.min(index, shown.length - 1)} onChange={(event) => setIndex(Number(event.target.value))}>
              {shown.map((row, position) => <option key={row.id} value={position}>{row.case_code} · {row.diagnosis}</option>)}
            </select>
            <button type="button" className="secondary-button" disabled={index === 0} onClick={() => setIndex(index - 1)}>ก่อนหน้า</button>
            <strong>{Math.min(index, shown.length - 1) + 1} / {shown.length}</strong>
            <button type="button" className="secondary-button" disabled={index >= shown.length - 1} onClick={() => setIndex(index + 1)}>ถัดไป</button>
          </div>
          <div className="case-split">
            <div>
              <p><span className="case-count">{current.case_code}</span> <span className="case-count">{current.unit_name}</span> <CaseTypeChip type={current.treatment_type} /></p>
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
          <CaseNotes key={`${current.id}|${meetingDate}`} caseId={current.id} user={user} people={people} meetingDate={meetingDate} />
        </>
      )}

      {editing && (
        <AgendaEditor
          meetingDate={meetingDate}
          session={session}
          defaultRange={defaultRange}
          people={people}
          onClose={() => setEditing(false)}
          onSaved={async (message) => { setEditing(false); setNotice(message); setIndex(0); await load(); }}
          onConflict={async (nextError) => { setEditing(false); await load(); setError(caseErrorMessage(nextError)); }}
        />
      )}
    </section>
  );
}

// "จัดรายการประชุม": works on a draft; nothing is saved until "บันทึกรายการ" (Cancel throws the draft away).
// The list is a stack of item boxes: drag the handle to reorder (mouse or finger), or use the arrow buttons / keyboard.
const HandleIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
    <path d="M7 9l5-5 5 5M9.5 12h5M7 15l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ADD_LIMIT = 50;

function AgendaEditor({ meetingDate, session, defaultRange, people, onClose, onSaved, onConflict }) {
  const [pool, setPool] = useState(null);                  // every case, so older ones can be picked
  const [loadError, setLoadError] = useState("");
  const [from, setFrom] = useState(session?.range_from || defaultRange.from);
  const [to, setTo] = useState(session?.range_to || defaultRange.to);
  const [excluded, setExcluded] = useState(session?.excluded_case_ids || []);
  const [added, setAdded] = useState(session?.added_case_ids || []);
  const [order, setOrder] = useState(session?.case_order || []);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(null);                  // { id, dy, over } while a box is being dragged
  const listRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    loadAdmissionCases().then(setPool).catch((nextError) => setLoadError(caseErrorMessage(nextError)));
  }, []);
  const rangeProblem = conferenceRangeProblem(from, to);
  const candidates = useMemo(() => (pool && !rangeProblem ? agendaCandidates({ cases: pool, from, to }) : []), [pool, from, to, rangeProblem]);
  const draft = useMemo(
    () => (pool && !rangeProblem ? buildAgenda({ cases: pool, from, to, excluded, added, order }) : []),
    [pool, from, to, excluded, added, order, rangeProblem],
  );
  const listed = draft.filter((item) => !item.excluded);
  const listedIds = listed.map((item) => item.row.id);
  const excludedIds = draft.filter((item) => item.excluded).map((item) => item.row.id);
  const commitOrder = (ids) => setOrder([...ids, ...excludedIds]);

  // Cases that can still be put on the list: in-range ones that were taken off, and every older case.
  const addable = useMemo(() => candidates.filter((c) => (c.outside ? !added.includes(c.row.id) : excluded.includes(c.row.id))), [candidates, added, excluded]);
  const needle = search.trim().toLowerCase();
  const addableShown = addable.filter((c) => !needle || `${c.row.diagnosis} ${c.row.case_code}`.toLowerCase().includes(needle));
  const inRangeIds = useMemo(() => new Set(candidates.filter((c) => !c.outside).map((c) => c.row.id)), [candidates]);

  const takeOff = (row) => {
    if (busy) return;
    commitOrder(listedIds.filter((id) => id !== row.id));
    if (inRangeIds.has(row.id)) setExcluded((list) => (list.includes(row.id) ? list : [...list, row.id]));
    else setAdded((list) => list.filter((id) => id !== row.id));
  };
  const putOn = (row) => {
    if (busy) return;
    // goes to the end of the list
    setOrder([...listedIds, row.id, ...excludedIds.filter((id) => id !== row.id)]);
    if (inRangeIds.has(row.id)) setExcluded((list) => list.filter((id) => id !== row.id));
    else setAdded((list) => (list.includes(row.id) ? list : [...list, row.id]));
  };
  const step = (id, direction) => { if (!busy) commitOrder(moveId(listedIds, id, direction)); };

  // ---- dragging (pointer events: one code path for mouse, pen and finger; the handle has touch-action:none)
  function startDrag(event, id, index) {
    if (busy || (event.button != null && event.button !== 0)) return;
    const list = listRef.current;
    if (!list) return;
    const boxes = [...list.querySelectorAll("[data-box]")];
    const rects = boxes.map((box) => { const r = box.getBoundingClientRect(); return { top: r.top, height: r.height }; });
    dragRef.current = { id, index, startY: event.clientY, startScroll: list.scrollTop, rects, pointerId: event.pointerId, raf: 0, lastY: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ id, dy: 0, over: index });
  }
  function overIndexFor(state, dy) {
    const { rects, index } = state;
    const center = rects[index].top + rects[index].height / 2 + dy;
    let best = index;
    let bestDistance = Infinity;
    rects.forEach((rect, position) => {
      const distance = Math.abs(rect.top + rect.height / 2 - center);
      if (distance < bestDistance) { best = position; bestDistance = distance; }
    });
    return best;
  }
  function updateDrag(clientY) {
    const state = dragRef.current;
    if (!state) return;
    state.lastY = clientY;
    const list = listRef.current;
    const dy = clientY - state.startY + (list ? list.scrollTop - state.startScroll : 0);
    setDrag({ id: state.id, dy, over: overIndexFor(state, dy) });
  }
  function autoScroll() {
    const state = dragRef.current;
    const list = listRef.current;
    if (!state || !list) return;
    const bounds = list.getBoundingClientRect();
    const edge = 44;
    let speed = 0;
    if (state.lastY < bounds.top + edge) speed = -Math.ceil((bounds.top + edge - state.lastY) / 6);
    else if (state.lastY > bounds.bottom - edge) speed = Math.ceil((state.lastY - (bounds.bottom - edge)) / 6);
    if (speed) { list.scrollTop += speed; updateDrag(state.lastY); }
    state.raf = requestAnimationFrame(autoScroll);
  }
  function moveDrag(event) {
    const state = dragRef.current;
    if (!state || event.pointerId !== state.pointerId) return;
    updateDrag(event.clientY);
    if (!state.raf) state.raf = requestAnimationFrame(autoScroll);
  }
  function endDrag(event, commit) {
    const state = dragRef.current;
    if (!state || (event && event.pointerId !== state.pointerId)) return;
    cancelAnimationFrame(state.raf);
    dragRef.current = null;
    const list = listRef.current;
    const dy = list ? event.clientY - state.startY + (list.scrollTop - state.startScroll) : 0;
    const over = overIndexFor(state, dy);
    setDrag(null);
    if (commit && over !== state.index) commitOrder(moveToIndex(listedIds, state.id, over));
  }
  useEffect(() => {
    // Escape while dragging cancels the drag instead of closing the dialog
    const onKey = (event) => {
      if (event.key === "Escape" && dragRef.current) {
        event.stopPropagation();
        cancelAnimationFrame(dragRef.current.raf);
        dragRef.current = null;
        setDrag(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => () => { if (dragRef.current) cancelAnimationFrame(dragRef.current.raf); }, []);

  function handleKey(event, id) {
    if (busy) return;
    if (event.key === "ArrowUp") { event.preventDefault(); step(id, -1); }
    else if (event.key === "ArrowDown") { event.preventDefault(); step(id, 1); }
  }
  const boxShift = (index) => {
    if (!drag) return undefined;
    const from = listedIds.indexOf(drag.id);
    if (index === from) return { transform: `translateY(${drag.dy}px)`, zIndex: 3, transition: "none" };
    const height = dragRef.current?.rects[from]?.height || 0;
    if (from < drag.over && index > from && index <= drag.over) return { transform: `translateY(${-height}px)` };
    if (from > drag.over && index < from && index >= drag.over) return { transform: `translateY(${height}px)` };
    return undefined;
  };

  async function save() {
    if (busy || rangeProblem) return;
    setBusy(true);
    setError("");
    try {
      await saveConferenceAgenda({
        meetingDate, from, to,
        excluded: excluded.filter((id) => inRangeIds.has(id)),
        added: added.filter((id) => !inRangeIds.has(id)),
        order: listedIds,
        expectedUpdatedAt: session?.updated_at || null,
      });
      await onSaved("บันทึกรายการประชุมแล้ว");
    } catch (nextError) {
      if (/CONFERENCE_CONFLICT/.test(String(nextError?.message || nextError))) await onConflict(nextError);
      else setError(caseErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (busy || !session) return;
    if (!window.confirm("กลับไปใช้รายการอัตโนมัติ? (ลบเฉพาะที่จัดไว้ ไม่ลบเคสใด ๆ)")) return;
    setBusy(true);
    setError("");
    try {
      await resetConferenceAgenda(meetingDate, session.updated_at);
      await onSaved("กลับเป็นรายการอัตโนมัติแล้ว");
    } catch (nextError) {
      if (/CONFERENCE_CONFLICT/.test(String(nextError?.message || nextError))) await onConflict(nextError);
      else setError(caseErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CaseModal title="จัดรายการประชุม" onClose={() => { if (!busy) onClose(); }}>
      <fieldset className="conf-fieldset" disabled={busy}>
      <p className="case-muted">ลากไอคอนด้านซ้ายของแต่ละกล่องเพื่อเรียงลำดับ (หรือใช้ปุ่มลูกศร) · กด "บันทึกรายการ" จึงจะมีผล และทุกคนจะเห็นรายการเดียวกัน</p>
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="conf-range">
        <label>รับตั้งแต่<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>ถึงวันที่<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      {rangeProblem && <p className="form-error" role="alert">{rangeProblem}</p>}
      {!pool && !loadError && <p className="case-muted">กำลังโหลดเคส…</p>}
      {pool && !rangeProblem && (
        <>
          <h4>ในรายการประชุม ({listed.length} เคส)</h4>
          {listed.length === 0 && <p className="case-muted">ยังไม่มีเคสในรายการ เพิ่มเคสจากด้านล่าง</p>}
          <ol className="conf-boxes" ref={listRef} aria-label="เคสในรายการประชุม" data-dragging={drag ? "true" : undefined}>
            {listed.map((item, position) => (
              <li key={item.row.id} data-box data-id={item.row.id} className={`conf-box${drag?.id === item.row.id ? " dragging" : ""}`} style={boxShift(position)}>
                <button
                  type="button"
                  className="conf-handle"
                  aria-label={`ลากเพื่อเรียงลำดับ ${item.row.case_code} (หรือกดลูกศรขึ้น-ลงบนคีย์บอร์ด)`}
                  onPointerDown={(event) => startDrag(event, item.row.id, position)}
                  onPointerMove={moveDrag}
                  onPointerUp={(event) => endDrag(event, true)}
                  onPointerCancel={(event) => endDrag(event, false)}
                  onKeyDown={(event) => handleKey(event, item.row.id)}
                ><HandleIcon /></button>
                <span className="conf-box-no">{position + 1}</span>
                <div className="conf-box-main">
                  <strong>{item.row.diagnosis}</strong>
                  <small>{item.row.case_code} · {thaiDate(item.row.admit_date)} · {item.row.unit_name}{item.source === "added" ? " · เพิ่มเอง" : ""}</small>
                </div>
                <CaseTypeChip type={item.row.treatment_type} />
                <div className="conf-box-actions">
                  <button type="button" className="conf-step" disabled={position === 0} onClick={() => step(item.row.id, -1)} aria-label={`เลื่อน ${item.row.case_code} ขึ้น`}>▲</button>
                  <button type="button" className="conf-step" disabled={position === listed.length - 1} onClick={() => step(item.row.id, 1)} aria-label={`เลื่อน ${item.row.case_code} ลง`}>▼</button>
                  <button type="button" className="link-button" onClick={() => takeOff(item.row)} aria-label={`เอา ${item.row.case_code} ออกจากรายการ`}>เอาออก</button>
                </div>
              </li>
            ))}
          </ol>

          <h4>เพิ่มเคสอื่น ({addable.length})</h4>
          <label className="conf-search">ค้นหา<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Diagnosis หรือรหัสเคส" /></label>
          <ul className="conf-addlist">
            {addableShown.slice(0, ADD_LIMIT).map((candidate) => (
              <li key={candidate.row.id}>
                <div>
                  <strong>{candidate.row.diagnosis}</strong>
                  <small>{candidate.row.case_code} · {thaiDate(candidate.row.admit_date)} · {candidate.row.unit_name} · {candidate.outside ? "นอกช่วงวัน" : "ถูกเอาออก"}</small>
                </div>
                <button type="button" className="secondary-button" onClick={() => putOn(candidate.row)} aria-label={`เพิ่ม ${candidate.row.case_code} เข้ารายการ`}>+ เพิ่ม</button>
              </li>
            ))}
            {addableShown.length === 0 && <li className="case-muted">{addable.length ? "ไม่พบเคสที่ตรงกับคำค้น" : "ไม่มีเคสอื่นให้เพิ่ม"}</li>}
            {addableShown.length > ADD_LIMIT && <li className="case-muted">แสดง {ADD_LIMIT} รายการแรก ใช้ช่องค้นหาเพื่อกรอง</li>}
          </ul>
        </>
      )}
      </fieldset>
      {busy && <p className="case-muted" role="status">กำลังบันทึก… กรุณารอสักครู่ ระหว่างนี้แก้ไขหรือปิดหน้าต่างไม่ได้</p>}
      <div className="button-row conf-editor-actions">
        {session && <button type="button" className="link-button" disabled={busy} onClick={reset}>กลับเป็นรายการอัตโนมัติ</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>ยกเลิก</button>
        <button type="button" className="primary-button" disabled={busy || Boolean(rangeProblem) || !pool} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึกรายการ"}</button>
      </div>
    </CaseModal>
  );
}
