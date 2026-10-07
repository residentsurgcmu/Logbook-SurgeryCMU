// Pure helpers shared by the Admin panels and the Excel builder.
export const EPA_CODES = ["EPA-1", "EPA-2", "EPA-3", "EPA-4", "EPA-5", "EPA-6", "EPA-7-L1-L2", "EPA-7-L3", "EPA-8"];
export const PBA_CODES = Array.from({ length: 21 }, (_, i) => `PBA-${String(i + 1).padStart(2, "0")}`);
export const PROGRESS_WARNING = "ไฟล์นี้มีข้อมูลรายบุคคลของ Resident ใช้ภายในภาควิชาเท่านั้น ห้ามส่งต่อในกลุ่มสาธารณะ";

export function adminAttemptError(error) {
  const message = typeof error === "string" ? error : error?.message || "";
  const errors = [
    ["Active Admin account required", "ไม่มีสิทธิ์ใช้หน้านี้"],
    ["A reason of 5-500 characters is required", "กรุณาระบุเหตุผล 5–500 ตัวอักษร"],
    ["Resident is inactive or unavailable", "Resident นี้ไม่ได้ใช้งานหรือไม่พบในระบบ กรุณาโหลดข้อมูลใหม่"],
    ["This form has no attempt limit to extend", "แบบประเมินนี้ไม่จำกัดจำนวนครั้ง จึงไม่ต้องเพิ่มครั้ง"],
  ];
  return errors.find(([source]) => message.includes(source))?.[1] || "ดำเนินการไม่สำเร็จ กรุณาลองใหม่ หากยังไม่ได้ให้แจ้งผู้พัฒนา";
}

export function bangkokProgressTime(at) {
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
  }).format(new Date(at));
}

export function progressFileName(at) {
  const parts = new Intl.DateTimeFormat("en-GB-u-ca-gregory", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok",
  }).formatToParts(new Date(at));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `Resident_Corner_progress_${get("year")}-${get("month")}-${get("day")}.xlsx`;
}

export function progressResidents(rows) {
  const residents = new Map();
  for (const row of rows) {
    if (!residents.has(row.resident_id)) residents.set(row.resident_id, {
      id: row.resident_id, name: row.resident_name, pgy: row.resident_pgy,
    });
  }
  return [...residents.values()].sort((a, b) => a.name.localeCompare(b.name, "th") || a.id.localeCompare(b.id));
}
