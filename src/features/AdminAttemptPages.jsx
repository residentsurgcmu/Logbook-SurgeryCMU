import React, { useEffect, useMemo, useRef, useState } from "react";
import { grantExtraAttempt, listAttemptGrants, listEpaPbaProgress } from "../residentApi";
import { adminAttemptError, bangkokProgressTime, EPA_CODES, progressResidents, PROGRESS_WARNING } from "../adminProgress.js";
import { exportAdminProgressExcel } from "../adminProgressExcelExport.js";
import "./AdminAttemptPages.css";

function Confirmation({ title, busy, onCancel, onConfirm, children, confirmLabel }) {
  const dialog = useRef(null);
  const cancel = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current.showModal();
    cancel.current.focus();
    return () => { dialog.current?.close(); opener?.focus(); };
  }, []);
  return <dialog ref={dialog} className="admin-attempt-dialog" aria-labelledby="admin-attempt-confirm-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h3 id="admin-attempt-confirm-title">{title}</h3>
    {children}
    <div className="admin-attempt-actions">
      <button ref={cancel} type="button" disabled={busy} onClick={onCancel}>กลับไปตรวจข้อมูล</button>
      <button type="button" className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? "กำลังดำเนินการ…" : confirmLabel}</button>
    </div>
  </dialog>;
}

function ErrorMessage({ error, onRetry, busy }) {
  if (!error) return null;
  return <div className="admin-attempt-error" role="alert"><p>{error}</p>{onRetry && <button type="button" onClick={onRetry} disabled={busy}>ลองใหม่</button>}</div>;
}

function GrantHistory({ grants, residentId }) {
  const [onlySelected, setOnlySelected] = useState(false);
  const visible = onlySelected && residentId ? grants.filter((row) => row.resident_id === residentId) : grants;
  const by = (row) => `โดย ${row.granted_by_name || "ไม่ทราบชื่อ"}${row.granted_by_tag ? ` ${row.granted_by_tag}` : ""}`;
  return <div className="admin-attempt-history">
    <h3>ประวัติการเพิ่มครั้ง</h3>
    <label className="admin-attempt-check"><input type="checkbox" checked={onlySelected} disabled={!residentId} onChange={(event) => setOnlySelected(event.target.checked)} />แสดงเฉพาะ Resident ที่เลือก</label>
    {!visible.length ? <p>ยังไม่มีการเพิ่มครั้ง</p> : <>
      <div className="admin-attempt-cards">{visible.map((row) => <article key={row.grant_id}>
        <p><strong>{row.resident_name}</strong> · {bangkokProgressTime(row.created_at)}</p>
        <p>{row.template_code} · {row.template_title}</p>
        <p className="admin-attempt-reason">{row.reason}</p><p>{by(row)}</p>
      </article>)}</div>
      <div className="admin-attempt-table"><table><thead><tr><th>วันที่ (เวลาไทย)</th><th>Resident</th><th>แบบประเมิน</th><th>เหตุผล</th><th>ผู้เพิ่มครั้ง</th></tr></thead>
        <tbody>{visible.map((row) => <tr key={row.grant_id}><td>{bangkokProgressTime(row.created_at)}</td><td>{row.resident_name}</td><td>{row.template_code} · {row.template_title}</td><td className="admin-attempt-reason">{row.reason}</td><td>{by(row)}</td></tr>)}</tbody>
      </table></div>
    </>}
  </div>;
}

