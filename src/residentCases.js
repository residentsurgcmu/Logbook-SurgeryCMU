// Pure helpers for New admissions + Friday conference (kept separate for tests).
import { bangkokIsoDate, shiftIsoDate } from "./roundSchedule.js";

export const CASE_UNITS = ["Upper GI", "Colorectal", "HPB", "B&E", "Vascular"];
export const CASE_SEXES = [["male", "ชาย"], ["female", "หญิง"], ["unspecified", "ไม่ระบุ"]];
export const CASE_STATUSES = [["admit", "Admit"], ["discharged", "Discharged"], ["pending_update", "รออัปเดต"]];
export const CASE_LIMITS = { diagnosis: 180, management: 1000, operation: 180, caption: 200, note: 2000, presentIllness: 2000, physicalExam: 2000 };
// Same ranges as the CHECK constraints in 20261003090000_resident_case_clinical_fields.sql.
export const CASE_VITALS = [
  { key: "bp_systolic", label: "BP systolic", unit: "mmHg", min: 40, max: 300 },
  { key: "bp_diastolic", label: "BP diastolic", unit: "mmHg", min: 20, max: 200 },
  { key: "heart_rate", label: "HR", unit: "/min", min: 20, max: 250 },
  { key: "resp_rate", label: "RR", unit: "/min", min: 4, max: 80 },
  { key: "body_temp", label: "BT", unit: "°C", min: 30, max: 45, decimals: 1 },
  { key: "spo2", label: "SpO2", unit: "%", min: 50, max: 100 },
];
const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== "";

function vitalError({ label, unit, min, max, decimals = 0 }, value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text) || Number(text) < min || Number(text) > max) return `${label} ต้องอยู่ระหว่าง ${min}–${max} ${unit}`;
  const places = (text.split(".")[1] || "").length;
  if (!decimals && places) return `${label} ต้องเป็นจำนวนเต็ม`;
  if (places > decimals) return `${label} ใส่ได้ไม่เกินทศนิยม ${decimals} ตำแหน่ง`;
  return "";
}

export function formatVitals(row = {}) {
  const parts = [];
  if (hasValue(row.bp_systolic) && hasValue(row.bp_diastolic)) parts.push(`BP ${row.bp_systolic}/${row.bp_diastolic} mmHg`);
  if (hasValue(row.heart_rate)) parts.push(`HR ${row.heart_rate}/min`);
  if (hasValue(row.resp_rate)) parts.push(`RR ${row.resp_rate}/min`);
  if (hasValue(row.body_temp)) parts.push(`BT ${Number(row.body_temp).toFixed(1)} °C`);
  if (hasValue(row.spo2)) parts.push(`SpO2 ${row.spo2}%`);
  return parts.join(" · ");
}
export const CASE_IMAGE_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Phone photos are often larger than 5 MB; they are re-encoded before upload,
// and the stored result must still be <= CASE_IMAGE_MAX_BYTES.
export const CASE_IMAGE_INPUT_MAX_BYTES = 20 * 1024 * 1024;
export const CASE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CASE_IMAGE_MAX_EDGE = 2000;
export const CASE_IMAGE_QUALITY = 0.85;
export const CASE_MIN_ADMIT_DATE = "2020-01-01";
export const CASE_IMAGE_MAX_PER_SAVE = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const labelOf = (pairs, value) => pairs.find(([key]) => key === value)?.[1] || value || "—";
export const caseSexLabel = (value) => labelOf(CASE_SEXES, value);
export const caseStatusLabel = (value) => labelOf(CASE_STATUSES, value);

