import React, { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { checkInRound, clearRoundCmeQr, closeRound, currentRoundQr, loadOwnRoundAttendance, loadRoundAdminData, loadRoundCmeQrUrl, openRound, updateRoundSession, uploadRoundCmeQr } from "../residentApi";
import { exportRoundAttendancePdf, filterRoundAttendance, roundSessionsInDateRange } from "../roundAttendanceExport";

const thaiTime = (value) => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value));
const thaiDate = (value) => new Intl.DateTimeFormat("th-TH", { dateStyle: "full", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T00:00:00+07:00`));
const bangkokDate = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date());
const thaiHM = (value) => new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date(value));
const toTimeInputValue = (value) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(new Date(value));
const safeCell = (value) => /^[=+@\-\t\r]/.test(String(value || "")) ? `'${value}` : String(value ?? "");

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportRows(attendance, session) {
  return attendance.filter((row) => row.session_id === session.id).map((row) => [
    session.meeting_date,
    row.resident_profiles?.full_name || "—",
    row.resident_profiles?.pgy ? `PGY ${row.resident_profiles.pgy}` : "—",
    row.resident_profiles?.email || "—",
    row.role_at_check_in === "staff" ? "Staff" : "Resident",
    thaiTime(row.checked_in_at),
  ]);
}

async function exportAttendance(format, attendance, session) {
  const headers = ["วันที่ประชุม", "ชื่อ", "PGY", "อีเมล", "บทบาท", "Timestamp scan QR (Asia/Bangkok)"];
  const rows = exportRows(attendance, session);
  const filename = `MM-Grand-Round-${session.meeting_date}`;
  if (format === "csv") {
    const escape = (value) => `"${safeCell(value).replaceAll('"', '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    download(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
    return;
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Attendance");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row.map(safeCell));
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [{ width: 18 }, { width: 32 }, { width: 10 }, { width: 36 }, { width: 15 }, { width: 32 }];
  const buffer = await workbook.xlsx.writeBuffer();
  download(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
}

export function RoundAdmin({ user }) {
  const [data, setData] = useState({ sessions: [], attendance: [], cmeQr: [] });
  const [selectedId, setSelectedId] = useState("");
  const [qr, setQr] = useState(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [cmeUrls, setCmeUrls] = useState({});
  const [scheduleForm, setScheduleForm] = useState({ date: "", start: "", end: "" });
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState({ date: "", start: "", end: "" });
  const mounted = useRef(true);
  const hasInitialPdfDateRange = useRef(false);
  const openSessions = useMemo(
    () => data.sessions.filter((item) => !item.closed_at).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date)),
    [data.sessions],
  );
  const cmeQrFor = (sessionId) => data.cmeQr.find((item) => item.session_id === sessionId) || null;
  const selected = data.sessions.find((item) => item.id === selectedId) || data.sessions[0];
  const [pdfDateFrom, setPdfDateFrom] = useState("");
  const [pdfDateTo, setPdfDateTo] = useState("");
  const [roundFilters, setRoundFilters] = useState({ residentId: "", pgy: "" });
  const pdfDateRangeInvalid = Boolean(pdfDateFrom && pdfDateTo && pdfDateFrom > pdfDateTo);
  const roundResidents = useMemo(() => Array.from(new Map(data.attendance
    .filter((row) => row.role_at_check_in === "resident" && Number.isInteger(row.resident_profiles?.pgy))
    .map((row) => [row.user_id, { id: row.user_id, name: row.resident_profiles.full_name || "—", pgy: row.resident_profiles.pgy }]))
    .values()).sort((left, right) => left.name.localeCompare(right.name, "th")), [data.attendance]);
  const residentsForPgy = useMemo(() => roundResidents.filter((resident) => !roundFilters.pgy || Number(resident.pgy) === Number(roundFilters.pgy)), [roundResidents, roundFilters.pgy]);
  const filteredAttendance = useMemo(() => filterRoundAttendance(data.attendance, roundFilters), [data.attendance, roundFilters]);
  const rows = useMemo(() => selected ? filteredAttendance.filter((item) => item.session_id === selected.id) : [], [filteredAttendance, selected]);
  const pdfSessions = useMemo(
    () => roundSessionsInDateRange(data.sessions, pdfDateFrom, pdfDateTo),
    [data.sessions, pdfDateFrom, pdfDateTo],
  );

  useEffect(() => {
    if (!hasInitialPdfDateRange.current && selected) {
      hasInitialPdfDateRange.current = true;
      setPdfDateFrom(selected.meeting_date);
      setPdfDateTo(selected.meeting_date);
    }
  }, [selected]);

  async function refresh() {
    try {
      const requestedAt = Date.now();
      const [nextData, nextQr] = await Promise.all([loadRoundAdminData(), currentRoundQr()]);
      if (!mounted.current) return;
      setData(nextData);
      setSelectedId((previous) => previous || nextData.sessions[0]?.id || "");
      setQr(nextQr);
      if (nextQr) setOffsetMs(new Date(nextQr.server_now).getTime() - requestedAt);
      setError("");
    } catch (nextError) { if (mounted.current) setError(nextError.message || "โหลดข้อมูลการประชุมไม่สำเร็จ"); }
  }
  useEffect(() => {
    mounted.current = true;
    refresh();
    const poll = window.setInterval(refresh, 10000);
    const clock = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => { mounted.current = false; window.clearInterval(poll); window.clearInterval(clock); };
  }, []);
  const cmeQrKey = data.cmeQr.map((item) => `${item.session_id}:${item.storage_path}`).join(",");
  useEffect(() => {
    let active = true;
    async function loadCmeUrls() {
      const entries = await Promise.all(data.cmeQr.map(async (item) => {
        try { return [item.session_id, await loadRoundCmeQrUrl(item.storage_path)]; }
        catch (nextError) {
          if (active) setError(nextError.message || "ไม่สามารถโหลด QR CME ได้");
          return [item.session_id, ""];
        }
      }));
      if (active) setCmeUrls(Object.fromEntries(entries));
    }
    loadCmeUrls();
    return () => { active = false; };
  }, [cmeQrKey]);
  const remaining = qr ? Math.max(0, new Date(qr.valid_until).getTime() - (Date.now() + offsetMs)) : 0;
  useEffect(() => {
    if (!qr) return undefined;
    const timer = window.setTimeout(() => { setQr(null); refresh(); }, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [qr?.token, qr?.valid_until]);
  async function createSchedule(event) {
    event.preventDefault();
    setBusy("open"); setError("");
    try {
      const id = await openRound(scheduleForm.date, scheduleForm.start, scheduleForm.end);
      setScheduleForm({ date: "", start: "", end: "" });
      setSelectedId(id);
      await refresh();
    } catch (nextError) { setError(nextError.message || "ตั้งตารางสแกนไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  function startEdit(session) {
    setError("");
    setEditingId(session.id);
    setEditForm({ date: session.meeting_date, start: toTimeInputValue(session.starts_at), end: toTimeInputValue(session.ends_at) });
  }
  async function saveEdit(event) {
    event.preventDefault();
    setBusy("edit"); setError("");
    try { await updateRoundSession(editingId, editForm.date, editForm.start, editForm.end); setEditingId(""); await refresh(); }
    catch (nextError) { setError(nextError.message || "แก้ไขตารางสแกนไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  async function stop(session) {
    if (!window.confirm(`ปิดรับสแกน QR สำหรับวันที่ ${thaiDate(session.meeting_date)} ก่อนกำหนดเวลา (${thaiHM(session.ends_at)} น.)? จะแก้ไขหรือเปิดใหม่สำหรับวันนี้ไม่ได้อีก`)) return;
    setBusy("close"); setError("");
    try { await closeRound(session.id); if (qr?.session_id === session.id) setQr(null); await refresh(); }
    catch (nextError) { setError(nextError.message || "ปิดการเช็กชื่อไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  async function uploadCme(session, event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(`cme-upload-${session.id}`); setError("");
    try { await uploadRoundCmeQr(session.id, user.id, file); await refresh(); }
    catch (nextError) { setError(nextError.message || "อัปโหลด QR CME ไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  async function removeCme(session) {
    if (!window.confirm(`ลบ QR CME ของวันที่ ${thaiDate(session.meeting_date)}?`)) return;
    setBusy(`cme-remove-${session.id}`); setError("");
    try { await clearRoundCmeQr(session.id); await refresh(); }
    catch (nextError) { setError(nextError.message || "ลบ QR CME ไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  async function runExport(format) {
    if (!selected) return;
    setBusy(format); setError("");
    try { await exportAttendance(format, filteredAttendance, selected); }
    catch (nextError) { setError(nextError.message || "สร้างไฟล์ไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  async function runPdfExport(splitByDate) {
    if (pdfDateRangeInvalid) {
      setError("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น");
      return;
    }
    setBusy(splitByDate ? "pdf-split" : "pdf-combined"); setError("");
    try {
      await exportRoundAttendancePdf({ sessions: pdfSessions, attendance: filteredAttendance, splitByDate });
    } catch (nextError) { setError(nextError.message || "สร้างไฟล์ PDF ไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  return <div className="round-layout">
    <section className="resident-panel round-admin-panel">
      <h2>MM &amp; Grand Round · เช็กชื่อเข้าประชุม</h2>
      <p>Admin ตั้งวันที่และช่วงเวลาที่ต้องการเปิดรับสแกน QR ล่วงหน้าได้ ไม่จำกัดเฉพาะวันศุกร์หรือเวลา 11:00 น. ระบบจะเปิด-ปิดการสแกนให้อัตโนมัติตามเวลาที่ตั้งไว้</p>
      <form className="round-schedule-form" onSubmit={createSchedule}>
        <label>วันที่ประชุม<input type="date" required value={scheduleForm.date} onChange={(event) => setScheduleForm({ ...scheduleForm, date: event.target.value })} /></label>
        <label>เวลาเริ่มสแกน<input type="time" required value={scheduleForm.start} onChange={(event) => setScheduleForm({ ...scheduleForm, start: event.target.value })} /></label>
        <label>เวลาสิ้นสุดสแกน<input type="time" required value={scheduleForm.end} onChange={(event) => setScheduleForm({ ...scheduleForm, end: event.target.value })} /></label>
        <button className="primary-button" type="submit" disabled={Boolean(busy)}>{busy === "open" ? "กำลังบันทึก…" : "ตั้งตารางสแกน"}</button>
      </form>
      {!openSessions.length && <p className="muted-empty">ยังไม่มีตารางสแกนที่เปิดอยู่ ตั้งตารางใหม่ด้านบนได้เลย</p>}
      {openSessions.map((session) => {
        const isEditing = editingId === session.id;
        const cmeQr = cmeQrFor(session.id);
        const isLiveNow = qr?.session_id === session.id && remaining > 0;
        return <section className="round-session-card" key={session.id} aria-labelledby={`round-session-${session.id}`}>
          <h3 id={`round-session-${session.id}`}>ประชุมวันที่ {thaiDate(session.meeting_date)}</h3>
          {!isEditing && <p>สแกนได้ {thaiHM(session.starts_at)}–{thaiHM(session.ends_at)} น. ตามเวลาไทย · <button type="button" className="link-button" disabled={Boolean(busy)} onClick={() => startEdit(session)}>แก้ไขวันที่/เวลา</button></p>}
          {isEditing && <form className="round-schedule-form" onSubmit={saveEdit}>
            <label>วันที่ประชุม<input type="date" required value={editForm.date} onChange={(event) => setEditForm({ ...editForm, date: event.target.value })} /></label>
            <label>เวลาเริ่มสแกน<input type="time" required value={editForm.start} onChange={(event) => setEditForm({ ...editForm, start: event.target.value })} /></label>
            <label>เวลาสิ้นสุดสแกน<input type="time" required value={editForm.end} onChange={(event) => setEditForm({ ...editForm, end: event.target.value })} /></label>
            <button className="primary-button" type="submit" disabled={Boolean(busy)}>{busy === "edit" ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button>
            <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => setEditingId("")}>ยกเลิก</button>
          </form>}
          {isLiveNow && <div className="round-qr"><QRCodeSVG value={`${window.location.origin}/attendance/${qr.token}`} size={270} level="H" marginSize={2} aria-label="QR เช็กชื่อ MM และ Grand Round" /><strong>QR ปัจจุบัน</strong><span>เปลี่ยนใน {Math.ceil(remaining / 1000)} วินาที</span></div>}
          {!isLiveNow && <p role="status">ขณะนี้ไม่มี QR ที่ใช้งานได้ (นอกช่วงเวลาที่ตั้งไว้)</p>}
          <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => stop(session)}>ปิดรับก่อนกำหนดเวลา</button>
          <section className="round-cme-qr" aria-labelledby={`round-cme-title-${session.id}`}>
            <h4 id={`round-cme-title-${session.id}`}>QR CME สำหรับฉายในห้องประชุม</h4>
            <p>เป็นภาพ QR แยกจาก QR เช็กชื่อ ระบบนี้ไม่เก็บข้อมูลการสแกน CME</p>
            {cmeUrls[session.id] && <img src={cmeUrls[session.id]} alt={`QR CME สำหรับวันที่ ${session.meeting_date}`} />}
            <label className="secondary-button cme-upload-control">{busy === `cme-upload-${session.id}` ? "กำลังอัปโหลด…" : cmeQr ? "เปลี่ยนภาพ QR CME" : "อัปโหลดภาพ QR CME"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={(event) => uploadCme(session, event)} /></label>
            {cmeQr && <button className="danger-button" type="button" disabled={Boolean(busy)} onClick={() => removeCme(session)}>{busy === `cme-remove-${session.id}` ? "กำลังลบ…" : "ลบ QR CME"}</button>}
          </section>
        </section>;
      })}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <section className="resident-panel">
      <h2>รายชื่อผู้เข้าประชุม</h2>
      <label>วันที่ประชุม<select value={selected?.id || ""} onChange={(event) => setSelectedId(event.target.value)}>{data.sessions.map((item) => <option key={item.id} value={item.id}>{thaiDate(item.meeting_date)}</option>)}</select></label>
      <div className="round-filter-grid"><label>ชั้นปี (PGY)<select value={roundFilters.pgy} onChange={(event) => { const pgy = event.target.value; const chosen = roundResidents.find((resident) => resident.id === roundFilters.residentId); setRoundFilters({ pgy, residentId: chosen && pgy && Number(chosen.pgy) !== Number(pgy) ? "" : roundFilters.residentId }); }}><option value="">ทุกชั้นปี</option>{[1, 2, 3, 4].map((year) => <option key={year} value={year}>PGY {year}</option>)}</select></label><label>Resident<select value={roundFilters.residentId} onChange={(event) => setRoundFilters({ ...roundFilters, residentId: event.target.value })}><option value="">Resident ทุกคน</option>{residentsForPgy.map((resident) => <option key={resident.id} value={resident.id}>{resident.name} · PGY {resident.pgy}</option>)}</select></label></div>
      {selected && <div className="round-export"><span>{rows.length} คน</span><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => runExport("csv")}>ดาวน์โหลด CSV</button><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => runExport("xlsx")}>ดาวน์โหลด Excel</button></div>}
      <section className="round-pdf-export" aria-labelledby="round-pdf-title">
        <h3 id="round-pdf-title">รายงาน PDF</h3>
        <p>เลือกวันเดียวหรือช่วงวันที่ที่ต้องการ แล้วดาวน์โหลดเป็น PDF รวม หรือแยกหนึ่งไฟล์ต่อวัน</p>
        <div className="round-date-range">
          <label>ตั้งแต่วันที่<input type="date" value={pdfDateFrom} onChange={(event) => setPdfDateFrom(event.target.value)} /></label>
          <label>ถึงวันที่<input type="date" value={pdfDateTo} onChange={(event) => setPdfDateTo(event.target.value)} /></label>
        </div>
        <div className="round-export"><span>{pdfDateRangeInvalid ? "ตรวจสอบช่วงวันที่" : `${pdfSessions.length} วันประชุม`}</span><button className="secondary-button" type="button" disabled={Boolean(busy) || pdfDateRangeInvalid || !pdfSessions.length} onClick={() => runPdfExport(false)}>{busy === "pdf-combined" ? "กำลังสร้าง PDF…" : "ดาวน์โหลด PDF รวม"}</button><button className="secondary-button" type="button" disabled={Boolean(busy) || pdfDateRangeInvalid || !pdfSessions.length} onClick={() => runPdfExport(true)}>{busy === "pdf-split" ? "กำลังสร้าง PDF…" : "ดาวน์โหลด PDF แยกวัน"}</button></div>
      </section>
      <div className="resident-table-wrap"><table><thead><tr><th>ชื่อ</th><th>PGY</th><th>อีเมล</th><th>บทบาท</th><th>Timestamp scan QR (Asia/Bangkok)</th></tr></thead><tbody>{rows.map((row) => <tr key={row.user_id}><td>{row.resident_profiles?.full_name || "—"}</td><td>{row.resident_profiles?.pgy ? `PGY ${row.resident_profiles.pgy}` : "—"}</td><td>{row.resident_profiles?.email || "—"}</td><td>{row.role_at_check_in === "staff" ? "Staff" : "Resident"}</td><td>{thaiTime(row.checked_in_at)}</td></tr>)}{!rows.length && <tr><td colSpan="5">ยังไม่มีผู้เช็กชื่อตามตัวกรอง</td></tr>}</tbody></table></div>
    </section>
  </div>;
}

export function RoundCheckIn({ token }) {
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(Boolean(token));
  useEffect(() => {
    let active = true;
    async function run() {
      try {
        if (token) { const next = await checkInRound(token); if (active) setResult(next); }
        const records = await loadOwnRoundAttendance();
        if (active) setHistory(records);
      } catch (nextError) { if (active) setError(nextError.message || "เช็กชื่อไม่สำเร็จ กรุณาสแกน QR ปัจจุบันอีกครั้ง"); }
      finally { if (active) setBusy(false); }
    }
    run();
    return () => { active = false; };
  }, [token]);
  return <section className="resident-panel round-checkin">
    <h2>เช็กชื่อ MM &amp; Grand Round</h2>
    {busy && <p role="status">กำลังตรวจสอบ QR และบันทึกเวลา…</p>}
    {result && <div className="form-success" role="status"><strong>{result.already_checked_in ? "คุณเช็กชื่อไว้แล้ว" : "เช็กชื่อสำเร็จ"}</strong><p>Timestamp scan QR: {thaiTime(result.checked_in_at)}</p></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!token && <p>สแกน QR ที่แสดงในห้องประชุมด้วยโทรศัพท์เครื่องนี้เพื่อเช็กชื่อ</p>}
    <h3>ประวัติการเช็กชื่อของฉัน</h3>
    {history.length ? <ul>{history.map((item) => <li key={item.session_id}>{thaiTime(item.checked_in_at)}</li>)}</ul> : <p>ยังไม่มีประวัติการเช็กชื่อ</p>}
  </section>;
}
