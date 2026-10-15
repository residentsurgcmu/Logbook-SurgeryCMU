// Pure logic for the seat map: no React, no network. Every rule the screens apply is computed here so `node --test` can check it.
export const SEAT_POLL_MS = 8000;
export const HOLD_SECONDS = 60;
export const URGENT_REASONS = ["ผ่าตัด", "ผู้ป่วยฉุกเฉิน", "อยู่เวร", "อื่น ๆ"];
export const URGENT_NOTE_MAX = 160;
export const CORRECTION_NOTE_MAX = 200;
export const ENDED_NOTE = "การคืนที่นั่งไม่ใช่หลักฐานว่าอยู่จนจบ";
export const ZONE_INFO = [
  { zone: "L", name: "โซนซ้าย", hint: "แนะนำ PGY 1–2" },
  { zone: "C", name: "โต๊ะกลาง", hint: "แนะนำ PGY 4" },
  { zone: "R", name: "โซนขวา", hint: "แนะนำ PGY 3" },
];
export const MODERATOR_ZONE = { zone: "M", name: "Moderator", hint: "ที่นั่ง 1–2 ที่ (ไม่ต้องเต็ม)" };
export const STATUS_LABELS = {
  seat: "นั่งที่นั่งแล้ว",
  reserve: "ที่นั่งเสริม",
  staff: "อาจารย์ในห้อง",
  room: "ในห้อง · ยังไม่มีที่นั่ง",
  urgent: "ภารกิจจำเป็น",
  absent: "ยังไม่เข้าร่วม",
};
const PRESENT = new Set(["seat", "reserve", "staff", "room"]);

const ERROR_MESSAGES = [
  [/Scan the room QR|Check in with the room QR first/i, "ต้องสแกน QR ที่ห้องประชุมก่อน"],
  [/Seat is not available/i, "ที่นั่งไม่พร้อม กรุณาเลือกอีกครั้ง"],
  [/Seat hold expired/i, "หมดเวลาถือที่นั่ง กรุณาเลือกใหม่"],
  [/Seat does not exist/i, "ไม่พบที่นั่งนี้ในผังห้อง"],
  [/Seat map is closed/i, "ปิดการเลือกที่นั่งแล้ว"],
  [/not open for this session/i, "รอบนี้ไม่ได้เปิดผังที่นั่ง"],
  [/You do not have a seat/i, "คุณยังไม่มีที่นั่ง"],
  [/Already in the reserve area/i, "คุณอยู่ที่นั่งเสริมแล้ว"],
  [/Reason is not valid/i, "กรุณาเลือกเหตุผลจากรายการ"],
  [/Note is too long/i, "ข้อความยาวเกินกำหนด"],
  [/identify a patient/i, "กรุณาลบ HN หรือเลขยาวที่อาจระบุตัวผู้ป่วย"],
  [/already reported urgent/i, "คุณแจ้งภารกิจจำเป็นของรอบนี้ไปแล้ว"],
  [/correction request waiting/i, "คุณมีคำขอแก้ไขที่รอตรวจอยู่แล้ว"],
  [/Describe what should be corrected/i, "กรุณาบอกว่าต้องการแก้ไขอะไร"],
  [/Resident or Staff account required/i, "ใช้ได้เฉพาะบัญชี Resident หรืออาจารย์ที่เปิดใช้งาน"],
  [/Active Resident account required/i, "ใช้ได้เฉพาะบัญชี Resident ที่เปิดใช้งาน"],
  [/Active Staff account required/i, "ใช้ได้เฉพาะบัญชีอาจารย์ที่เปิดใช้งาน"],
  [/Active Admin account required/i, "ใช้ได้เฉพาะ Admin"],
  [/cannot review your own request/i, "คุณตรวจคำขอของตัวเองไม่ได้"],
  [/Staff who checked in, or Admin/i, "ต้องเป็นอาจารย์ที่เช็คชื่อเข้าห้องแล้ว หรือ Admin"],
  [/has not scanned/i, "Resident คนนี้ยังไม่ได้สแกน QR ให้เขาส่งคำขอแก้ไขข้อมูล"],
  [/This Resident has no seat/i, "Resident คนนี้ไม่มีที่นั่ง"],
  [/Resident not found/i, "ไม่พบ Resident คนนี้"],
  [/Layout cannot change/i, "เปลี่ยนผังไม่ได้ เพราะเริ่มมีคนนั่งแล้ว"],
  [/inside the session window/i, "เวลา \"ตรงเวลา\" ต้องอยู่ในช่วงเวลาของรอบนี้"],
  [/Layout not found/i, "ไม่พบผังห้องที่เลือก"],
  [/Decision must be/i, "กรุณาเลือกอนุมัติหรือไม่อนุมัติ"],
  [/not found or already reviewed/i, "ไม่พบคำขอ หรือตรวจไปแล้ว"],
  [/Session not found/i, "ไม่พบรอบนี้ หรือรอบถูกยกเลิกหรือปิดแล้ว"],
  [/Active account required/i, "กรุณาเข้าสู่ระบบอีกครั้ง"],
];

export function seatErrorMessage(error) {
  const message = String(error?.message || error || "");
  for (const [pattern, text] of ERROR_MESSAGES) if (pattern.test(message)) return text;
  return "ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง";
}

export function statusLabel(status, ended = false) {
  if (ended && PRESENT.has(status)) return "เคยเข้าร่วม · จบประชุม";
  return STATUS_LABELS[status] || "—";
}

