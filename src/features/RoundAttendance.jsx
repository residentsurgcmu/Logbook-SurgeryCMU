import React, { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { listAdminAccounts, loadRoundAttendanceAdjustments, recordMissingRoundAttendance, saveNamedRoundConference, cancelRoundSession, checkInRound, clearRoundCmeQr, closeRound, currentRoundQrs, loadMyRoundCmeUrl, loadOwnRoundAttendance, loadRoundAdminData, loadRoundCmeQrUrl, loadRoundCmeSpeakerQr, openRound, updateRoundSession, uploadRoundCmeQr } from "../residentApi";
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
const CONFERENCE_ROOM = { key: "opportunity-order", label: "ผัง ห้องโอกาส-ระเบียบ" };
const roundTitle = (session) => session.conference_name || "MM & Grand Round";
const EMPTY_SCHEDULE = { name: "", roomKey: CONFERENCE_ROOM.key, date: "", start: "", end: "", activityStart: "", activityEnd: "", customScan: false, scanStart: "", scanEnd: "", enableSeats: true };
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
  const [qrs, setQrs] = useState([]);
  const [seatConfigs, setSeatConfigs] = useState(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [adminPage, setAdminPage] = useState("rounds");
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
  const namedConference = adminPage === "conference-rooms";
  const allSessions = useMemo(() => data.sessions.filter((item) => !item.cancelled_at), [data.sessions]);
  const reportSessions = useMemo(() => allSessions.filter((item) =>
    Boolean(item.conference_name) === namedConference
  ), [allSessions, namedConference]);
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
      const [nextData, nextQrs, nextSeatConfigs] = await Promise.all([loadRoundAdminData(), currentRoundQrs(), adminListSeatConfigs().catch(() => null)]);
      // Ignore a slower, older response (e.g. the 10 s poll) that finishes
      // after a newer refresh, so it cannot hide a just-created session.
      if (!mounted.current || seq !== refreshSeq.current) return;
      setData(nextData);
      setSelectedId((previous) => previous || nextData.sessions.find((item) => !item.cancelled_at)?.id || "");
      setQrs(nextQrs);
      const nextQr = nextQrs[0];
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
  useEffect(() => {
    if (!qrs.length) return;
    const expiresAt = Math.min(...qrs.map(({ valid_until }) => new Date(valid_until).getTime()));
    const timer = window.setTimeout(refresh, Math.max(0, expiresAt - (Date.now() + offsetMs)));
    return () => window.clearTimeout(timer);
  }, [qrs, offsetMs]);
  async function createSchedule(event) {
    event.preventDefault();
    const dateError = (namedConference && !scheduleForm.name.trim() ? "กรุณาระบุชื่อ Conference" : "")
      || validateRoundMeetingDate(scheduleForm.date, new Date(Date.now() + offsetMs))
      || validateRoundTimes(roundSchedulePayload(scheduleForm));
    setScheduleDateError(dateError);
    if (dateError) return;
    setBusy("open"); setError("");
    try {
      const timing = roundSchedulePayload(scheduleForm);
      const id = namedConference
        ? await saveNamedRoundConference(null, scheduleForm.name, scheduleForm.roomKey, scheduleForm.date, timing)
        : await openRound(scheduleForm.date, timing.start, timing.end, timing.activityStart, timing.activityEnd, timing.enableSeats);
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
    setEditForm({ name: session.conference_name || "", roomKey: CONFERENCE_ROOM.key, date: session.meeting_date, start, end, scanStart, scanEnd, customScan: start !== scanStart || end !== scanEnd, enableSeats: true });
  }
  async function saveEdit(event) {
    event.preventDefault();
    const dateError = (namedConference && !editForm.name.trim() ? "กรุณาระบุชื่อ Conference" : "")
      || validateRoundMeetingDate(editForm.date, new Date(Date.now() + offsetMs))
      || validateRoundTimes(roundSchedulePayload(editForm));
    setEditDateError(dateError);
    if (dateError) return;
    setBusy("edit"); setError("");
    try {
      const timing = roundSchedulePayload(editForm);
      if (namedConference) await saveNamedRoundConference(editingId, editForm.name, editForm.roomKey, editForm.date, timing);
      else await updateRoundSession(editingId, editForm.date, timing.start, timing.end, timing.activityStart, timing.activityEnd, timing.enableSeats);
      setEditingId(""); await refresh();
    }
    catch (nextError) { setError(roundScheduleErrorMessage(nextError) || "แก้ไขตารางสแกนไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  async function stop(session) {
    if (!window.confirm(`ปิดรอบสแกน QR ของวันที่ ${thaiDate(session.meeting_date)} (${thaiHM(session.starts_at)}–${thaiHM(session.ends_at)} น.)? ปิดแล้วจะแก้ไขรอบนี้หรือเปิดสแกนต่อไม่ได้อีก (ถ้าตั้งผิด ให้เลือก "ยกเลิกรอบนี้" แทน)`)) return;
    setBusy("close"); setError("");
    try { await closeRound(session.id); setQrs((rows) => rows.filter(({ session_id }) => session_id !== session.id)); await refresh(); }
    catch (nextError) { setError(nextError.message || "ปิดการเช็คชื่อไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  async function cancel(session) {
    if (!window.confirm(`ยกเลิกรอบของวันที่ ${thaiDate(session.meeting_date)} (${thaiHM(session.starts_at)}–${thaiHM(session.ends_at)} น.)? รอบนี้จะหยุดรับสแกนทันทีและหายจากรายการ แล้วตั้งรอบใหม่ในช่วงเวลาเดิมได้`)) return;
    setBusy("cancel"); setError("");
    try { await cancelRoundSession(session.id); setQrs((rows) => rows.filter(({ session_id }) => session_id !== session.id)); if (selectedId === session.id) setSelectedId(""); await refresh(); }
    catch (nextError) { setError(roundScheduleErrorMessage(nextError) || "ยกเลิกรอบไม่สำเร็จ"); }
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
      {!namedConference && <label className="round-option-check"><input type="checkbox" checked={form.enableSeats !== false} disabled={form === editForm && Boolean(seatConfigs?.[editingId])} onChange={(event) => setForm({ ...form, enableSeats: event.target.checked })} /> เปิดผังที่นั่งพร้อม QR</label>}
      <label className="round-option-check"><input type="checkbox" checked={Boolean(form.customScan)} onChange={(event) => setForm({ ...form, customScan: event.target.checked, scanStart: form.scanStart || form.start, scanEnd: form.scanEnd || form.end })} /> กำหนดช่วงรับสแกนต่างจากเวลาประชุม</label>
      {form.customScan && <><label>เริ่มรับสแกน<input type="time" required value={form.scanStart} onChange={(event) => setForm({ ...form, scanStart: event.target.value })} /></label><label>สิ้นสุดรับสแกน<input type="time" required value={form.scanEnd} onChange={(event) => setForm({ ...form, scanEnd: event.target.value })} /></label><p>ตัวเลือกนี้เปลี่ยนเวลาเปิด–ปิดรับสแกน แต่เวลาสายยังเทียบกับเวลาเริ่มประชุม</p></>}
    </details>
  </>;
  const conferenceFields = (form, setForm) => namedConference && <>
    <label className="round-form-wide">ชื่อ Conference
      <input required maxLength={120} placeholder="เช่น Upper GI · Journal Club" value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })} />
    </label>
    <label className="round-form-wide">ห้องประชุม
      <select value={form.roomKey} onChange={(event) => setForm({ ...form, roomKey: event.target.value })}>
        <option value={CONFERENCE_ROOM.key}>{CONFERENCE_ROOM.label}</option>
      </select>
    </label>
  </>;
  const renderEditForm = () => <>
          <form className="round-schedule-form" onSubmit={saveEdit}>
            {conferenceFields(editForm, setEditForm)}
            <label className="round-form-wide">วันที่ประชุม (ใช้ปี ค.ศ.)<input type="date" required min={minMeetingDate} max={maxMeetingDate} aria-invalid={Boolean(editDateError)} value={editForm.date} onChange={(event) => { setEditForm({ ...editForm, date: event.target.value }); setEditDateError(""); }} /></label>
            {timeFields(editForm, setEditForm)}
            <div className="round-form-actions round-form-wide"><button className="primary-button" type="submit" disabled={Boolean(busy)}>{busy === "edit" ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button>
            <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => setEditingId("")}>ยกเลิก</button></div>
          </form>
          {editDateError && <p className="form-error" role="alert">{editDateError}</p>}
  </>;
  const adminNav = <nav className="resident-panel round-admin-nav" aria-label="จัดการรอบประชุม">
    {[["rounds", "รอบประชุมและเช็คชื่อ"], ["conference-rooms", "Conference ย่อย"], ["cme", "QR CME"]].map(([id, label]) =>
      <button key={id} type="button" aria-pressed={adminPage === id}
        className={adminPage === id ? "primary-button" : "secondary-button"} disabled={Boolean(busy)}
        onClick={() => {
          setAdminPage(id); setEditingId(""); setScheduleForm(EMPTY_SCHEDULE);
          setScheduleDateError(""); setError("");
        }}>{label}</button>
    )}
  </nav>;
  if (adminPage === "cme") return <>{adminNav}
    <RoundCmeAdmin user={user} sessions={allSessions.filter((session) => ["upcoming", "live"].includes(roundSessionStatus(session, nowMs)))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))}
      attendeeRows={data.cmeQr} refresh={refresh} />
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
  return <>{adminNav}<div className="round-layout">
    <section className="resident-panel round-admin-panel">
      <h2>{namedConference ? "Conference ย่อย · เช็คชื่อเข้าประชุม" : "MM & Grand Round · เช็คชื่อเข้าประชุม"}</h2>
      <p>ตั้งวันที่และเวลาเริ่ม–จบประชุมครั้งเดียว ระบบเตรียม QR และผังที่นั่งให้พร้อม เปิดรับสแกนเมื่อเริ่มและหยุดเมื่อจบอัตโนมัติ ผู้มาสายยังสแกนได้ตลอดรอบ</p>
      <form className="round-schedule-form" onSubmit={createSchedule}>
        {conferenceFields(scheduleForm, setScheduleForm)}
        <label className="round-form-wide">วันที่ประชุม (ใช้ปี ค.ศ.)<input type="date" required min={minMeetingDate} max={maxMeetingDate} aria-invalid={Boolean(scheduleDateError)} value={scheduleForm.date} onChange={(event) => { setScheduleForm({ ...scheduleForm, date: event.target.value }); setScheduleDateError(""); }} /></label>
        {timeFields(scheduleForm, setScheduleForm)}
        <button className="primary-button" type="submit" disabled={Boolean(busy)}>{busy === "open" ? "กำลังบันทึก…" : "สร้างรอบประชุม"}</button>
      </form>
      <p className="round-date-hint">ใส่ปีเป็น ค.ศ. เช่น 28/09/2026 (ไม่ใช่ พ.ศ. 2569) · สแกนแล้วถือว่าเช็คชื่อสำเร็จ แม้ยังไม่ได้เลือกที่นั่ง · รอบหลักกับ Conference ย่อยเปิดพร้อมกันได้ แต่รอบในกลุ่มเดียวกันต้องไม่ซ้อนเวลา</p>
      {scheduleDateError && <p className="form-error" role="alert">{scheduleDateError}</p>}
      {!visibleSessions.length && <p className="muted-empty">ยังไม่มีตารางสแกนของวันนี้หรือวันถัดไป ตั้งตารางใหม่ด้านบนได้เลย</p>}
      {visibleSessions.map((session) => {
        const isEditing = editingId === session.id;
        const qr = qrs.find(({ session_id }) => session_id === session.id);
        const remaining = qr ? new Date(qr.valid_until).getTime() - nowMs : 0;
        const isLiveNow = remaining > 0;
        const status = roundSessionStatus(session, nowMs);
        const acceptsScans = status === "upcoming" || status === "live";
        const canEdit = status !== "closed" && status !== "cancelled";
        const timeLabel = formatRoundTimeRange(session);
        return <section className="round-session-card" key={session.id} aria-labelledby={`round-session-${session.id}`}>
          <h3 id={`round-session-${session.id}`}>{session.conference_name && <>{session.conference_name} · </>}ประชุมวันที่ {thaiDate(session.meeting_date)} <span className={`round-status-chip round-status-chip-${status}`}>{ROUND_STATUS_LABELS[status]}</span></h3>
          {!isEditing && <p>{timeLabel && !timeLabel.startsWith("ช่วงสแกน") && <><strong>{timeLabel}</strong> · </>}สแกนได้ {thaiHM(session.starts_at)}–{thaiHM(session.ends_at)} น. ตามเวลาไทย{canEdit && <> · <button type="button" className="link-button" disabled={Boolean(busy)} onClick={() => startEdit(session)}>แก้ไขวันที่/เวลา</button></>}</p>}
          {isEditing && renderEditForm()}
          {isLiveNow && <div className="round-qr"><QRCodeSVG value={`${window.location.origin}/attendance/${qr.token}`} size={270} level="H" marginSize={2} aria-label={`QR เช็คชื่อ ${roundTitle(session)}`} /><strong>QR ปัจจุบัน</strong><span>เปลี่ยนใน {Math.ceil(remaining / 1000)} วินาที</span></div>}
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
          {seatConfigs && status !== "cancelled" && <SeatAdminPanel key={`${session.id}:${seatConfigs[session.id]?.on_time_at || ""}`} session={session} config={seatConfigs[session.id] || null} canConfigure={status !== "closed"} onChanged={refresh} />}
        </section>;
      })}
      {endedSessions.length > 0 && <details className="round-ended-sessions" open={endedSessions.some((session) => session.id === editingId) ? true : undefined}>
        <summary>รอบที่หมดเวลาแล้ว ({endedSessions.length})</summary>
        <p>รอบเหล่านี้หยุดรับสแกนตามเวลาแล้ว ไม่ต้องกดปิดซ้ำ ดูรายชื่อหรือแก้เวลาที่ตั้งผิดได้</p>
        <ul>{endedSessions.map((session) => <li key={session.id}>
          <span>{session.conference_name && `${session.conference_name} · `}{thaiDate(session.meeting_date)} · {formatRoundTimeRange(session) || `${thaiHM(session.starts_at)}–${thaiHM(session.ends_at)} น.`}</span>
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
          <span>{session.conference_name && `${session.conference_name} · `}{thaiDate(session.meeting_date)} · {formatRoundTimeRange(session) || `${thaiHM(session.starts_at)}–${thaiHM(session.ends_at)} น.`}</span>
          <SeatAdminPanel key={`${session.id}:past`} session={session} config={seatConfigs[session.id]} canConfigure={false} onChanged={refresh} />
        </li>)}</ul>
      </details>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <section className="resident-panel">
      <h2>รายชื่อผู้เข้าประชุม</h2>
      <label>วันที่ประชุม<select value={selected?.id || ""} onChange={(event) => setSelectedId(event.target.value)}>{reportSessions.map((item) => <option key={item.id} value={item.id}>{item.conference_name && `${item.conference_name} · `}{thaiDate(item.meeting_date)}{formatRoundTimeRange(item) ? ` · ${formatRoundTimeRange(item)}` : ""}</option>)}</select></label>
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
  </div></>;
}

const cmeKinds = { attendee: "ผู้เข้าร่วม", speaker: "ผู้บรรยาย" };

function RoundCmeAdmin({ user, sessions, attendeeRows, refresh }) {
  const [sessionId, setSessionId] = useState("");
  const [speakerRow, setSpeakerRow] = useState(null);
  const [loadSpeakerKey, setLoadSpeakerKey] = useState(0);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [speakerError, setSpeakerError] = useState("");
  const [loadingSpeaker, setLoadingSpeaker] = useState(false);
  const session = sessions.find(({ id }) => id === sessionId) || sessions[0];
  const selectedId = session?.id;
  const attendee = attendeeRows.find(({ session_id }) => session_id === selectedId);
  const speaker = speakerRow?.sessionId === selectedId ? speakerRow?.row : null;
  const saving = useRef(false);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setLoadingSpeaker(true);
    setSpeakerError("");
    loadRoundCmeSpeakerQr(selectedId).then((row) => {
      if (active) setSpeakerRow({ sessionId: selectedId, row });
    }).catch(() => {
      if (active) setSpeakerError("โหลดข้อมูล QR ผู้บรรยายไม่สำเร็จ");
    }).finally(() => {
      if (active) setLoadingSpeaker(false);
    });
    return () => { active = false; };
  }, [selectedId, loadSpeakerKey]);

  async function change(kind, file) {
    if (!session || saving.current) return;
    const id = session.id;
    if (!file && !window.confirm(`ลบ QR CME สำหรับ${cmeKinds[kind]} ของรอบนี้?`)) return;
    saving.current = true;
    setBusy(kind); setNotice(""); setError("");
    try {
      if (file) await uploadRoundCmeQr(id, user.id, file, kind);
      else await clearRoundCmeQr(id, kind);
      if (kind === "speaker") setLoadSpeakerKey((value) => value + 1);
      else await refresh();
      setNotice(`${file ? "บันทึก" : "ลบ"} QR สำหรับ${cmeKinds[kind]}แล้ว`);
    } catch (nextError) {
      setError(nextError.message || "บันทึก QR CME ไม่สำเร็จ");
    } finally {
      setBusy(""); saving.current = false;
    }
  }

  return <section className="resident-panel round-cme-admin" aria-labelledby="round-cme-heading">
    <h2 id="round-cme-heading">QR CME สำหรับฉายในห้องประชุม</h2>
    <p>อัปโหลดเฉพาะรอบที่มี CME เลือกรอบแล้วอัปโหลดรูป QR จาก CCME แยกตามประเภท ระบบนี้ไม่เก็บข้อมูลการสแกน CME</p>
    {session ? <>
      <label>รอบประชุม<select value={selectedId} disabled={Boolean(busy)} onChange={(event) => {
        setSessionId(event.target.value); setNotice(""); setError(""); setSpeakerError("");
      }}>{sessions.map((item) => <option key={item.id} value={item.id}>
        {roundTitle(item)} · {thaiDate(item.meeting_date)} · {formatRoundTimeRange(item) || `${thaiHM(item.starts_at)}–${thaiHM(item.ends_at)} น.`}
      </option>)}</select></label>
      <div className="round-cme-admin-grid">
        {Object.entries(cmeKinds).map(([kind, label]) => {
          const row = kind === "speaker" ? speaker : attendee;
          const href = kind === "speaker" ? row?.speaker_url : row?.attendee_url;
          return <section className="round-cme-qr" aria-label={`QR สำหรับ${label}`} key={kind}>
            <h3>สำหรับ{label}</h3>
            <p>{kind === "attendee" ? "เปิดหลังบัญชี Resident เช็คชื่อสำเร็จ" : "เปิดหลังบัญชี Staff เช็คชื่อสำเร็จ"}</p>
            {row?.storage_path && <RoundCmePreview key={row.storage_path} path={row.storage_path} label={label} />}
            {href && <a className="secondary-button" href={href} target="_blank" rel="noopener noreferrer">เปิดลิงก์ CCME สำหรับ{label}</a>}
            {row && !href && <p>ภาพเดิมยังไม่ผูกลิงก์ กรุณาอัปโหลด QR ต้นฉบับใหม่</p>}
            {kind === "speaker" && loadingSpeaker && <p role="status">กำลังโหลด QR ผู้บรรยาย…</p>}
            {kind === "speaker" && speakerError && <p className="form-error" role="alert">{speakerError}</p>}
            <label className="secondary-button cme-upload-control">{busy === kind ? "กำลังบันทึก…" : row ? "เปลี่ยนภาพ QR" : "อัปโหลดภาพ QR"} สำหรับ{label}
              <input type="file" accept="image/jpeg,image/png,image/webp"
                disabled={Boolean(busy) || (kind === "speaker" && loadingSpeaker)} onChange={(event) => {
                  const file = event.target.files?.[0]; event.target.value = "";
                  if (file) change(kind, file);
                }} />
            </label>
            {row && <button type="button" className="danger-button" disabled={Boolean(busy) || (kind === "speaker" && loadingSpeaker)}
              onClick={() => change(kind, null)}>ลบ QR สำหรับ{label}</button>}
          </section>;
        })}
      </div>
    </> : <p>ยังไม่มีรอบที่กำลังเปิดหรือกำลังจะมาถึง กรุณาสร้างรอบในหน้า “รอบประชุมและเช็คชื่อ” หรือ “Conference ย่อย” ก่อน</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

function RoundCmePreview({ path, label }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    loadRoundCmeQrUrl(path).then((next) => { if (active) setUrl(next); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [path]);
  if (error) return <p role="alert">โหลดภาพ QR ไม่สำเร็จ</p>;
  return url ? <img src={url} alt={`QR CME สำหรับ${label}`} /> : <p role="status">กำลังโหลดภาพ QR…</p>;
}

// Check-ins already sent, shared by every mounted copy. The per-instance ref
// alone let a quick tab switch remount the component and submit the same
// token again; a remounted copy now waits for the first request instead.
const roundCheckIns = new Map();

const CME_REDIRECT_SECONDS = 5;

function RoundCmeNext({ href }) {
  const [seconds, setSeconds] = useState(CME_REDIRECT_SECONDS);
  const pending = useRef(true);
  const [attempted, setAttempted] = useState(false);
  function stop() {
    pending.current = false;
    setSeconds(null);
  }
  useEffect(() => {
    if (seconds == null) return;
    const timer = window.setTimeout(() => {
      if (!pending.current) return;
      if (seconds > 1) {
        setSeconds(seconds - 1);
        return;
      }
      stop();
      setAttempted(true);
      // Some browsers require a fresh tap to open a tab. The link stays
      // available if the timed open is blocked; the RC page is never replaced.
      window.open(href, "_blank", "noopener,noreferrer");
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [seconds, href]);

  return <div className="round-cme-next">
    {seconds != null && <p>กำลังจะเปิด CCME ในแท็บใหม่</p>}
    <a className="primary-button" href={href} target="_blank" rel="noopener noreferrer" onClick={stop}>เปิด CCME ตอนนี้ (แท็บใหม่)</a>
    {seconds != null && <button className="secondary-button" type="button" onClick={stop}
      aria-label="ยกเลิกการเปิด CCME อัตโนมัติ">
      ยกเลิกเปิดอัตโนมัติ <span aria-hidden="true">({seconds} วินาที)</span>
    </button>}
    {attempted && <small>หากแท็บ CCME ไม่เปิด ให้กดปุ่มด้านบน</small>}
  </div>;
}

export function RoundCheckIn({ token: linkToken, onTokenUsed: onLinkTokenUsed, user, onCheckedIn, activeConferenceId }) {
  const [scannedToken, setScannedToken] = useState("");
  const token = linkToken || scannedToken;
  const onTokenUsed = () => { setScannedToken(""); onLinkTokenUsed?.(); };
  const [result, setResult] = useState(null);
  const [cme, setCme] = useState(null);
  const checkInSequence = useRef(0);
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
        const sequence = ++checkInSequence.current;
        setCme(null);
        setResult(null);
        setBusy(true);
        try {
          // Forget the token once settled so a rescan after a network error
          // retries; onTokenUsed has cleared the token by then.
          if (!roundCheckIns.has(token)) roundCheckIns.set(token, checkInRound(token).finally(() => roundCheckIns.delete(token)));
          const next = await roundCheckIns.get(token);
          if (mounted.current) {
            setResult(next); setError("");
            if (next?.session_id) {
              onCheckedIn?.();
              loadMyRoundCmeUrl(next.session_id, user?.role).then((href) => {
                if (mounted.current && checkInSequence.current === sequence && href) setCme({ href, sequence });
              }).catch(() => {});
            }
          }
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
    {result && <div className="form-success" role="status"><strong>{result.already_checked_in ? "คุณเช็คชื่อไว้แล้ว" : "เช็คชื่อสำเร็จ"}</strong><p>Timestamp scan QR: {thaiTime(result.checked_in_at)}</p>{cme && <RoundCmeNext key={cme.sequence} href={cme.href} />}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!token && <><p>สแกน QR ที่แสดงในห้องประชุมเพื่อเช็คชื่อ</p><RoundQrScanner onToken={setScannedToken} disabled={busy} role={user?.role} /></>}
    <h3>ประวัติการเช็คชื่อของฉัน</h3>
    {history.length ? <ul>{history.map((item) => <li key={item.session_id}>{thaiTime(item.checked_in_at)}</li>)}</ul> : <p>ยังไม่มีประวัติการเช็คชื่อ</p>}
    {user && !token && <SeatMapPanel user={user} refreshKey={result?.checked_in_at || ""} checkedInSessionId={result?.session_id || activeConferenceId || ""} />}
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