// Returns "" when the form is acceptable, otherwise a Thai message.
export function validateCaseForm(form, at = new Date()) {
  const date = String(form.admit_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "กรุณาเลือกวันที่รับ";
  const year = Number(date.slice(0, 4));
  if (year > 2400) return `ปีที่ใส่ (${year}) น่าจะเป็นปี พ.ศ. กรุณาใส่ปี ค.ศ. เช่น ${year - 543}`;
  if (date < CASE_MIN_ADMIT_DATE) return "วันที่รับต้องไม่เก่ากว่า 1 ม.ค. 2020";
  if (date > bangkokIsoDate(at)) return "วันที่รับต้องไม่เกินวันนี้";
  const age = Number(form.age_years);
  if (String(form.age_years ?? "").trim() === "" || !Number.isInteger(age) || age < 0 || age > 120) return "อายุต้องเป็นจำนวนเต็ม 0–120 ปี";
  if (!CASE_SEXES.some(([key]) => key === form.sex)) return "กรุณาเลือกเพศ";
  const diagnosis = String(form.diagnosis || "").trim();
  if (!diagnosis) return "กรุณาระบุ Diagnosis";
  if (diagnosis.length > CASE_LIMITS.diagnosis) return `Diagnosis ต้องไม่เกิน ${CASE_LIMITS.diagnosis} ตัวอักษร`;
  if (String(form.management || "").length > CASE_LIMITS.management) return `Management ต้องไม่เกิน ${CASE_LIMITS.management} ตัวอักษร`;
  if (String(form.operation || "").length > CASE_LIMITS.operation) return `Operation ต้องไม่เกิน ${CASE_LIMITS.operation} ตัวอักษร`;
  if (String(form.present_illness || "").length > CASE_LIMITS.presentIllness) return `Present illness ต้องไม่เกิน ${CASE_LIMITS.presentIllness} ตัวอักษร`;
  if (String(form.physical_exam || "").length > CASE_LIMITS.physicalExam) return `Physical examination ต้องไม่เกิน ${CASE_LIMITS.physicalExam} ตัวอักษร`;
  for (const vital of CASE_VITALS) {
    if (hasValue(form[vital.key])) {
      const problem = vitalError(vital, form[vital.key]);
      if (problem) return problem;
    }
  }
  if (hasValue(form.bp_systolic) !== hasValue(form.bp_diastolic)) return "กรุณากรอก BP ให้ครบทั้งสองค่า (systolic/diastolic)";
  if (hasValue(form.bp_systolic) && Number(form.bp_diastolic) >= Number(form.bp_systolic)) return "BP diastolic ต้องน้อยกว่า systolic";
  if (!CASE_UNITS.includes(form.unit_name)) return "กรุณาเลือกหน่วย";
  if (!CASE_STATUSES.some(([key]) => key === form.status)) return "กรุณาเลือกสถานะ";
  if (!form.owner_id) return "กรุณาเลือก Owner (Resident)";
  return "";
}

// UI gating only; the RPCs enforce the same rules on the server.
export function canEditCase(user, row) {
  if (!user || !row || row.deleted_at) return false;
  if (user.role === "staff" || user.role === "admin") return true;
  return user.role === "resident" && (row.created_by === user.id || row.owner_id === user.id);
}
export function canDeleteCase(user, row) {
  if (!user || !row || row.deleted_at) return false;
  return user.role === "admin" || (user.role === "resident" && row.created_by === user.id);
}
export const canDeleteMedia = (user, media) => Boolean(user && media) && (user.role === "admin" || media.created_by === user.id);
export const canEditNote = (user, note) => Boolean(user && note) && note.author_id === user.id;
export const canDeleteNote = (user, note) => Boolean(user && note) && (user.role === "admin" || note.author_id === user.id);

// Monday..Friday of the week containing `iso`. Saturday maps to the same week,
// Sunday to the week that just ended (never an empty future week).
export function conferenceWeek(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  const day = new Date(ms).getUTCDay(); // 0 = Sunday
  const start = shiftIsoDate(iso, day === 0 ? -6 : 1 - day);
  return { start, end: shiftIsoDate(start, 4) };
}

// Friday conference window: everything admitted since the previous Friday
// conference (Saturday..Friday), so weekend admissions are never skipped.
export function conferenceWindow(weekStart) {
  return { from: shiftIsoDate(weekStart, -2), to: shiftIsoDate(weekStart, 4) };
}

// The conference week whose window contains this admission date: Saturday and
// Sunday admissions are presented at the following Friday conference.
export function conferenceWeekForCase(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  const day = new Date(ms).getUTCDay();
  return conferenceWeek(shiftIsoDate(iso, day === 6 ? 2 : day === 0 ? 1 : 0));
}

export function caseImagePath(caseId, fileId = crypto.randomUUID()) {
  if (!UUID.test(String(caseId || ""))) throw new Error("ไม่พบรหัสเคส");
  return `${String(caseId).toLowerCase()}/${fileId}.jpg`;
}

export function validateCaseImageFile(file) {
  if (!file) return "กรุณาเลือกภาพ";
  if (!CASE_IMAGE_INPUT_TYPES.includes(file.type)) return "รองรับเฉพาะภาพ JPEG, PNG หรือ WebP";
  if (!file.size) return "ไฟล์ภาพว่างเปล่า";
  if (file.size > CASE_IMAGE_INPUT_MAX_BYTES) return "ภาพต้องมีขนาดไม่เกิน 20 MB (ระบบจะย่อให้ไม่เกิน 5 MB ก่อนอัปโหลด)";
  return "";
}

// Splits a FileList into files to upload and Thai messages for the rest,
// numbered by position (file names are never echoed back).
export function splitCaseImageFiles(files, alreadyCount = 0) {
  const accepted = [];
  const rejected = [];
  [...(files || [])].forEach((file, index) => {
    const position = index + 1;
    const problem = validateCaseImageFile(file)
      || (alreadyCount + accepted.length >= CASE_IMAGE_MAX_PER_SAVE ? `เลือกได้ไม่เกิน ${CASE_IMAGE_MAX_PER_SAVE} ภาพต่อครั้ง` : "");
    if (problem) rejected.push({ position, message: `ภาพที่ ${position}: ${problem}` });
    else accepted.push(file);
  });
  return { accepted, rejected };
}

export function scaledSize(width, height, maxEdge = CASE_IMAGE_MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

export const isCaseConflict = (error) => /CASE_CONFLICT/.test(String(error?.message || error || ""));

export function caseErrorMessage(error) {
  const text = String(error?.message || error || "");
  if (isCaseConflict(error)) return "มีผู้อื่นแก้เคสนี้ไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่";
  if (/cannot (edit|delete|change)/i.test(text)) return "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้";
  if (/Owner must be an active Resident/i.test(text)) return "Owner ต้องเป็น Resident ที่ยังใช้งานอยู่";
  if (/not found/i.test(text)) return "ไม่พบเคสหรือรายการนี้ อาจถูกลบไปแล้ว";
  return text || "ทำรายการไม่สำเร็จ";
}
