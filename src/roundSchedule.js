// Pure helpers for MM & Grand Round scheduling (kept separate for tests).

const BANGKOK_TIME_ZONE = "Asia/Bangkok";

export const MAX_ROUND_DATE_DISTANCE_DAYS = 366;

export function bangkokIsoDate(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: BANGKOK_TIME_ZONE }).format(at);
}

function isoDateToUtcMs(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function shiftIsoDate(value, days) {
  const ms = isoDateToUtcMs(value);
  if (Number.isNaN(ms)) return "";
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

// Returns "" when the meeting date is acceptable, otherwise a Thai error message.
// Catches the common mistake of typing the Buddhist year (e.g. 2569) into a
// Gregorian <input type="date">, which would store the session ~543 years away.
export function validateRoundMeetingDate(value, at = new Date()) {
  const ms = isoDateToUtcMs(value);
  if (Number.isNaN(ms)) return "กรุณาเลือกวันที่ประชุม";
  const year = Number(String(value).slice(0, 4));
  if (year > 2400) return `ปีที่ใส่ (${year}) น่าจะเป็นปี พ.ศ. กรุณาใส่ปี ค.ศ. เช่น ${year - 543}`;
  const todayMs = isoDateToUtcMs(bangkokIsoDate(at));
  const distanceDays = Math.abs(ms - todayMs) / 86400000;
  if (distanceDays > MAX_ROUND_DATE_DISTANCE_DAYS) return "วันที่ประชุมต้องอยู่ภายใน 1 ปีจากวันนี้ และใช้ปี ค.ศ. (เช่น 2026)";
  return "";
}

// "cancelled" | "closed" | "upcoming" | "live" | "ended". A cancelled or
// manually closed session no longer accepts scans, whatever its window says.
export function roundSessionStatus(session, nowMs = Date.now()) {
  if (session.cancelled_at) return "cancelled";
  if (session.closed_at) return "closed";
  const starts = new Date(session.starts_at).getTime();
  const ends = new Date(session.ends_at).getTime();
  if (nowMs > ends) return "ended";
  if (nowMs < starts) return "upcoming";
  return "live";
}

export const ROUND_STATUS_LABELS = {
  upcoming: "รอเปิดสแกน",
  live: "กำลังเปิดสแกน",
  ended: "หมดเวลาสแกน",
  closed: "ปิดแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

const bangkokHM = (value) => {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: BANGKOK_TIME_ZONE }).format(ms);
};

// "09:00–12:00 น." from the Admin-entered activity time, otherwise from the
// scan window; "" when the session carries neither (older callers, tests).
export function formatRoundTimeRange(session) {
  const activityStart = String(session?.activity_start_time || "").slice(0, 5);
  const activityEnd = String(session?.activity_end_time || "").slice(0, 5);
  if (activityStart && activityEnd) return `เวลา ${activityStart}–${activityEnd} น.`;
  const start = bangkokHM(session?.starts_at);
  const end = bangkokHM(session?.ends_at);
  return start && end ? `ช่วงสแกน ${start}–${end} น.` : "";
}

// Stable, collision-free key for filenames: two sessions can share a date.
export function roundSessionFileKey(session) {
  const start = bangkokHM(session?.starts_at).replace(":", "");
  return start ? `${session.meeting_date}-${start}` : String(session?.meeting_date || "");
}

// "" when the scan window and the optional activity time are consistent.
export function validateRoundTimes({ start, end, activityStart = "", activityEnd = "" }) {
  if (!start || !end) return "กรุณากรอกเวลาเริ่มและสิ้นสุดสแกน";
  if (end <= start) return "เวลาสิ้นสุดสแกนต้องหลังเวลาเริ่มสแกน";
  if (Boolean(activityStart) !== Boolean(activityEnd)) return "เวลาจัดกิจกรรมต้องกรอกทั้งเวลาเริ่มและสิ้นสุด หรือเว้นว่างทั้งคู่";
  if (activityStart && activityEnd <= activityStart) return "เวลาสิ้นสุดกิจกรรมต้องหลังเวลาเริ่ม";
  return "";
}

// Thai text for the errors Postgres raises from the round RPCs.
export function roundScheduleErrorMessage(error) {
  const message = String(error?.message || "");
  if (/overlaps/i.test(message)) return "ช่วงเวลาสแกนซ้อนกับรอบอื่นที่ยังเปิดอยู่ กรุณาเลือกเวลาอื่น หรือยกเลิกรอบเดิมก่อน";
  if (/already has attendance/i.test(message)) return "ยกเลิกไม่ได้ เพราะรอบนี้มีผู้เช็กชื่อแล้ว ใช้ \"ปิดรอบ\" แทน";
  if (/Activity end time must be after start time|Activity start and end/i.test(message)) return "เวลาสิ้นสุดกิจกรรมต้องหลังเวลาเริ่ม และต้องกรอกทั้งสองช่อง";
  if (/End time must be after start time/i.test(message)) return "เวลาสิ้นสุดสแกนต้องหลังเวลาเริ่มสแกน";
  if (/not found or already cancelled/i.test(message)) return "ไม่พบรอบนี้ หรือถูกยกเลิกไปแล้ว";
  if (/has not closed yet can be edited/i.test(message)) return "แก้ไขไม่ได้ เพราะรอบนี้ถูกปิดหรือยกเลิกแล้ว";
  return message;
}

// Attendance QR links look like /attendance/<uuid>.
export function parseRoundToken(pathname) {
  return String(pathname || "").match(/^\/attendance\/([0-9a-f-]{36})\/?$/i)?.[1] || "";
}

export function roundCheckInErrorMessage(error) {
  const message = String(error?.message || "");
  if (/expired or is invalid/i.test(message)) return "QR หมดอายุหรือไม่ถูกต้อง กรุณาสแกน QR ที่แสดงอยู่ตอนนี้อีกครั้ง";
  if (/Active Resident or Staff account required/i.test(message)) return "บัญชีนี้ไม่ใช่ Resident หรือ Staff ที่เปิดใช้งาน จึงเช็กชื่อไม่ได้";
  return message || "เช็กชื่อไม่สำเร็จ กรุณาสแกน QR ปัจจุบันอีกครั้ง";
}