export function seatsByZone(seats = []) {
  const groups = { M: [], L: [], C: [], R: [] };
  for (const seat of seats) (groups[seat.zone] || (groups[seat.zone] = [])).push(seat);
  for (const list of Object.values(groups)) list.sort((a, b) => a.row_no - b.row_no || a.col_no - b.col_no);
  return groups;
}

export const zoneColumns = (zoneSeats) => Math.max(1, ...zoneSeats.map((seat) => seat.col_no));

// State is always carried by a symbol and a label as well as by colour (tokens.css: never colour alone).
export function seatCell(seat, map) {
  const me = map?.me;
  if (seat.occupant) {
    return seat.occupant.user_id === me?.user_id
      ? { state: "mine", symbol: "★", label: "ที่นั่งของคุณ" }
      : { state: "taken", symbol: "●", label: "มีผู้นั่งแล้ว" };
  }
  if (seat.held) {
    return me?.hold?.seat_code === seat.seat_code
      ? { state: "myhold", symbol: "…", label: "คุณกำลังถือที่นี่" }
      : { state: "held", symbol: "…", label: "กำลังยืนยัน" };
  }
  return { state: "free", symbol: "", label: "ว่าง" };
}

export const seatAriaLabel = (seat, cell) => `ที่นั่ง ${seat.seat_code} ${cell.label}${seat.occupant ? ` · ${seat.occupant.name}` : ""}`;

export const canPickSeat = (map) => Boolean(map && map.me.role === "resident" && map.me.in_room && map.session.open && !map.session.ended);

export const canManageSeats = (map) => Boolean(map && map.session.open && !map.session.ended
  && (map.me.role === "admin" || (map.me.role === "staff" && map.me.in_room)));

// Staff (not Admin) decide urgent-duty reports and correction requests (D7); nobody decides their own.
export const canReviewRequests = (map) => map?.me?.role === "staff";
export const isOwnRequest = (request, map) => request.user_id === map?.me?.user_id;

export function sessionPhase(map) {
  if (!map) return "loading";
  if (map.session.ended) return "ended";
  const { role, in_room: inRoom, seat, reserve } = map.me;
  if (role === "admin") return map.session.open ? "admin" : "not-open-yet";
  if (!map.session.open) return "not-open-yet";
  if (!inRoom) return "not-in-room";
  if (role === "staff") return "staff";
  if (seat) return "seated";
  return reserve ? "reserve" : "pick";
}

export const seatableResidents = (map) => (map?.people || [])
  .filter((person) => person.role === "resident" && ["room", "reserve", "seat"].includes(person.status))
  .sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));

export function filterPeople(people = [], query = "", status = "all") {
  const needle = String(query).trim().toLowerCase();
  return people.filter((person) => (status === "all" || person.status === status)
    && (!needle || String(person.name).toLowerCase().includes(needle)));
}

// Mirrors the database rule (private.resident_seat_text_ok): a run of 6+ digits, Latin or Thai, ignoring spaces, dots and hyphens.
export const hnHint = (text) => /[0-9๐-๙]{6,}/.test(String(text ?? "").replace(/[\s.-]/g, ""));

export const shouldPoll = ({ hidden, dialogOpen, ended }) => !hidden && !dialogOpen && !ended;

export function pickDefaultSession(sessions, nowMs = Date.now()) {
  if (!sessions?.length) return "";
  const at = (value) => Date.parse(value);
  const live = sessions.find((s) => nowMs >= at(s.starts_at) - 3600000 && nowMs <= at(s.effective_end));
  if (live) return live.session_id;
  const upcoming = sessions.filter((s) => at(s.starts_at) > nowMs).sort((a, b) => at(a.starts_at) - at(b.starts_at))[0];
  if (upcoming) return upcoming.session_id;
  return [...sessions].sort((a, b) => at(b.starts_at) - at(a.starts_at))[0].session_id;
}

// The server decides when a hold ends, so the countdown uses the server's clock.
export const serverOffsetMs = (map, fetchedAtMs) => Date.parse(map.session.now) - fetchedAtMs;
export const holdSecondsLeft = (expiresAt, offsetMs, nowMs = Date.now()) => Math.max(0, Math.ceil((Date.parse(expiresAt) - (nowMs + offsetMs)) / 1000));

export const bangkokHm = (iso) => iso
  ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))
  : "";

// "09:00" typed by an Admin, on the Bangkok calendar date of the session, as an ISO string with the +07:00 offset.
export function onTimeIso(startsAtIso, hhmm) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(startsAtIso));
  return `${date}T${hhmm}:00+07:00`;
}

export function eventText(event) {
  const seat = event?.seat_code || "";
  const from = event?.detail?.from || "";
  switch (event?.kind) {
    case "confirm": return `นั่งที่ ${seat}`;
    case "move": return `ย้ายจาก ${from} ไป ${seat}`;
    case "release": return `คืนที่นั่ง ${seat}`;
    case "reserve": return from ? `ย้ายไปที่นั่งเสริม (คืน ${from})` : "ใช้ที่นั่งเสริม";
    case "urgent": return "แจ้งภารกิจจำเป็น";
    case "correction": return "ส่งคำขอแก้ไขข้อมูล";
    case "staff_set": return from ? `อาจารย์ย้ายที่นั่งจาก ${from} เป็น ${seat}` : `อาจารย์จัดที่นั่ง ${seat} ให้`;
    case "staff_release": return `อาจารย์คืนที่นั่ง ${seat}`;
    case "review": return event?.detail?.decision === "approved" ? "อาจารย์อนุมัติคำขอของคุณ" : "อาจารย์ไม่อนุมัติคำขอของคุณ";
    default: return "—";
  }
}
