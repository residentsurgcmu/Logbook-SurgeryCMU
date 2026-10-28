import React, { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { listAdminAccounts, loadRoundAttendanceAdjustments, recordMissingRoundAttendance, cancelRoundSession, checkInRound, clearRoundCmeQr, closeRound, currentRoundQr, loadOwnRoundAttendance, loadRoundAdminData, loadRoundCmeQrUrl, openRound, updateRoundSession, uploadRoundCmeQr } from "../residentApi";
import { exportRoundAttendancePdf, filterRoundAttendance, roundSessionsInDateRange } from "../roundAttendanceExport";
import { RoundQrScanner } from "./RoundQrScanner";
import { SeatMapPanel } from "./SeatMap";
import { SeatAdminPanel } from "./SeatMapAdmin";
import { adminListSeatConfigs } from "../seatMapApi";
import { roundSchedulePayload, roundArrivalLabel, ROUND_STATUS_LABELS, bangkokIsoDate, formatRoundTimeRange, roundCheckInErrorMessage, roundScheduleErrorMessage, roundSessionFileKey, roundSessionStatus, shiftIsoDate, validateRoundMeetingDate, validateRoundTimes } from "../roundSchedule";

const thaiTime = (value) => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value));
const thaiDate = (value) => new Intl.DateTimeFormat("th-TH", { dateStyle: "full", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T00:00:00+07:00`));
const bangkokDate = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date());
const thaiHM = (value) => new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date(value));
const toTimeInputValue = (value) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(new Date(value));
const hmOf = (value) => String(value || "").slice(0, 5);
const EMPTY_SCHEDULE = { date: "", start: "", end: "", activityStart: "", activityEnd: "", customScan: false, scanStart: "", scanEnd: "", enableSeats: true };
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
    formatRoundTimeRange(session) || "—",
    row.resident_profiles?.full_name || "—",
    row.resident_profiles?.pgy ? `PGY ${row.resident_profiles.pgy}` : "—",
    row.resident_profiles?.email || "—",
    row.role_at_check_in === "staff" ? "Staff" : "Resident",
    thaiTime(row.checked_in_at),
    row.resident_round_attendance_adjustments?.length ? "Admin บันทึกย้อนหลัง" : "QR",
    row.resident_round_attendance_adjustments?.[0]?.reason || "",
  ]);
}

async function exportAttendance(format, attendance, session) {
  const headers = ["วันที่ประชุม", "เวลา", "ชื่อ", "PGY", "อีเมล", "บทบาท", "เวลาเช็คชื่อ (Asia/Bangkok)", "แหล่งข้อมูล", "เหตุผลบันทึกย้อนหลัง"];
  const rows = exportRows(attendance, session);
  const filename = `MM-Grand-Round-${roundSessionFileKey(session)}`;
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
  sheet.columns = [{ width: 18 }, { width: 26 }, { width: 32 }, { width: 10 }, { width: 36 }, { width: 15 }, { width: 32 }];
  const buffer = await workbook.xlsx.writeBuffer();
  download(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
}

export function RoundAdmin({ user }) {
  const [data, setData] = useState({ sessions: [], attendance: [], cmeQr: [] });
  const [selectedId, setSelectedId] = useState("");
  const [qr, setQr] = useState(null);
  const [seatConfigs, setSeatConfigs] = useState(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [cmeUrls, setCmeUrls] = useState({});
  const [scheduleForm, setScheduleForm] = useState(EMPTY_SCHEDULE);
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(EMPTY_SCHEDULE);
  const [scheduleDateError, setScheduleDateError] = useState("");
  const [editDateError, setEditDateError] = useState("");
  const mounted = useRef(true);
  const refreshSeq = useRef(0);
  const hasInitialPdfDateRange = useRef(false);
  // Cancelled sessions are kept for history only; they never reach the lists,
  // the attendance dropdown or the PDF range.
  const reportSessions = useMemo(() => data.sessions.filter((item) => !item.cancelled_at), [data.sessions]);
  const attendanceCount = useMemo(() => {
    const counts = new Map();
    for (const row of data.attendance) counts.set(row.session_id, (counts.get(row.session_id) || 0) + 1);
    return counts;
  }, [data.attendance]);
  const nowMs = Date.now() + offsetMs;
  const todayIso = bangkokIsoDate(new Date(nowMs));
  // Today's and upcoming sessions stay on the left whatever their status, so a
  // session set earlier is never "lost" (a closed one shows as "ปิดแล้ว").
  const visibleSessions = reportSessions
    .filter((item) => item.meeting_date >= todayIso)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const endedSessions = reportSessions.filter((item) => item.meeting_date < todayIso && !item.closed_at);
  // Past sessions that have a seat map: the Admin can still open last Friday's report (read-only, no configuration).
  const pastSeatSessions = useMemo(
    () => (seatConfigs ? reportSessions.filter((item) => item.meeting_date < todayIso && seatConfigs[item.id]).sort((left, right) => new Date(right.starts_at) - new Date(left.starts_at)) : []),
    [reportSessions, seatConfigs, todayIso],
  );
  const minMeetingDate = shiftIsoDate(todayIso, -366);
  const maxMeetingDate = shiftIsoDate(todayIso, 366);
  const cmeQrFor = (sessionId) => data.cmeQr.find((item) => item.session_id === sessionId) || null;
  const selected = reportSessions.find((item) => item.id === selectedId) || reportSessions[0];
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
    () => roundSessionsInDateRange(reportSessions, pdfDateFrom, pdfDateTo),
    [reportSessions, pdfDateFrom, pdfDateTo],
  );

  useEffect(() => {
    if (!hasInitialPdfDateRange.current && selected) {
      hasInitialPdfDateRange.current = true;
      setPdfDateFrom(selected.meeting_date);
      setPdfDateTo(selected.meeting_date);
    }
  }, [selected]);

  async function refresh() {
    const seq = ++refreshSeq.current;
    try {
      const requestedAt = Date.now();
      const [nextData, nextQr, nextSeatConfigs] = await Promise.all([loadRoundAdminData(), currentRoundQr(), adminListSeatConfigs().catch(() => null)]);
      // Ignore a slower, older response (e.g. the 10 s poll) that finishes
      // after a newer refresh, so it cannot hide a just-created session.
      if (!mounted.current || seq !== refreshSeq.current) return;
      setData(nextData);
      setSelectedId((previous) => previous || nextData.sessions.find((item) => !item.cancelled_at)?.id || "");
      setQr(nextQr);
      setSeatConfigs(nextSeatConfigs ? Object.fromEntries(nextSeatConfigs.map((row) => [row.session_id, row])) : null);
      if (nextQr) setOffsetMs(new Date(nextQr.server_now).getTime() - requestedAt);
      setError("");
    } catch (nextError) { if (mounted.current && seq === refreshSeq.current) setError(nextError.message || "โหลดข้อมูลการประชุมไม่สำเร็จ"); }
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
    const dateError = validateRoundMeetingDate(scheduleForm.date, new Date(Date.now() + offsetMs))
      || validateRoundTimes(roundSchedulePayload(scheduleForm));
    setScheduleDateError(dateError);
    if (dateError) return;
    setBusy("open"); setError("");
    try {
      const timing = roundSchedulePayload(scheduleForm);
      const id = await openRound(scheduleForm.date, timing.start, timing.end, timing.activityStart, timing.activityEnd, timing.enableSeats);
      setScheduleForm(EMPTY_SCHEDULE);
      setSelectedId(id);
      await refresh();
    } catch (nextError) { setError(roundScheduleErrorMessage(nextError) || "ตั้งตารางสแกนไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  function startEdit(session) {
    setError("");
    setEditingId(session.id);
    setEditDateError("");
    const scanStart = toTimeInputValue(session.starts_at), scanEnd = toTimeInputValue(session.ends_at);
    const start = hmOf(session.activity_start_time) || scanStart, end = hmOf(session.activity_end_time) || scanEnd;
    setEditForm({ date: session.meeting_date, start, end, scanStart, scanEnd, customScan: start !== scanStart || end !== scanEnd, enableSeats: true });
  }
  async function saveEdit(event) {
    event.preventDefault();
    const dateError = validateRoundMeetingDate(editForm.date, new Date(Date.now() + offsetMs))
      || validateRoundTimes(roundSchedulePayload(editForm));
    setEditDateError(dateError);
    if (dateError) return;
    setBusy("edit"); setError("");
    try { const timing = roundSchedulePayload(editForm); await updateRoundSession(editingId, editForm.date, timing.start, timing.end, timing.activityStart, timing.activityEnd, timing.enableSeats); setEditingId(""); await refresh(); }
    catch (nextError) { setError(roundScheduleErrorMessage(nextError) || "แก้ไขตารางสแกนไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  async function stop(session) {
    if (!window.confirm(`ปิดรอบสแกน QR ของวันที่ ${thaiDate(session.meeting_date)} (${thaiHM(session.starts_at)}–${thaiHM(session.ends_at)} น.)? ปิดแล้วจะแก้ไขรอบนี้หรือเปิดสแกนต่อไม่ได้อีก (ถ้าตั้งผิด ให้เลือก "ยกเลิกรอบนี้" แทน)`)) return;
    setBusy("close"); setError("");
    try { await closeRound(session.id); if (qr?.session_id === session.id) setQr(null); await refresh(); }
    catch (nextError) { setError(nextError.message || "ปิดการเช็คชื่อไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  async function cancel(session) {
    if (!window.confirm(`ยกเลิกรอบของวันที่ ${thaiDate(session.meeting_date)} (${thaiHM(session.starts_at)}–${thaiHM(session.ends_at)} น.)? รอบนี้จะหยุดรับสแกนทันทีและหายจากรายการ แล้วตั้งรอบใหม่ในช่วงเวลาเดิมได้`)) return;
    setBusy("cancel"); setError("");
    try { await cancelRoundSession(session.id); if (qr?.session_id === session.id) setQr(null); if (selectedId === session.id) setSelectedId(""); await refresh(); }
    catch (nextError) { setError(roundScheduleErrorMessage(nextError) || "ยกเลิกรอบไม่สำเร็จ"); }
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
  const timeFields = (form, setForm) => <>
    <label>เวลาเริ่มประชุม<input type="time" required value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label>
    <label>เวลาจบประชุม<input type="time" required value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></label>
    <details className="round-form-wide"><summary>ตัวเลือกเพิ่มเติม (กรณีพิเศษ)</summary>
      <label><input type="checkbox" checked={form.enableSeats !== false} disabled={form === editForm && Boolean(seatConfigs?.[editingId])} onChange={(event) => setForm({ ...form, enableSeats: event.target.checked })} /> เปิดผังที่นั่งพร้อม QR</label>
      <label><input type="checkbox" checked={Boolean(form.customScan)} onChange={(event) => setForm({ ...form, customScan: event.target.checked, scanStart: form.scanStart || form.start, scanEnd: form.scanEnd || form.end })} /> กำหนดช่วงรับสแกนต่างจากเวลาประชุม</label>
      {form.customScan && <><label>เริ่มรับสแกน<input type="time" required value={form.scanStart} onChange={(event) => setForm({ ...form, scanStart: event.target.value })} /></label><label>สิ้นสุดรับสแกน<input type="time" required value={form.scanEnd} onChange={(event) => setForm({ ...form, scanEnd: event.target.value })} /></label><p>ตัวเลือกนี้เปลี่ยนเวลาเปิด–ปิดรับสแกน แต่เวลาสายยังเทียบกับเวลาเริ่มประชุม</p></>}
    </details>
  </>;
  const renderEditForm = () => <>
          <form className="round-schedule-form" onSubmit={saveEdit}>
            <label className="round-form-wide">วันที่ประชุม (ใช้ปี ค.ศ.)<input type="date" required min={minMeetingDate} max={maxMeetingDate} aria-invalid={Boolean(editDateError)} value={editForm.date} onChange={(event) => { setEditForm({ ...editForm, date: event.target.value }); setEditDateError(""); }} /></label>
            {timeFields(editForm, setEditForm)}
            <button className="primary-button" type="submit" disabled={Boolean(busy)}>{busy === "edit" ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button>
            <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => setEditingId("")}>ยกเลิก</button>
          </form>
          {editDateError && <p className="form-error" role="alert">{editDateError}</p>}
  </>;
  return <div className="round-layout">
    <section className="resident-panel round-admin-panel">
      <h2>MM &amp; Grand Round · เช็คชื่อเข้าประชุม</h2>
      <p>ตั้งวันที่และเวลาเริ่ม–จบประชุมครั้งเดียว ระบบเตรียม QR และผังที่นั่งให้พร้อม เปิดรับสแกนเมื่อเริ่มและหยุดเมื่อจบอัตโนมัติ ผู้มาสายยังสแกนได้ตลอดรอบ</p>
      <form className="round-schedule-form" onSubmit={createSchedule}>
        <label className="round-form-wide">วันที่ประชุม (ใช้ปี ค.ศ.)<input type="date" required min={minMeetingDate} max={maxMeetingDate} aria-invalid={Boolean(scheduleDateError)} value={scheduleForm.date} onChange={(event) => { setScheduleForm({ ...scheduleForm, date: event.target.value }); setScheduleDateError(""); }} /></label>
        {timeFields(scheduleForm, setScheduleForm)}
        <button className="primary-button" type="submit" disabled={Boolean(busy)}>{busy === "open" ? "กำลังบันทึก…" : "สร้างรอบประชุม"}</button>
      </form>
      <p className="round-date-hint">ใส่ปีเป็น ค.ศ. เช่น 28/09/2026 (ไม่ใช่ พ.ศ. 2569) · สแกนแล้วถือว่าเช็คชื่อสำเร็จ แม้ยังไม่ได้เลือกที่นั่ง · ตั้งได้หลายรอบต่อวัน ถ้าเวลาสแกนไม่ซ้อนกัน</p>
      {scheduleDateError && <p className="form-error" role="alert">{scheduleDateError}</p>}
      {!visibleSessions.length && <p className="muted-empty">ยังไม่มีตารางสแกนของวันนี้หรือวันถัดไป ตั้งตารางใหม่ด้านบนได้เลย</p>}
      {visibleSessions.map((session) => {
        const isEditing = editingId === session.id;
        const cmeQr = cmeQrFor(session.id);
        const isLiveNow = qr?.session_id === session.id && remaining > 0;
        const status = roundSessionStatus(session, nowMs);
        const acceptsScans = status === "upcoming" || status === "live";
        const canEdit = status !== "closed" && status !== "cancelled";
        const timeLabel = formatRoundTimeRange(session);
        return <section className="round-session-card" key={session.id} aria-labelledby={`round-session-${session.id}`}>
          <h3 id={`round-session-${session.id}`}>ประชุมวันที่ {thaiDate(session.meeting_date)} <span className={`round-status-chip round-status-chip-${status}`}>{ROUND_STATUS_LABELS[status]}</span></h3>
          {!isEditing && <p>{timeLabel && !timeLabel.startsWith("ช่วงสแกน") && <><strong>{timeLabel}</strong> · </>}สแกนได้ {thaiHM(session.starts_at)}–{thaiHM(session.ends_at)} น. ตามเวลาไทย{canEdit && <> · <button type="button" className="link-button" disabled={Boolean(busy)} onClick={() => startEdit(session)}>แก้ไขวันที่/เวลา</button></>}</p>}
          {isEditing && renderEditForm()}
          {isLiveNow && <div className="round-qr"><QRCodeSVG value={`${window.location.origin}/attendance/${qr.token}`} size={270} level="H" marginSize={2} aria-label="QR เช็คชื่อ MM และ Grand Round" /><strong>QR ปัจจุบัน</strong><span>เปลี่ยนใน {Math.ceil(remaining / 1000)} วินาที</span></div>}
          {!isLiveNow && status === "upcoming" && <p role="status" className="round-status round-status-upcoming">ยังไม่ถึงเวลา · QR จะแสดงอัตโนมัติเมื่อถึง {thaiHM(session.starts_at)} น. ของวันที่ {thaiDate(session.meeting_date)}</p>}
          {!isLiveNow && status === "live" && <p role="status" className="round-status round-status-live">กำลังเปิดรับสแกน · กำลังโหลด QR…</p>}
          {isLiveNow && <p role="status" className="round-status round-status-live">กำลังเปิดรับสแกน ถึง {thaiHM(session.ends_at)} น.</p>}
          {status === "ended" && <p role="status" className="round-status">จบรอบตามเวลาแล้ว · ระบบหยุดรับสแกนอัตโนมัติ ไม่ต้องกดปิดซ้ำ</p>}
          {status === "closed" && <p role="status" className="round-status">ปิดรอบแล้ว · {attendanceCount.get(session.id) || 0} คนเช็คชื่อ</p>}
          <div className="round-session-actions">
            {acceptsScans && <details><summary>กรณีพิเศษ</summary><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => stop(session)}>จบประชุมและปิดรับก่อนกำหนด</button></details>}

            {(status === "ended" || status === "closed") && <button type="button" className="link-button" onClick={() => setSelectedId(session.id)}>ดูรายชื่อ</button>}
            {!attendanceCount.get(session.id) && <button className="danger-button" type="button" disabled={Boolean(busy)} onClick={() => cancel(session)}>{busy === "cancel" ? "กำลังยกเลิก…" : "ยกเลิกรอบนี้"}</button>}
          </div>
          {acceptsScans && <section className="round-cme-qr" aria-labelledby={`round-cme-title-${session.id}`}>
            <h4 id={`round-cme-title-${session.id}`}>QR CME สำหรับฉายในห้องประชุม</h4>
            <p>เป็นภาพ QR แยกจาก QR เช็คชื่อ ระบบนี้ไม่เก็บข้อมูลการสแกน CME</p>
            {cmeUrls[session.id] && <img src={cmeUrls[session.id]} alt={`QR CME สำหรับวันที่ ${session.meeting_date}`} />}
            <label className="secondary-button cme-upload-control">{busy === `cme-upload-${session.id}` ? "กำลังอัปโหลด…" : cmeQr ? "เปลี่ยนภาพ QR CME" : "อัปโหลดภาพ QR CME"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={(event) => uploadCme(session, event)} /></label>
            {cmeQr && <button className="danger-button" type="button" disabled={Boolean(busy)} onClick={() => removeCme(session)}>{busy === `cme-remove-${session.id}` ? "กำลังลบ…" : "ลบ QR CME"}</button>}
          </section>}
          {seatConfigs && status !== "cancelled" && <SeatAdminPanel key={`${session.id}:${seatConfigs[session.id]?.on_time_at || ""}`} session={session} config={seatConfigs[session.id] || null} canConfigure={status !== "closed"} onChanged={refresh} />}
        </section>;
      })}
      {endedSessions.length > 0 && <details className="round-ended-sessions" open={endedSessions.some((session) => session.id === editingId) ? true : undefined}>
        <summary>รอบที่หมดเวลาแล้ว ({endedSessions.length})</summary>
        <p>รอบเหล่านี้หยุดรับสแกนตามเวลาแล้ว ไม่ต้องกดปิดซ้ำ ดูรายชื่อหรือแก้เวลาที่ตั้งผิดได้</p>
        <ul>{endedSessions.map((session) => <li key={session.id}>
          <span>{thaiDate(session.meeting_date)} · {formatRoundTimeRange(session) || `${thaiHM(session.starts_at)}–${thaiHM(session.ends_at)} น.`}</span>
          <span className="round-ended-actions">
            <button type="button" className="link-button" onClick={() => setSelectedId(session.id)}>ดูรายชื่อ</button>
            <button type="button" className="link-button" disabled={Boolean(busy)} onClick={() => startEdit(session)}>แก้ไขวันที่/เวลา</button>

          </span>
          {editingId === session.id && <div className="round-ended-edit">{renderEditForm()}</div>}
        </li>)}</ul>
      </details>}
      {pastSeatSessions.length > 0 && <details className="round-ended-sessions">
        <summary>ผังที่นั่งของรอบที่ผ่านมา ({pastSeatSessions.length})</summary>
        <ul>{pastSeatSessions.map((session) => <li key={session.id}>
          <span>{thaiDate(session.meeting_date)} · {formatRoundTimeRange(session) || `${thaiHM(session.starts_at)}–${thaiHM(session.ends_at)} น.`}</span>
          <SeatAdminPanel key={`${session.id}:past`} session={session} config={seatConfigs[session.id]} canConfigure={false} onChanged={refresh} />
        </li>)}</ul>
      </details>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <section className="resident-panel">
      <h2>รายชื่อผู้เข้าประชุม</h2>
      <label>วันที่ประชุม<select value={selected?.id || ""} onChange={(event) => setSelectedId(event.target.value)}>{reportSessions.map((item) => <option key={item.id} value={item.id}>{thaiDate(item.meeting_date)}{formatRoundTimeRange(item) ? ` · ${formatRoundTimeRange(item)}` : ""}</option>)}</select></label>
      <div className="round-filter-grid"><label>ชั้นปี (PGY)<select value={roundFilters.pgy} onChange={(event) => { const pgy = event.target.value; const chosen = roundResidents.find((resident) => resident.id === roundFilters.residentId); setRoundFilters({ pgy, residentId: chosen && pgy && Number(chosen.pgy) !== Number(pgy) ? "" : roundFilters.residentId }); }}><option value="">ทุกชั้นปี</option>{[1, 2, 3, 4].map((year) => <option key={year} value={year}>PGY {year}</option>)}</select></label><label>Resident<select value={roundFilters.residentId} onChange={(event) => setRoundFilters({ ...roundFilters, residentId: event.target.value })}><option value="">Resident ทุกคน</option>{residentsForPgy.map((resident) => <option key={resident.id} value={resident.id}>{resident.name} · PGY {resident.pgy}</option>)}</select></label></div>
      {selected && <div className="round-export"><span>{rows.length} คน</span><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => runExport("csv")}>ดาวน์โหลด CSV</button><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => runExport("xlsx")}>ดาวน์โหลด Excel</button></div>}
      <section className="round-pdf-export" aria-labelledby="round-pdf-title">
        <h3 id="round-pdf-title">รายงาน PDF</h3>
        <p>เลือกวันเดียวหรือช่วงวันที่ที่ต้องการ แล้วดาวน์โหลดเป็น PDF รวม หรือแยกหนึ่งไฟล์ต่อวัน (หลายวันจะรวมเป็นไฟล์ .zip ไฟล์เดียว)</p>
        <div className="round-date-range">
          <label>ตั้งแต่วันที่<input type="date" value={pdfDateFrom} onChange={(event) => setPdfDateFrom(event.target.value)} /></label>
          <label>ถึงวันที่<input type="date" value={pdfDateTo} onChange={(event) => setPdfDateTo(event.target.value)} /></label>
        </div>
        <div className="round-export"><span>{pdfDateRangeInvalid ? "ตรวจสอบช่วงวันที่" : `${pdfSessions.length} วันประชุม`}</span><button className="secondary-button" type="button" disabled={Boolean(busy) || pdfDateRangeInvalid || !pdfSessions.length} onClick={() => runPdfExport(false)}>{busy === "pdf-combined" ? "กำลังสร้าง PDF…" : "ดาวน์โหลด PDF รวม"}</button><button className="secondary-button" type="button" disabled={Boolean(busy) || pdfDateRangeInvalid || !pdfSessions.length} onClick={() => runPdfExport(true)}>{busy === "pdf-split" ? "กำลังสร้าง PDF…" : "ดาวน์โหลด PDF แยกวัน"}</button></div>
      </section>
      <div className="resident-table-wrap"><table><thead><tr><th>ชื่อ</th><th>PGY</th><th>อีเมล</th><th>บทบาท</th><th>เวลาเช็คชื่อ (Asia/Bangkok)</th><th>เทียบเวลาเริ่มประชุม</th></tr></thead><tbody>{rows.map((row) => <tr key={row.user_id}><td>{row.resident_profiles?.full_name || "—"}</td><td>{row.resident_profiles?.pgy ? `PGY ${row.resident_profiles.pgy}` : "—"}</td><td>{row.resident_profiles?.email || "—"}</td><td>{row.role_at_check_in === "staff" ? "Staff" : "Resident"}</td><td>{thaiTime(row.checked_in_at)}{row.resident_round_attendance_adjustments?.length > 0 && <small>Admin บันทึกย้อนหลัง · {row.resident_round_attendance_adjustments[0].reason}</small>}</td><td>{roundArrivalLabel(selected, row.checked_in_at)}</td></tr>)}{!rows.length && <tr><td colSpan="6">ยังไม่มีผู้เช็คชื่อตามตัวกรอง</td></tr>}</tbody></table></div>
      {selected && <MissingAttendance key={selected.id} session={selected} attendance={data.attendance} onDone={refresh} />}
    </section>
  </div>;
}

// Check-ins already sent, shared by every mounted copy. The per-instance ref
// alone let a quick tab switch remount the component and submit the same
// token again; a remounted copy now waits for the first request instead.
const roundCheckIns = new Map();

export function RoundCheckIn({ token: linkToken, onTokenUsed: onLinkTokenUsed, user }) {
  const [scannedToken, setScannedToken] = useState("");
  const token = linkToken || scannedToken;
  const onTokenUsed = () => { setScannedToken(""); onLinkTokenUsed?.(); };
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(Boolean(token));
  const submittedToken = useRef("");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    async function run() {
      // Submit each scanned token exactly once (StrictMode runs effects twice
      // in development). onTokenUsed clears the token and the URL, which
      // re-runs this effect without a token and refreshes the history.
      if (token) {
        if (submittedToken.current === token) return;
        submittedToken.current = token;
        setBusy(true);
        try {
          // Forget the token once settled so a rescan after a network error
          // retries; onTokenUsed has cleared the token by then.
          if (!roundCheckIns.has(token)) roundCheckIns.set(token, checkInRound(token).finally(() => roundCheckIns.delete(token)));
          const next = await roundCheckIns.get(token);
          if (mounted.current) { setResult(next); setError(""); }
        } catch (nextError) {
          if (mounted.current) setError(roundCheckInErrorMessage(nextError));
        } finally {
          if (mounted.current) setBusy(false);
          onTokenUsed?.();
        }
        return;
      }
      // Without a token the page is back to history: allow the same QR to be scanned again.
      submittedToken.current = "";
      try {
        const records = await loadOwnRoundAttendance();
        if (mounted.current) setHistory(records);
      } catch (nextError) { if (mounted.current) setError(nextError.message || "โหลดประวัติการเช็คชื่อไม่สำเร็จ"); }
      finally { if (mounted.current) setBusy(false); }
    }
    run();
  }, [token]);
  return <section className="resident-panel round-checkin">
    <h2>เช็คชื่อ MM &amp; Grand Round</h2>
    {busy && <p role="status">กำลังตรวจสอบ QR และบันทึกเวลา…</p>}
    {result && <div className="form-success" role="status"><strong>{result.already_checked_in ? "คุณเช็คชื่อไว้แล้ว" : "เช็คชื่อสำเร็จ"}</strong><p>Timestamp scan QR: {thaiTime(result.checked_in_at)}</p></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!token && <><p>สแกน QR ที่แสดงในห้องประชุมเพื่อเช็คชื่อ</p><RoundQrScanner onToken={setScannedToken} disabled={busy} role={user?.role} /></>}
    <h3>ประวัติการเช็คชื่อของฉัน</h3>
    {history.length ? <ul>{history.map((item) => <li key={item.session_id}>{thaiTime(item.checked_in_at)}</li>)}</ul> : <p>ยังไม่มีประวัติการเช็คชื่อ</p>}
    {user && !token && <SeatMapPanel user={user} refreshKey={result?.checked_in_at || ""} />}
  </section>;
}

function MissingAttendance({ session, attendance, onDone }) {
  const [people,setPeople] = useState([]), [audits,setAudits] = useState([]), [userId,setUserId] = useState("");
  const [time,setTime] = useState(""), [reason,setReason] = useState(""), [busy,setBusy] = useState(false), [error,setError] = useState(""), [loaded,setLoaded] = useState(false);
  const [message,setMessage] = useState("");
  const flight=useRef(false);
  async function load() {
    setError("");setBusy(true);
    try { const [accounts,history] = await Promise.all([listAdminAccounts(),loadRoundAttendanceAdjustments(session.id)]);setPeople(accounts.filter(p=>p.active && ['resident','staff'].includes(p.role)));setAudits(history);setLoaded(true); }
    catch { setError("โหลดข้อมูลแก้ไขไม่สำเร็จ กรุณาลองใหม่"); } finally {setBusy(false);}
  }
  async function save(e) {
    e.preventDefault(); if(flight.current)return;flight.current=true;setBusy(true);setError("");setMessage("");
    try {await recordMissingRoundAttendance(session.id,userId,`${session.meeting_date}T${time}:00+07:00`,reason.trim());setMessage("บันทึกย้อนหลังพร้อมเหตุผลแล้ว");setUserId("");setReason("");await onDone();await load();}
    catch(e){setError(e.message || "ยังยืนยันผลการบันทึกไม่ได้ กรุณาโหลดรายชื่อเพื่อตรวจผลก่อนลองใหม่");}
    finally{flight.current=false;setBusy(false);}
  }
  const existing=new Set(attendance.filter(a=>a.session_id===session.id).map(a=>a.user_id));
  return <details><summary>กรณีลืมสแกน · Admin บันทึกย้อนหลังพร้อมเหตุผล</summary><p>ใช้เมื่อยืนยันว่าเข้าประชุมจริงเท่านั้น ไม่แก้ทับเวลาเช็คชื่อเดิม ระบบเก็บผู้บันทึกและเหตุผลไว้</p>
    {!loaded && <button type="button" className="secondary-button" disabled={busy} onClick={load}>โหลดรายชื่อและประวัติ</button>}
    {loaded && <form onSubmit={save}><fieldset disabled={busy}><label>ผู้เข้าประชุม<select required value={userId} onChange={e=>setUserId(e.target.value)}><option value="">เลือกบัญชีที่ยังไม่เช็คชื่อ</option>{people.filter(p=>!existing.has(p.user_id)).map(p=><option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select></label><label>เวลาเข้าประชุมจริง ({session.meeting_date})<input type="time" required value={time} onChange={e=>setTime(e.target.value)} /></label><label>เหตุผลและหลักฐานยืนยัน<input required minLength={5} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} /></label><button className="primary-button">บันทึกย้อนหลังพร้อมเหตุผล</button></fieldset></form>}
    {audits.map(a=><p key={a.user_id}>{people.find(p=>p.user_id===a.user_id)?.full_name || 'บัญชีที่บันทึกย้อนหลัง'} · เข้า {thaiHM(a.checked_in_at)} น. · {a.reason} · บันทึกเมื่อ {thaiTime(a.recorded_at)} โดย {people.find(p=>p.user_id===a.actor_id)?.full_name || 'Admin'}</p>)}
    {message && <p role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
  </details>;
}