function GrantPanel({ rows, loading, error, reloadProgress }) {
  const [grants, setGrants] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [residentId, setResidentId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const mounted = useRef(true);
  const historySequence = useRef(0);
  async function reloadHistory() {
    const request = ++historySequence.current;
    setHistoryLoading(true); setHistoryError("");
    try { const next = await listAttemptGrants(); if (mounted.current && request === historySequence.current) setGrants(next); }
    catch (nextError) { if (mounted.current && request === historySequence.current) setHistoryError(adminAttemptError(nextError)); }
    finally { if (mounted.current && request === historySequence.current) setHistoryLoading(false); }
  }
  useEffect(() => { mounted.current = true; reloadHistory(); return () => { mounted.current = false; }; }, []);
  const residents = useMemo(() => progressResidents(rows), [rows]);
  const filtered = residents.filter((resident) => resident.id === residentId || resident.name.toLocaleLowerCase("th").includes(search.trim().toLocaleLowerCase("th")));
  const forms = rows.filter((row) => row.resident_id === residentId && row.attempts_cap != null)
    .sort((a, b) => EPA_CODES.indexOf(a.template_code) - EPA_CODES.indexOf(b.template_code));
  const selected = forms.find((row) => row.template_id === templateId);
  const resident = residents.find((person) => person.id === residentId);
  const reasonLength = Array.from(reason.trim()).length;
  const reasonValid = reasonLength >= 5 && reasonLength <= 500;
  const blocked = loading || Boolean(error) || busy;
  function preview(event) {
    event.preventDefault();
    if (blocked || !resident || !selected || !reasonValid) return;
    setActionError(""); setSuccess("");
    setConfirmation({ residentId, templateId, reason: reason.trim(), residentName: resident.name, form: `${selected.template_code} · ${selected.template_title}` });
  }
  async function confirmGrant() {
    if (!confirmation || busyRef.current) return;
    busyRef.current = true; setBusy(true); setActionError("");
    try {
      await grantExtraAttempt({ residentId: confirmation.residentId, templateId: confirmation.templateId, reason: confirmation.reason });
    } catch (nextError) {
      setActionError(adminAttemptError(nextError)); setConfirmation(null);
      busyRef.current = false; setBusy(false); return;
    }
    setSuccess(`เพิ่ม 1 ครั้งให้ ${confirmation.residentName} · ${confirmation.form} สำเร็จแล้ว`);
    setConfirmation(null); setReason("");
    // A refresh failure must never be presented as a failed grant or retried as a write.
    await Promise.allSettled([reloadProgress(), reloadHistory()]);
    busyRef.current = false; setBusy(false);
  }
  return <section className="resident-panel admin-attempt-panel" aria-labelledby="admin-grant-title">
    <h2 id="admin-grant-title">เพิ่มครั้งการประเมิน</h2>
    <p>เพิ่มได้เฉพาะเพดานรวม เช่น 3 → 4 ครั้ง ยังขอประเมินได้หนึ่งครั้งต่อแบบประเมินต่อปีการศึกษา ปีการศึกษาเริ่ม 1 กรกฎาคม</p>
    {loading && <p role="status">กำลังโหลดสถานะการประเมิน…</p>}
    <ErrorMessage error={error} onRetry={reloadProgress} busy={loading || busy} />
    {!loading && !error && !residents.length && <p>ยังไม่มี Resident ที่ใช้งาน</p>}
    <form onSubmit={preview}>
      <label>ค้นหาชื่อ Resident<input type="search" value={search} disabled={blocked} onChange={(event) => setSearch(event.target.value)} placeholder="พิมพ์ชื่อเพื่อค้นหา" /></label>
      <label>เลือก Resident<select value={residentId} disabled={blocked || !residents.length} required onChange={(event) => { setResidentId(event.target.value); setTemplateId(""); setActionError(""); setSuccess(""); }}>
        <option value="">เลือก Resident</option>{filtered.map((person) => <option key={person.id} value={person.id}>{person.name} · PGY {person.pgy}</option>)}
      </select></label>
      {search && !filtered.length && <p>ไม่พบชื่อที่ค้นหา</p>}
      <label>เลือกแบบประเมิน<select value={selected ? templateId : ""} disabled={blocked || !residentId || !forms.length} required onChange={(event) => { setTemplateId(event.target.value); setSuccess(""); }}>
        <option value="">เลือกแบบประเมิน</option>{forms.map((form) => <option key={form.template_id} value={form.template_id}>{form.template_code} · {form.template_title}</option>)}
      </select></label>
      {selected && <p className="admin-attempt-status">ใช้แล้ว {selected.attempts_used} จาก {selected.attempts_cap} ครั้ง · ปีการศึกษานี้ {selected.attempts_this_year} · {selected.met ? "ถึงเกณฑ์" : "ยังไม่ถึงเกณฑ์"}{selected.has_pending ? " · รอประเมิน" : ""}</p>}
      <label>เหตุผลที่เพิ่มครั้ง<textarea value={reason} required disabled={blocked} rows={4} aria-describedby="admin-grant-reason-count" onChange={(event) => setReason(event.target.value)} /></label>
      <p id="admin-grant-reason-count">{reasonLength}/500 ตัวอักษร · กรุณาระบุ 5–500 ตัวอักษร (ไม่รวมช่องว่างหัวท้าย)</p>
      <button type="submit" className="primary-button" disabled={blocked || !selected || !resident || !reasonValid}>{busy ? "กำลังดำเนินการ…" : "เพิ่ม 1 ครั้ง"}</button>
    </form>
    <ErrorMessage error={actionError} />
    {success && <p role="status" className="admin-attempt-success">{success}</p>}
    {historyLoading && <p role="status">กำลังโหลดประวัติ…</p>}
    <ErrorMessage error={historyError} onRetry={reloadHistory} busy={historyLoading || busy} />
    {!historyLoading && !historyError && <GrantHistory grants={grants} residentId={residentId} />}
    {confirmation && <Confirmation title="ยืนยันเพิ่ม 1 ครั้ง" busy={busy} onCancel={() => setConfirmation(null)} onConfirm={confirmGrant} confirmLabel="ยืนยันเพิ่ม 1 ครั้ง">
      <p><strong>Resident:</strong> {confirmation.residentName}</p><p><strong>แบบประเมิน:</strong> {confirmation.form}</p><p className="admin-attempt-reason"><strong>เหตุผล:</strong> {confirmation.reason}</p>
      <p>ย้อนกลับจากหน้านี้ไม่ได้ (ถ้าเพิ่มผิด ให้แจ้งผู้พัฒนา)</p><p>เพิ่มเฉพาะเพดานรวม กฎหนึ่งคำขอต่อแบบประเมินต่อปีการศึกษายังคงเดิม</p>
    </Confirmation>}
  </section>;
}

function ExportPanel({ rows, loadedAt, loading, error, reloadProgress }) {
  const [confirmation, setConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [exportError, setExportError] = useState("");
  const [success, setSuccess] = useState("");
  const count = progressResidents(rows).length;
  async function download() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setExportError(""); setSuccess("");
    try {
      const fresh = await reloadProgress(); // Every download uses a fresh RPC snapshot.
      if (fresh.rows.length) {
        await exportAdminProgressExcel(fresh.rows, fresh.generatedAt);
        setSuccess("จัดเตรียมไฟล์ Excel แล้ว ตรวจไฟล์ในรายการดาวน์โหลดของอุปกรณ์");
      }
    } catch (nextError) { setExportError(adminAttemptError(nextError)); }
    finally { setConfirmation(false); busyRef.current = false; setBusy(false); }
  }
  return <section className="resident-panel admin-attempt-panel" aria-labelledby="admin-progress-title">
    <h2 id="admin-progress-title">ดึงข้อมูลความคืบหน้า</h2>
    <p>ดาวน์โหลดสรุป EPA และ PBA ของ Resident ที่ใช้งานเป็น Excel เพื่อติดตามความคืบหน้า PBA นับทำแล้วเฉพาะประเมินเสร็จ แยกเรื่องที่รอประเมินไว้ให้ดู</p>
    {loading && <p role="status">กำลังโหลดความคืบหน้า…</p>}
    <ErrorMessage error={error} onRetry={() => reloadProgress().catch(() => {})} busy={loading || busy} />
    {!loading && !error && loadedAt && <p>Resident {count} คน · ข้อมูล ณ {bangkokProgressTime(loadedAt)}</p>}
    {!loading && !error && !count && <p>ยังไม่มี Resident ที่ใช้งาน</p>}
    <p>{PROGRESS_WARNING}</p>
    <button type="button" className="primary-button" disabled={loading || busy || Boolean(error) || !count} onClick={() => { setSuccess(""); setExportError(""); setConfirmation(true); }}>ดาวน์โหลดไฟล์ Excel</button>
    <ErrorMessage error={exportError} onRetry={() => { setExportError(""); setConfirmation(true); }} busy={busy || loading || Boolean(error) || !count} />
    {success && <p role="status" className="admin-attempt-success">{success}</p>}
    {confirmation && <Confirmation title="ตรวจข้อมูลก่อนดาวน์โหลด" busy={busy} onCancel={() => setConfirmation(false)} onConfirm={download} confirmLabel="ยืนยันดาวน์โหลดไฟล์ Excel">
      <p>Resident {count} คน · ข้อมูล ณ {bangkokProgressTime(loadedAt)}</p><p>ไฟล์มี 3 แผ่น: อ่านก่อน, EPA และ PBA ระบบจะดึงข้อมูลล่าสุดเมื่อยืนยัน</p><p>{PROGRESS_WARNING}</p>
    </Confirmation>}
  </section>;
}

function AdminAttemptContent() {
  const [rows, setRows] = useState([]);
  const [loadedAt, setLoadedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const mounted = useRef(true);
  async function reloadProgress() {
    const request = ++sequence.current;
    setLoading(true); setError("");
    try {
      const next = await listEpaPbaProgress();
      const generatedAt = new Date();
      if (mounted.current && request === sequence.current) { setRows(next); setLoadedAt(generatedAt); }
      return { rows: next, generatedAt };
    } catch (nextError) {
      if (mounted.current && request === sequence.current) setError(adminAttemptError(nextError));
      throw nextError;
    } finally { if (mounted.current && request === sequence.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; reloadProgress().catch(() => {}); return () => { mounted.current = false; sequence.current++; }; }, []);
  const retry = () => reloadProgress().catch(() => {});
  return <div className="admin-attempt-pages">
    <GrantPanel rows={rows} loading={loading} error={error} reloadProgress={retry} />
    <ExportPanel rows={rows} loadedAt={loadedAt} loading={loading} error={error} reloadProgress={reloadProgress} />
  </div>;
}

// Gate before mounting children: non-admin roles do not even load these RPCs.
export default function AdminAttemptPages({ workspace }) {
  if (workspace.user.role !== "admin") return null;
  return <AdminAttemptContent />;
}
