import React, { useEffect, useRef, useState } from "react";
import { ShieldIcon, XIcon } from "../components/Icons";
import { CASE_LIMITS, canDeleteNote, canEditNote, caseErrorMessage, caseTypeLabel } from "../residentCases";
import { addCaseNote, addConferenceNote, deleteCaseNote, editCaseNote, loadCaseNotes } from "../residentCasesApi";

export const thaiDate = (value) =>
  value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T12:00:00+07:00`)) : "—";
export const thaiDateTime = (value) =>
  value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
export const personName = (people, id) => people.find((person) => person.user_id === id)?.full_name || "ไม่ทราบชื่อ";

export function CaseModal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="case-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="case-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="case-modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="ปิด"><XIcon /></button>
        </div>
        <div className="case-modal-body">{children}</div>
      </section>
    </div>
  );
}

export function CaseTypeChip({ type }) {
  return <span className={`case-status case-type-${type || "unset"}`}>{caseTypeLabel(type)}</span>;
}

export function PrivacyNotice() {
  return (
    <p className="case-privacy-note">
      <ShieldIcon size={16} /> ห้ามใส่ชื่อ-นามสกุล, HN หรือข้อมูลระบุตัวผู้ป่วยในช่องใดๆ รวมถึงในภาพ
    </p>
  );
}

// Append-only discussion notes: every author adds their own row, so two people
// typing at the same time never overwrite each other.
export function CaseNotes({ caseId, user, people, meetingDate = null }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const seq = useRef(0);

  async function reload() {
    const mine = ++seq.current;
    try {
      const rows = await loadCaseNotes(caseId);
      if (mine === seq.current) setNotes(rows);
    } catch (nextError) {
      if (mine === seq.current) setError(caseErrorMessage(nextError));
    }
  }
  useEffect(() => {
    setNotes(null);
    setEditing(null);
    setBody("");
    setError("");
    reload();
  }, [caseId]);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await reload();
    } catch (nextError) {
      setError(caseErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="case-notes">
      <h3>
        {meetingDate ? `ข้ออภิปราย / Learning points · ประชุมวันที่ ${thaiDate(meetingDate)}` : "ข้ออภิปราย / Learning points"}{" "}
        <span className="case-count">{meetingDate ? (notes || []).filter((note) => note.meeting_date === meetingDate).length : notes?.length ?? "…"}</span>
      </h3>
      {error && <p className="form-error" role="alert">{error}</p>}
      {meetingDate && notes && !notes.some((note) => note.meeting_date === meetingDate) && <p className="case-muted">ยังไม่มีโน้ตของเคสนี้ในประชุมครั้งนี้</p>}
      {!meetingDate && notes?.length === 0 && <p className="case-muted">ยังไม่มีโน้ต</p>}
      {(meetingDate ? [...(notes || [])].sort((a, b) => Number(b.meeting_date === meetingDate) - Number(a.meeting_date === meetingDate)) : notes || []).map((note) => (
        <div className="case-note" key={note.id}>
          <small>
            {personName(people, note.author_id)} · {thaiDateTime(note.created_at)}
            {note.edited_at ? " · แก้ไขแล้ว" : ""}
            {meetingDate && note.meeting_date !== meetingDate ? ` · ${note.meeting_date ? `ประชุม ${thaiDate(note.meeting_date)}` : "โน้ตทั่วไป"}` : ""}
          </small>
          {editing?.id === note.id ? (
            <>
              <textarea rows={2} maxLength={CASE_LIMITS.note} value={editing.body} onChange={(event) => setEditing({ id: note.id, body: event.target.value })} />
              <div className="button-row">
                <button type="button" className="primary-button" disabled={busy || !editing.body.trim()} onClick={() => run(async () => { await editCaseNote(note.id, editing.body); setEditing(null); })}>บันทึก</button>
                <button type="button" className="secondary-button" onClick={() => setEditing(null)}>ยกเลิก</button>
              </div>
            </>
          ) : (
            <>
              <p>{note.body}</p>
              <div className="button-row">
                {canEditNote(user, note) && <button type="button" className="link-button" onClick={() => setEditing({ id: note.id, body: note.body })}>แก้ไข</button>}
                {canDeleteNote(user, note) && (
                  <button type="button" className="link-button" disabled={busy} onClick={() => { if (window.confirm("ลบโน้ตนี้?")) run(() => deleteCaseNote(note.id)); }}>ลบ</button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
      <label>
        เพิ่มโน้ต (ทุกคนจดพร้อมกันได้ ไม่ทับกัน)
        <textarea rows={2} maxLength={CASE_LIMITS.note} value={body} onChange={(event) => setBody(event.target.value)} placeholder="พิมพ์ประเด็นอภิปราย…" />
      </label>
      <div className="button-row">
        <button type="button" className="primary-button" disabled={busy || !body.trim()} onClick={() => run(async () => { await (meetingDate ? addConferenceNote(caseId, meetingDate, body) : addCaseNote(caseId, body)); setBody(""); })}>เพิ่มโน้ต</button>
      </div>
    </div>
  );
}
