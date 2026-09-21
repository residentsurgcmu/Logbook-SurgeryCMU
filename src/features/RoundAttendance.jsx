import React, { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { checkInRound, closeRound, currentRoundQr, loadOwnRoundAttendance, loadRoundAdminData, openRound } from "../residentApi";
import { exportRoundAttendancePdf, filterRoundAttendance, roundSessionsInDateRange } from "../roundAttendanceExport";

const thaiTime = (value) => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value));
const thaiDate = (value) => new Intl.DateTimeFormat("th-TH", { dateStyle: "full", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T00:00:00+07:00`));
const bangkokDate = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date());
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

export function RoundAdmin() {
  const [data, setData] = useState({ sessions: [], attendance: [] });
  const [selectedId, setSelectedId] = useState("");
  const [qr, setQr] = useState(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const hasInitialPdfDateRange = useRef(false);
  const latestSession = data.sessions.find((item) => item.meeting_date === bangkokDate());
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
  const remaining = qr ? Math.max(0, new Date(qr.valid_until).getTime() - (Date.now() + offsetMs)) : 0;
  useEffect(() => {
    if (!qr) return undefined;
    const timer = window.setTimeout(() => { setQr(null); refresh(); }, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [qr?.token, qr?.valid_until]);
  async function start() {
    setBusy("open"); setError("");
    try { const id = await openRound(); setSelectedId(id); await refresh(); }
    catch (nextError) { setError(nextError.message || "เปิดการเช็กชื่อไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  async function stop() {
    if (!latestSession || !window.confirm("ปิดรับเช็กชื่อวันนี้ก่อน 11:00 น.? จะเปิดอีกครั้งในวันนี้ไม่ได้")) return;
    setBusy("close"); setError("");
    try { await closeRound(latestSession.id); setQr(null); await refresh(); }
    catch (nextError) { setError(nextError.message || "ปิดการเช็กชื่อไม่สำเร็จ"); }
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
      <p>Admin กำหนดวันประชุมและกดเปิดรับด้วยตนเองในวันที่มีประชุม ระบบหยุดรับสแกนเวลา 11:00 น. ตามเวลาไทย</p>
      {!latestSession && <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={start}>{busy === "open" ? "กำลังเปิด…" : "เปิดรับเช็กชื่อวันนี้"}</button>}
      {latestSession && <p>ประชุมวันที่ {thaiDate(latestSession.meeting_date)} · {latestSession.closed_at ? `ปิดรับแล้ว ${thaiTime(latestSession.closed_at)}` : "เปิดรับแล้ว"}</p>}
      {qr && remaining > 0 && <div className="round-qr"><QRCodeSVG value={`${window.location.origin}/attendance/${qr.token}`} size={270} level="H" marginSize={2} aria-label="QR เช็กชื่อ MM และ Grand Round" /><strong>QR ปัจจุบัน</strong><span>เปลี่ยนใน {Math.ceil(remaining / 1000)} วินาที</span></div>}
      {latestSession && !latestSession.closed_at && !qr && <p role="status">ขณะนี้ไม่มี QR ที่ใช้งานได้ (ปิดรับเวลา 11:00 น.)</p>}
      {latestSession && !latestSession.closed_at && qr && <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={stop}>ปิดรับก่อนเวลา</button>}
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
