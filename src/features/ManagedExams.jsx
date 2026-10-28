import React, { useEffect, useMemo, useRef, useState } from "react";
import { managedExamsApi as api, listAdminAccounts } from "../residentApi";
import { groupManagedRows, managedAttempt, managedCellLabel, OVERALL_LABELS } from "../managedExams.js";
import { buildManagedTemplate, buildManagedResultsWorkbook, downloadManagedBook, loadManagedExcel, parseManagedTemplate, XLSX_LIMITS } from "../managedExamExcel.js";
import "./ManagedExams.css";

function useAction(onDone) {
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const attempt = useRef(null), inFlight = useRef(false);
  useEffect(() => {
    if (!pending && !busy) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [pending, busy]);
  async function execute(operation, args) {
    if (inFlight.current || (pending && operation !== pending.operation)) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    const next = pending || managedAttempt(attempt.current, operation, args); attempt.current = next;
    try {
      const result = await api.mutate(next.operation, next);
      setPending(null); attempt.current = null; setMessage("บันทึกสำเร็จแล้ว");
      try { await onDone(result); } catch { setError("บันทึกสำเร็จ แต่โหลดผลกลับไม่สำเร็จ กรุณากดโหลดใหม่ก่อนทำรายการต่อ"); }
    } catch (e) { setError(e.message); if (e.uncertain) setPending(e.recoveryAttempt || next); else { attempt.current = null; setPending(null); } }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { execute, locked: busy || Boolean(pending), feedback: <>
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status" className="form-success">{message}</p>}
    {pending && <div className="rc04-callout" role="alert">ยังยืนยันผลรายการล่าสุดไม่ได้ กรุณาส่งรายการเดิมอีกครั้งก่อนแก้ข้อมูล
      <button type="button" disabled={busy} className="secondary-button" onClick={() => execute(pending.operation, pending.args)}>ตรวจผล / ลองรายการเดิม</button>
    </div>}
  </> };
}
const readable = (s) => s === "unknown" ? "ยังไม่มีข้อมูล" : s === "absent" ? "ขาดสอบ" : s === "awaiting" ? "ยังไม่สอบ" : String(s ?? "—");
function PageControls({ page, setPage, count }) {
  if (count <= 100) return null;
  return <div className="button-row"><button type="button" className="secondary-button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</button><span>รายการ {page * 100 + 1}–{Math.min(count, (page + 1) * 100)} จาก {count}</span><button type="button" className="secondary-button" disabled={(page + 1) * 100 >= count} onClick={() => setPage((p) => p + 1)}>ถัดไป</button></div>;
}
function RevisionMetadata({ snapshot, action }) {
  const [title, setTitle] = useState(snapshot.exam.title), [date, setDate] = useState(snapshot.exam.exam_date), [year, setYear] = useState(snapshot.exam.academic_year), [reason, setReason] = useState("");
  const [people, setPeople] = useState(() => snapshot.roster.map((r) => ({ ...r }))), [parts, setParts] = useState(() => snapshot.parts.map((p) => ({ ...p, mpl: { ...p.mpl } }))), [accounts, setAccounts] = useState([]), [error, setError] = useState("");
  useEffect(() => { let alive = true; listAdminAccounts().then((rows) => { if (alive) setAccounts(rows.filter((a) => a.role === "resident")); }).catch(() => { if (alive) setError("โหลดบัญชีเพิ่มไม่ได้ ยังแก้รายชื่อเดิมได้"); }); return () => { alive = false; }; }, []);
  function submit(e) {
    e.preventDefault(); setError("");
    const isNum = (v) => v !== "" && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0 && Math.abs(Number(v) * 100 - Math.round(Number(v) * 100)) < 1e-7;
    if (!people.length || people.length > 200 || people.some((p) => ![1, 2, 3, 4].includes(Number(p.pgy_at_exam)) || !p.reference_name.trim())) return setError("ตรวจรายชื่อและชั้นปีให้ครบ จำนวนต้องเป็น 1–200 คน");
    if (parts.some((p) => !isNum(p.max_score) || Number(p.max_score) <= 0 || !p.name.trim() || Object.values(p.mpl).some((v) => v !== "" && (!isNum(v) || Number(v) > Number(p.max_score))))) return setError("คะแนนเต็มและ MPL ต้องเป็นตัวเลขที่ถูกต้อง ทศนิยมไม่เกิน 2 ตำแหน่ง");
    const oldIds = new Set(snapshot.roster.map((p) => p.resident_id)), ids = new Set(people.map((p) => p.resident_id));
    const changes = { title: title.trim(), exam_date: date, academic_year: Number(year), participants: people.filter((p) => oldIds.has(p.resident_id)).map((p) => ({ ...p, pgy_at_exam: Number(p.pgy_at_exam) })),
      add_participants: people.filter((p) => !oldIds.has(p.resident_id)).map((p) => ({ ...p, pgy_at_exam: Number(p.pgy_at_exam) })), remove_participants: snapshot.roster.filter((p) => !ids.has(p.resident_id)).map((p) => p.resident_id),
      parts: parts.map((p) => ({ part_id: p.part_id, name: p.name.trim(), max_score: Number(p.max_score), mpl: Object.fromEntries([1, 2, 3, 4].map((g) => [g, p.mpl[String(g)] === "" || p.mpl[String(g)] == null ? null : Number(p.mpl[String(g)])])) })) };
    if (changes.remove_participants.length && !reason.trim()) return setError("กรุณาระบุเหตุผลที่นำผู้สอบออก");
    action.execute("update_working_revision", { p_exam_id: snapshot.exam.exam_id, p_revision_id: snapshot.exam.revision_id, p_expected_version: snapshot.exam.version, p_changes: changes, p_reason: reason.trim() || null });
  }
  return <form onSubmit={submit} className="rc04-callout"><h3>แก้รายละเอียดฉบับร่าง</h3><p>การเปลี่ยนจริงทำให้ต้องตรวจใหม่ และแม่แบบ/ตัวอย่างเก่าหมดอายุ ผลประกาศเดิมยังไม่เปลี่ยน</p><fieldset disabled={action.locked}>
    <div className="rc04-grid"><label>ชื่อการสอบ<input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>วันสอบ<input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label>ปีการศึกษา พ.ศ.<input required type="number" min={2500} max={2700} value={year} onChange={(e) => setYear(e.target.value)} /></label></div>
    <details><summary>รายชื่อและชั้นปี ณ วันสอบ ({people.length} คน)</summary>{people.map((p, i) => <div className="rc04-roster" key={p.resident_id}><input aria-label={`ชื่ออ้างอิง ${i + 1}`} required maxLength={160} value={p.reference_name} onChange={(e) => setPeople((xs) => xs.map((x, j) => j === i ? { ...x, reference_name: e.target.value } : x))} /><select aria-label={`PGY ณ วันสอบ ${p.reference_name}`} value={p.pgy_at_exam} onChange={(e) => setPeople((xs) => xs.map((x, j) => j === i ? { ...x, pgy_at_exam: e.target.value } : x))}><option value="">ระบุ PGY</option>{[1, 2, 3, 4].map((g) => <option key={g}>{g}</option>)}</select><button type="button" className="text-button" onClick={() => setPeople((xs) => xs.filter((_, j) => j !== i))}>นำออก</button></div>)}<label>เพิ่มบัญชีผู้สอบ<select value="" onChange={(e) => { const a = accounts.find((x) => x.user_id === e.target.value); if (a) setPeople((xs) => [...xs, { resident_id: a.user_id, reference_name: a.full_name, pgy_at_exam: a.pgy ?? "" }]); }}><option value="">เลือกบัญชี Resident</option>{accounts.filter((a) => !people.some((p) => p.resident_id === a.user_id)).map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name}{!a.active ? " (ปิดบัญชี)" : ""}</option>)}</select></label></details>
    {parts.map((p, i) => <div key={p.part_id} className="rc04-grid rc04-part"><label>ชื่อส่วนสอบ<input required maxLength={120} value={p.name} onChange={(e) => setParts((xs) => xs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></label><label>คะแนนเต็ม<input required type="number" min="0.01" step="0.01" value={p.max_score} onChange={(e) => setParts((xs) => xs.map((x, j) => j === i ? { ...x, max_score: e.target.value } : x))} /></label>{[1, 2, 3, 4].map((g) => <label key={g}>MPL PGY {g}<input type="number" min="0" step="0.01" value={p.mpl[String(g)] ?? ""} onChange={(e) => setParts((xs) => xs.map((x, j) => j === i ? { ...x, mpl: { ...x.mpl, [g]: e.target.value } } : x))} /></label>)}</div>)}
    <label>เหตุผล (จำเป็นเมื่อนำผู้สอบออก)<textarea maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label><button className="primary-button">บันทึกรายละเอียดฉบับร่าง</button>
  </fieldset>{error && <p role="alert" className="form-error">{error}</p>}</form>;
}
function ResultStatus({ cell, overall }) {
  const tone = overall ? ({ all_passed: "pass", failed_some: "fail", incomplete: "pending" }[overall] || "neutral")
    : cell?.value_state === "scored" && ["pass", "fail"].includes(cell.outcome) ? cell.outcome
    : ["absent", "awaiting"].includes(cell?.value_state) ? "pending" : "neutral";
  return <span className={`rc04-result-status rc04-result-status--${tone}`}>{overall ? OVERALL_LABELS[overall] : cell ? managedCellLabel(cell) : "ข้อมูลไม่ครบ"}</span>;
}
function ResultTable({ rows }) {
  const groups = useMemo(() => groupManagedRows(rows), [rows]);
  return groups.map((exam) => <section className="resident-panel" key={exam.revision_id}>
    <h3>{exam.title}</h3><p>ปีการศึกษา {exam.academic_year} · {exam.exam_date}</p>
    <div className="resident-table-wrap"><table className="rc04-table"><thead><tr><th>ผู้สอบ / ชั้นปี ณ วันสอบ</th>{exam.parts.map((p) => <th key={p.id}>{p.name}</th>)}<th>ภาพรวม</th></tr></thead>
      <tbody>{exam.residents.map((r) => <tr key={r.id}><th>{r.name}<br /><small>PGY {r.pgy}</small></th>{exam.parts.map((p) => {
        const c = r.cells.get(p.id); return <td key={p.id}>{c ? <><ResultStatus cell={c} />{c.value_state === "scored" && <div>{c.score} / {c.max_score}</div>}<small>MPL {c.mpl ?? "ยังไม่ตั้งเกณฑ์"}</small></> : "ข้อมูลไม่ครบ"}</td>;
      })}<td><ResultStatus overall={r.overall.status} />{r.overall.failed_part_ids.length > 0 && <small>ส่วนที่ไม่ผ่าน: {exam.parts.filter((p) => r.overall.failed_part_ids.includes(p.id)).map((p) => p.name).join(", ")}</small>}</td></tr>)}</tbody>
    </table></div>
  </section>);
}
function PersonalResultCards({ rows }) {
  const groups = useMemo(() => groupManagedRows(rows), [rows]);
  return groups.map((exam) => <section className="ms-exam-result" key={exam.revision_id}>
    <h3>{exam.title}</h3><p className="ms-exam-meta">ปีการศึกษา {exam.academic_year} · {exam.exam_date}</p>
    {exam.residents.map((resident) => <div key={resident.id}>
      <p className="ms-exam-meta">{resident.name} · PGY {resident.pgy} ณ วันสอบ</p>
      <div className="ms-exam-overall"><ResultStatus overall={resident.overall.status} />{resident.overall.failed_part_ids.length > 0 && <small>ส่วนที่ไม่ผ่าน: {exam.parts.filter((part) => resident.overall.failed_part_ids.includes(part.id)).map((part) => part.name).join(", ")}</small>}</div>
      {exam.parts.map((part) => { const cell = resident.cells.get(part.id); return <div className="ms-exam-cell" key={part.id}><strong>{part.name}</strong><ResultStatus cell={cell} /><small>{cell?.value_state === "scored" && <>{cell.score} / {cell.max_score} · </>}MPL {cell?.mpl ?? "ยังไม่ตั้งเกณฑ์"}</small></div>; })}
    </div>)}
  </section>);
}

export function ManagedPublishedResults({ role, userId, initialYear = "", onYearChange, personalLayout = false }) {
  const [loaded, setBundle] = useState(null), [error, setError] = useState(""), [reload, setReload] = useState(0), [year, setYear] = useState(initialYear), [pgy, setPgy] = useState(""), [resident, setResident] = useState(""), [exporting, setExporting] = useState(false);
  const owner = `${userId}/${role}/${reload}`, exportTask = useRef(null), identity = useRef("");
  identity.current = `${owner}/${year}/${pgy}/${resident}`;
  const bundle = loaded?.owner === owner ? loaded.data : null;
  useEffect(() => {
    setExporting(false);
    return () => { exportTask.current?.abort(); exportTask.current = null; };
  }, [role, userId, reload, year, pgy, resident]);
  useEffect(() => {
    const control = new AbortController(); setBundle(null); setError("");
    api.setActor(userId);
    api.read(role === "resident" ? "own" : "staff", { signal: control.signal }).then((data) => { if (!control.signal.aborted) setBundle({ owner, data }); }).catch((e) => { if (!control.signal.aborted && e.name !== "AbortError") setError(e.message); });
    return () => control.abort();
  }, [role, userId, reload]);
  const rows = bundle?.rows || [], years = [...new Set(rows.map((r) => r.academic_year))].sort((a, b) => b - a);
  const residents = [...new Map(rows.map((r) => [r.resident_id, r.reference_name])).entries()];
  const visible = rows.filter((r) => (!year || r.academic_year === Number(year)) && (!pgy || r.pgy_at_exam === Number(pgy)) && (!resident || r.resident_id === resident));
  async function exportResults() {
    if (!bundle || exportTask.current) return;
    const task = new AbortController(), startedIdentity = identity.current, actorToken = api.actorToken();
    exportTask.current = task;
    const current = () => {
      task.signal.throwIfAborted(); api.assertActor(actorToken);
      if (exportTask.current !== task || identity.current !== startedIdentity) throw new DOMException("งานส่งออกถูกยกเลิก", "AbortError");
    };
    setExporting(true); setError("");
    try {
      // Re-authorise and re-read every pinned revision before export; never use half a cached read.
      const collected = [];
      for (const e of bundle.manifest.entries.filter((e) => !year || e.academic_year === Number(year))) {
        current();
        const read = await api.read(role === "resident" ? "own" : "staff", { examId: e.exam_id, revisionId: e.revision_id, signal: task.signal });
        current(); collected.push(...read.rows);
      }
      const selected = collected.filter((r) => (!pgy || r.pgy_at_exam === Number(pgy)) && (!resident || r.resident_id === resident));
      current(); const ExcelJS = await loadManagedExcel(); current();
      const book = buildManagedResultsWorkbook(ExcelJS, { rows: selected }); current();
      await downloadManagedBook(book, "RC04-published-results.xlsx", { signal: task.signal, assertCurrent: current });
    } catch (e) {
      if (e.name !== "AbortError" && !task.signal.aborted && identity.current === startedIdentity) { setError(e.message); setBundle(null); }
    } finally { if (exportTask.current === task) { exportTask.current = null; setExporting(false); } }
  }
  return <div className="rc04-area"><div className="button-row"><button className="secondary-button" onClick={() => setReload((n) => n + 1)}>โหลดผลใหม่</button><button className="secondary-button" disabled={!bundle || exporting || !visible.length} onClick={exportResults}>{exporting ? "กำลังสร้าง…" : "ส่งออกผลประกาศ Excel"}</button></div>
    {error && <p role="alert" className="form-error">{error} กรุณาโหลดใหม่ทั้งชุด</p>}{!bundle && !error && <p role="status">กำลังโหลดผลประกาศทุกปี…</p>}
    {bundle && <><div className="rc04-grid"><label>ปีการศึกษา<select aria-label="ปีการศึกษา" value={year} onChange={(e) => { setYear(e.target.value); onYearChange?.(e.target.value); }}><option value="">ทุกปี (รวมประวัติ)</option>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
      {role !== "resident" && <><label>PGY ณ วันสอบ<select value={pgy} onChange={(e) => setPgy(e.target.value)}><option value="">ทุกชั้นปี</option>{[1, 2, 3, 4].map((y) => <option key={y}>{y}</option>)}</select></label><label>ผู้สอบ<select value={resident} onChange={(e) => setResident(e.target.value)}><option value="">ทุกคน</option>{residents.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label></>}
    </div>{!visible.length ? <p>ยังไม่มีผลประกาศในกลุ่มที่เลือก ผลปีก่อนยังดูได้โดยเลือกทุกปี</p> : personalLayout && role === "resident" ? <PersonalResultCards rows={visible} /> : <ResultTable rows={visible} />}</>}
  </div>;
}
export function ManagedPersonalScores({ userId, personalLayout = false }) {
  const [open, setOpen] = useState(false), [year, setYear] = useState("");
  return <section className={`ms-card rc04-area${personalLayout ? " rc04-personal" : ""}`}><div className="ms-personal-heading"><h2>ผลการสอบของฉัน</h2><button className="secondary-button" aria-expanded={open} onClick={() => setOpen((x) => !x)}>{open ? "ซ่อนคะแนนสอบ" : "เปิดคะแนนสอบ"}</button></div><p className={personalLayout ? "ms-muted" : undefined}>คะแนนบนหน้าส่วนตัวเริ่มต้นเป็นซ่อน และซ่อนให้อีกครั้งเมื่อเปลี่ยนปี เปิดดูได้เมื่อพร้อม{year ? ` · ปีที่เลือก ${year}` : ""}</p>
    {open && <ManagedPublishedResults role="resident" userId={userId} initialYear={year} personalLayout={personalLayout} onYearChange={(next) => { setYear(next); setOpen(false); }} />}
  </section>;
}

function CreateManagedExam({ onCreated }) {
  const [accounts, setAccounts] = useState([]), [loadError, setLoadError] = useState(""), [title, setTitle] = useState("X-ray & Anatomy"), [date, setDate] = useState(""), [year, setYear] = useState(String(new Date().getFullYear() + 543));
  const [roster, setRoster] = useState([]), [parts, setParts] = useState([{ name: "", max: "", mpl: { 1: "", 2: "", 3: "", 4: "" } }]), [confirmed, setConfirmed] = useState(false), [error, setError] = useState("");
  useEffect(() => { let alive = true; listAdminAccounts().then((all) => { if (!alive) return; const people = all.filter((a) => a.role === "resident"); setAccounts(people); setRoster(people.filter((a) => a.active).map((a) => ({ resident_id: a.user_id, reference_name: a.full_name, pgy_at_exam: a.pgy ?? "" }))); }).catch(() => alive && setLoadError("โหลดบัญชี Resident ไม่สำเร็จ กรุณาโหลดหน้าใหม่")); return () => { alive = false; }; }, []);
  const action = useAction(onCreated);
  function submit(e) {
    e.preventDefault(); setError("");
    if (!confirmed || !roster.length || roster.length > 200 || roster.some((r) => ![1, 2, 3, 4].includes(Number(r.pgy_at_exam)))) return setError("เลือกผู้สอบและยืนยันชั้นปี ณ วันสอบทุกคน");
    const levels = [...new Set(roster.map((r) => String(r.pgy_at_exam)))];
    const number = (v) => v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 && Math.abs(Number(v) * 100 - Math.round(Number(v) * 100)) < 1e-7;
    if (parts.some((p) => !p.name.trim() || !number(p.max) || Number(p.max) <= 0 || levels.some((g) => !number(p.mpl[g]) || Number(p.mpl[g]) > Number(p.max)))) return setError("ตั้งชื่อส่วนสอบ คะแนนเต็ม และ MPL ตามชั้นปีที่เลือกให้ครบ (ทศนิยมไม่เกิน 2 ตำแหน่ง)");
    action.execute("create_managed_exam", { p_payload: { exam_type: "xray_anatomy", title: title.trim(), exam_date: date, academic_year: Number(year), roster: roster.map((r) => ({ ...r, pgy_at_exam: Number(r.pgy_at_exam) })), parts: parts.map((p, i) => ({ name: p.name.trim(), sort_order: i + 1, max_score: Number(p.max), mpl: Object.fromEntries(Object.entries(p.mpl).filter(([, v]) => v !== "").map(([g, v]) => [g, Number(v)])) })) } });
  }
  return <form className="resident-panel rc04-area" onSubmit={submit}><h2>สร้างการสอบสำหรับนำเข้าคะแนน</h2><p>สร้างเป็นฉบับร่าง ตรวจแล้วและประกาศผลเป็นคนละปุ่ม ยังไม่มีการแจ้งเตือนอัตโนมัติ</p>
    <fieldset disabled={action.locked || Boolean(loadError)}><div className="rc04-grid"><label>ชื่อการสอบ<input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>วันสอบ<input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label>ปีการศึกษา พ.ศ.<input required type="number" min={2500} max={2700} value={year} onChange={(e) => setYear(e.target.value)} /></label></div>
      <details><summary>ผู้สอบและชั้นปี ณ วันสอบ ({roster.length} คน)</summary><p>รายชื่อเชื่อมบัญชีจริง เลือกค่าเริ่มต้นเฉพาะบัญชีที่เปิดใช้งาน ชั้นปีนี้ไม่เปลี่ยนชั้นปีในบัญชี</p>
        <button type="button" className="text-button" onClick={() => { setRoster([]); setConfirmed(false); }}>ยกเลิกทั้งหมด</button>
        {accounts.map((a) => { const selected = roster.find((r) => r.resident_id === a.user_id); return <div key={a.user_id} className="rc04-roster"><label><input type="checkbox" checked={Boolean(selected)} onChange={(e) => { setConfirmed(false); setRoster((r) => e.target.checked ? [...r, { resident_id: a.user_id, reference_name: a.full_name, pgy_at_exam: a.pgy ?? "" }] : r.filter((x) => x.resident_id !== a.user_id)); }} />{a.full_name}{!a.active ? " (บัญชีปิด)" : ""}</label>{selected && <select aria-label={`PGY ณ วันสอบ ${a.full_name}`} value={selected.pgy_at_exam} onChange={(e) => { setConfirmed(false); setRoster((r) => r.map((x) => x.resident_id === a.user_id ? { ...x, pgy_at_exam: e.target.value } : x)); }}><option value="">ระบุ PGY</option>{[1, 2, 3, 4].map((g) => <option key={g}>{g}</option>)}</select>}</div>; })}
      </details><label className="rc04-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />ตรวจรายชื่อและชั้นปี ณ วันสอบแล้ว</label>
      <h3>ส่วนสอบและเกณฑ์</h3><p>เพิ่ม/ลบส่วนสอบได้ก่อนสร้างเท่านั้น MPL เป็นเกณฑ์ของครั้งนี้ ไม่เปลี่ยนผลปีก่อน</p>
      {parts.map((p, i) => <div className="rc04-grid rc04-part" key={i}><label>ส่วนสอบ {i + 1}<input required value={p.name} maxLength={120} onChange={(e) => setParts((ps) => ps.map((x, j) => i === j ? { ...x, name: e.target.value } : x))} /></label><label>คะแนนเต็ม<input required type="number" min="0.01" step="0.01" value={p.max} onChange={(e) => setParts((ps) => ps.map((x, j) => i === j ? { ...x, max: e.target.value } : x))} /></label>{[1, 2, 3, 4].map((g) => <label key={g}>MPL PGY {g}<input type="number" min="0" step="0.01" value={p.mpl[g]} onChange={(e) => setParts((ps) => ps.map((x, j) => i === j ? { ...x, mpl: { ...x.mpl, [g]: e.target.value } } : x))} /></label>)}{parts.length > 1 && <button type="button" className="text-button" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>ลบส่วนนี้</button>}</div>)}
      <button type="button" className="secondary-button" disabled={parts.length >= 50} onClick={() => setParts((ps) => [...ps, { name: "", max: "", mpl: { 1: "", 2: "", 3: "", 4: "" } }])}>เพิ่มส่วนสอบ</button><button className="primary-button">สร้างฉบับร่าง</button>
    </fieldset>{(error || loadError) && <p className="form-error" role="alert">{error || loadError}</p>}{action.feedback}
  </form>;
}

function RevisionEditor({ snapshot, publishedId, onDone }) {
  const [preview, setPreview] = useState(null), [importInfo, setImportInfo] = useState(null), [reason, setReason] = useState(""), [checked, setChecked] = useState(false), [confirmedScope, setConfirmedScope] = useState(false), [ioBusy, setIoBusy] = useState(false), [error, setError] = useState("");
  const [editing, setEditing] = useState(false), [diffPage, setDiffPage] = useState(0), [cellPage, setCellPage] = useState(0);
  const ioTask = useRef(null);
  useEffect(() => () => { ioTask.current?.abort(); ioTask.current = null; }, []);
  const action = useAction(async (r) => { setPreview(null); await onDone(r); });
  const working = snapshot.exam.state === "working", locked = action.locked || ioBusy;
  const counts = snapshot.validation.counts, base = { p_exam_id: snapshot.exam.exam_id, p_revision_id: snapshot.exam.revision_id, p_expected_version: snapshot.exam.version };
  async function template() {
    const task = new AbortController(), actorToken = api.actorToken(); ioTask.current = task;
    const current = () => { task.signal.throwIfAborted(); api.assertActor(actorToken); if (ioTask.current !== task) throw new DOMException("งานถูกยกเลิก", "AbortError"); };
    setIoBusy(true); setError("");
    try {
      const ExcelJS = await loadManagedExcel(); current();
      await downloadManagedBook(buildManagedTemplate(ExcelJS, snapshot), `RC04-${snapshot.exam.exam_id}-${snapshot.exam.version}.xlsx`, { signal: task.signal, assertCurrent: current });
    } catch (e) { if (e.name !== "AbortError") setError(e.message); }
    finally { if (ioTask.current === task) { ioTask.current = null; setIoBusy(false); } }
  }
  async function upload(e) {
    const file = e.target.files?.[0]; e.target.value = ""; setPreview(null); setImportInfo(null); setReason(""); setChecked(false); setConfirmedScope(false); setError(""); if (!file) return;
    if (file.size > XLSX_LIMITS.file) return setError("ไฟล์ต้องไม่เกิน 5 MB");
    setIoBusy(true);
    try {
      const data = await file.arrayBuffer(), parsed = await parseManagedTemplate(await loadManagedExcel(), data, file.name, snapshot);
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const response = await api.preview({ ...base, p_cells: parsed.cells, p_file_evidence: { file_hash: hash, file_name: file.name }, p_file_reported: parsed.reported });
      if (!response.ok) {
        const labels = { SCORE_NEGATIVE: "คะแนนติดลบ", SCORE_EXCEEDS_MAX: "คะแนนเกินเต็ม", SCORE_TOO_PRECISE: "ทศนิยมเกิน 2 ตำแหน่ง", INVALID_SCORE_TYPE: "คะแนนต้องเป็นตัวเลข", DUPLICATE_CELL: "พบข้อมูลซ้ำ", STATE_WITH_SCORE: "มีทั้งคะแนนและสถานะขาดสอบ/ยังไม่สอบ", UNKNOWN_RESIDENT: "ผู้สอบไม่อยู่ในรายการ", UNKNOWN_PART: "ส่วนสอบไม่อยู่ในรายการ" };
        throw new Error(response.errors.map((x) => `${x.cell_ref || "ไฟล์"}: ${labels[x.code] || "ข้อมูลไม่ตรงแม่แบบ กรุณาดาวน์โหลดฉบับใหม่"}`).join("; "));
      }
      setPreview(response); setImportInfo(parsed); setDiffPage(0);
    } catch (ex) { setError(ex.message); } finally { setIoBusy(false); }
  }
  const labels = (v) => `${readable(v.value_state)}${v.score !== null ? ` · ${v.score}` : ""} · ${managedCellLabel(v)}`;
  return <section className="resident-panel rc04-area"><h2>{snapshot.exam.title}</h2><p>ปีการศึกษา {snapshot.exam.academic_year} · {snapshot.exam.exam_date} · ฉบับ {snapshot.exam.revision_seq} · {working ? snapshot.reviewed ? "ตรวจแล้ว ยังไม่ประกาศ" : "ฉบับร่าง" : "ประกาศแล้ว"}</p>
    <p>ผู้สอบ {snapshot.roster.length} คน · มีคะแนน {counts.scored} · ขาดสอบ {counts.absent} · ยังไม่สอบ {counts.awaiting} · ไม่มีข้อมูล {counts.unknown} · เกณฑ์ขาด {counts.criteria_missing}</p>
    {working && <fieldset disabled={locked || editing}><div className="button-row"><button className="secondary-button" onClick={template}>1. ดาวน์โหลดแม่แบบ Excel</button><label>2. นำเข้าไฟล์ XLSX<input type="file" accept=".xlsx" onChange={upload} /></label></div>
      <p>ช่องว่างไม่ลบคะแนนเดิม ศูนย์คือคะแนนจริง หากแก้เป็นขาดสอบ/ยังไม่สอบให้ล้างช่องคะแนนและเลือกสถานะชัดเจน</p>
    </fieldset>}
    {working && <><button className="secondary-button" disabled={locked || Boolean(preview)} onClick={() => setEditing((x) => !x)}>{editing ? "ปิดแบบแก้รายละเอียด" : "แก้ชื่อ / วันที่ / ผู้สอบ / ชั้นปี / เกณฑ์"}</button>{editing && <RevisionMetadata snapshot={snapshot} action={action} />}</>}
    {preview && <section className="rc04-callout"><h3>3. ตรวจเทียบก่อนบันทึก</h3><p>เปลี่ยน {preview.counts.changed} ช่อง · คงเดิม {preview.counts.unchanged} ช่อง · ผู้สอบที่ไม่ได้อยู่ในไฟล์ {importInfo.missingResidents} คน (คงข้อมูลเดิม)</p>
      <p>โปรดเปิดเทียบ Excel หรือกระดาษคำตอบ รหัสบัญชีช่วยจับคู่แต่ไม่ยืนยันว่ากรอกคะแนนถูกคน</p>
      <PageControls page={diffPage} setPage={setDiffPage} count={preview.diff.length} />
      <div className="resident-table-wrap"><table className="rc04-table"><thead><tr><th>ผู้สอบ</th><th>ส่วนสอบ / เซลล์</th><th>เดิม</th><th>ใหม่</th></tr></thead><tbody>{preview.diff.slice(diffPage * 100, (diffPage + 1) * 100).map((d) => <tr key={`${d.resident_id}/${d.part_id}`}><td>{snapshot.roster.find((r) => r.resident_id === d.resident_id)?.reference_name}</td><td>{snapshot.parts.find((p) => p.part_id === d.part_id)?.name}<br />{d.cell_ref}</td><td>{labels(d.before)}</td><td>{labels(d.after)}</td></tr>)}</tbody></table></div>
      <fieldset disabled={locked}><label className="rc04-check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />ตรวจเทียบรายการเปลี่ยนกับต้นฉบับแล้ว</label><label className="rc04-check"><input type="checkbox" checked={confirmedScope} onChange={(e) => setConfirmedScope(e.target.checked)} />ยืนยันขอบเขตนำเข้า ส่วนที่ไม่ส่งคงเดิม ({preview.warnings.map((w) => `${w.code === "RESIDENTS_NOT_IN_FILE" ? "ผู้สอบที่ไม่ส่งคะแนน" : "ส่วนสอบที่ไม่ส่งคะแนน"}: ${w.count}`).join(", ") || "ไม่มีรายการที่หายไป"})</label>
        <label>เหตุผล{preview.requires_reason ? " (จำเป็น)" : " (ถ้ามี)"}<textarea maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label><button className="primary-button" disabled={!checked || !confirmedScope || (preview.requires_reason && !reason.trim())} onClick={() => action.execute("commit_import", { p_preview_id: preview.preview_id, p_expected_version: preview.expected_version, p_delta_fingerprint: preview.delta_fingerprint, p_reason: reason.trim() || null })}>บันทึกฉบับร่าง (ยังไม่ประกาศ)</button>
      </fieldset>
    </section>}
    {preview && <button className="text-button" disabled={locked} onClick={() => { setPreview(null); setChecked(false); }}>ยกเลิกตัวอย่าง (ไม่เปลี่ยนข้อมูล)</button>}
    {working && <fieldset disabled={locked || Boolean(preview) || editing}><label className="rc04-check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />ตรวจข้อมูลฉบับนี้แล้ว ยืนยันขาดสอบ {counts.absent} และยังไม่สอบ {counts.awaiting} ช่อง</label><div className="button-row">
      <button className="secondary-button" disabled={!checked || snapshot.validation.blockers.length > 0 || snapshot.reviewed} onClick={() => action.execute("mark_reviewed", { ...base, p_confirm: { absent: counts.absent, awaiting: counts.awaiting } })}>4. ตรวจแล้ว</button>
      <button className="primary-button" disabled={!checked || !snapshot.reviewed || snapshot.validation.blockers.length > 0} onClick={() => { if (window.confirm(`ประกาศผลฉบับนี้ให้ Resident เจ้าของผลและ Staff เห็น? ขาดสอบ ${counts.absent} ช่อง ยังไม่สอบ ${counts.awaiting} ช่อง`)) action.execute("publish_revision", { ...base, p_expected_published_revision_id: publishedId, p_confirm: { absent: counts.absent, awaiting: counts.awaiting } }); }}>5. ประกาศผล</button>
    </div>{snapshot.validation.blockers.length > 0 && <p>ยังประกาศไม่ได้ กรุณาตรวจช่องที่ยังไม่มีข้อมูล คะแนนเต็ม และ MPL ให้ครบก่อน</p>}</fieldset>}
    {!working && <fieldset disabled={locked}><label>เหตุผลเริ่มแก้ผลประกาศ<textarea maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label><p>Resident และ Staff จะยังเห็นฉบับเดิม จนตรวจและประกาศฉบับแก้</p><button className="secondary-button" disabled={!reason.trim()} onClick={() => action.execute("begin_correction", { p_exam_id: snapshot.exam.exam_id, p_expected_published_revision_id: snapshot.exam.revision_id, p_reason: reason.trim() })}>เริ่มฉบับแก้</button></fieldset>}
    {error && <p role="alert" className="form-error">{error}</p>}{action.feedback}
    <details><summary>ดูคะแนนและเกณฑ์ที่บันทึก ({snapshot.cells.length} ช่อง)</summary><PageControls page={cellPage} setPage={setCellPage} count={snapshot.cells.length} /><div className="resident-table-wrap"><table className="rc04-table"><thead><tr><th>ผู้สอบ</th><th>PGY ณ วันสอบ</th><th>ส่วนสอบ</th><th>คะแนน</th><th>เต็ม / MPL</th><th>ผล</th></tr></thead><tbody>{snapshot.cells.slice(cellPage * 100, (cellPage + 1) * 100).map((c) => {
      const r = snapshot.roster.find((x) => x.resident_id === c.resident_id), p = snapshot.parts.find((x) => x.part_id === c.part_id);
      return <tr key={`${c.resident_id}/${c.part_id}`}><td>{r?.reference_name}</td><td>{r?.pgy_at_exam}</td><td>{p?.name}</td><td>{c.score ?? "—"}</td><td>{p?.max_score} / {p?.mpl[String(r?.pgy_at_exam)] ?? "ยังไม่ตั้งเกณฑ์"}</td><td><ResultStatus cell={c} /></td></tr>;
    })}</tbody></table></div></details>
  </section>;
}
export default function ManagedExams({ user }) {
  const [exams, setExams] = useState([]), [selected, setSelected] = useState(""), [snapshot, setSnapshot] = useState(null), [error, setError] = useState(""), [tick, setTick] = useState(0), [creating, setCreating] = useState(false), [tab, setTab] = useState("manage");
  const selection = useRef(0);
  useEffect(() => { api.setActor(user.id); }, [user.id]);
  useEffect(() => { let alive = true; if (user.role !== "admin") return; setError(""); api.list().then((list) => { if (alive) { setExams(list); setSelected((id) => list.some((e) => e.exam_id === id) ? id : list[0]?.exam_id || ""); } }).catch((e) => alive && setError(e.message)); return () => { alive = false; }; }, [user.id, user.role, tick]);
  const exam = exams.find((e) => e.exam_id === selected), revision = exam?.working?.revision_id || exam?.published_revision_id;
  useEffect(() => {
    const generation = ++selection.current; setSnapshot(null); if (!selected || !revision) return;
    api.get(selected, revision).then((data) => { if (selection.current === generation) setSnapshot(data); }).catch((e) => { if (selection.current === generation) setError(e.message); });
    return () => { selection.current++; };
  }, [selected, revision, tick]);
  if (user.role !== "admin") return <ManagedPublishedResults key={user.id} role={user.role} userId={user.id} />;
  return <div className="rc04-area"><p>หากปิดหรือรีเฟรชหน้าระหว่างบันทึกแล้วไม่แน่ใจผล ให้โหลดรายการใหม่และตรวจชื่อ วันสอบ และข้อมูลที่บันทึกก่อนสร้างหรือส่งรายการใหม่ ระบบไม่ได้เก็บคำขอไว้หลังปิดหน้า</p><div className="button-row"><button className="secondary-button" onClick={() => setTab("manage")}>จัดการฉบับร่าง</button><button className="secondary-button" onClick={() => setTab("published")}>ผลประกาศทุกปี</button></div>
    {tab === "published" ? <ManagedPublishedResults role="admin" userId={user.id} /> : <><div className="button-row"><button className="primary-button" onClick={() => setCreating((x) => !x)}>{creating ? "ซ่อนแบบสร้าง" : "สร้างการสอบใหม่"}</button><button className="secondary-button" onClick={() => { setSnapshot(null); setTick((x) => x + 1); }}>โหลดใหม่</button></div>
      {creating && <CreateManagedExam onCreated={async (r) => { setSelected(r.exam_id); setCreating(false); setTick((x) => x + 1); }} />}
      {error && <p className="form-error" role="alert">{error}</p>}<label>การสอบ (รวมทุกปี)<select value={selected} onChange={(e) => { setError(""); setSelected(e.target.value); }}><option value="">เลือกการสอบ</option>{exams.map((e) => <option key={e.exam_id} value={e.exam_id}>{(e.working || e.published)?.academic_year} · {(e.working || e.published)?.title} · {e.working ? "มีฉบับร่าง" : "ประกาศแล้ว"}</option>)}</select></label>
      {snapshot && <RevisionEditor key={`${snapshot.exam.revision_id}/${snapshot.exam.version}/${snapshot.reviewed}`} snapshot={snapshot} publishedId={exam.published_revision_id} onDone={async () => { setSnapshot(null); setTick((x) => x + 1); }} />}
      {!exams.length && !error && <p>ยังไม่มีการสอบสำหรับนำเข้า Excel สร้างรายการใหม่เพื่อเริ่มต้น</p>}
    </>}
  </div>;
}
