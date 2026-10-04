// Outside pages shown inside "ตารางเวร / OR". Addresses live in the database (set by an Admin), never in the code.
export const EMBED_LINKS = [
  { key: "or_schedule", label: "ตารางห้องผ่าตัด (OR)", defaultTitle: "ตารางห้องผ่าตัด (OR)" },
  { key: "rota", label: "Surgical Rotation Manager", defaultTitle: "Surgical Rotation Manager" },
];

// Same rule as the database check: https only, a real port (1-65535) if any, no spaces, no user:password@ part, at most 500 characters.
const ADDRESS = /^https:\/\/[A-Za-z0-9.-]+(:([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?(\/[^\s@]*)?$/;
export const embedAddressProblem = (value) => {
  const text = String(value || "").trim();
  if (!text) return "กรุณาใส่ที่อยู่";
  if (text.length > 500 || !ADDRESS.test(text)) return "ที่อยู่ต้องขึ้นต้นด้วย https:// และต้องไม่มีช่องว่างหรือเครื่องหมาย @";
  return "";
};
export const embedHost = (value) => { try { return new URL(value).hostname; } catch { return ""; } };

export function embedErrorMessage(error) {
  const text = String(error?.message || error || "");
  if (/Admin account required/i.test(text)) return "เฉพาะ Admin ตั้งค่าที่อยู่ได้";
  if (/Address must start/i.test(text)) return "ที่อยู่ต้องขึ้นต้นด้วย https:// และต้องไม่มีช่องว่างหรือเครื่องหมาย @";
  if (/Title must be/i.test(text)) return "ชื่อต้องยาว 2-80 ตัวอักษร";
  return text || "ทำรายการไม่สำเร็จ";
}
