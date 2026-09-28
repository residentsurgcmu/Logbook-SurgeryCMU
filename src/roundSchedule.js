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

// "upcoming" | "live" | "ended" based on the session's scan window.
export function roundSessionStatus(session, nowMs = Date.now()) {
  const starts = new Date(session.starts_at).getTime();
  const ends = new Date(session.ends_at).getTime();
  if (nowMs > ends) return "ended";
  if (nowMs < starts) return "upcoming";
  return "live";
}
