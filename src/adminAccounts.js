// Account UI rules only. Authorization, locks and side effects stay in the reviewed RPCs.
const length = (value) => Array.from(value || "").length;
export const ACCOUNT_ROLE_LABELS = { resident: "Resident", staff: "Staff", admin: "Admin" };
const messages = {
  ACCOUNT_CONFLICT: "ข้อมูลบัญชีถูกเปลี่ยนจากที่อื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง",
  PREVIEW_CHANGED: "จำนวนคำขอหรืองานมอบหมายเปลี่ยนแล้ว กรุณาตรวจผลกระทบล่าสุดก่อนยืนยันใหม่",
  ACCOUNT_EXISTS: "อีเมลนี้มีบัญชีอยู่แล้ว ระบบไม่ได้เขียนทับบัญชีเดิม",
  LAST_ADMIN: "ปิด Admin คนสุดท้ายไม่ได้ ต้องมี Admin ที่ใช้งานอย่างน้อยหนึ่งบัญชี",
  SELF_ACTION_FORBIDDEN: "ปิดหรือเปิดบัญชีที่คุณกำลังใช้งานเองไม่ได้ กรุณาให้ Admin คนอื่นดำเนินการ",
  ROLE_RULE: "ข้อมูลที่แก้ไขไม่ตรงกับบทบาทหรือรายชื่อ Staff กรุณาโหลดข้อมูลล่าสุด",
  ACCOUNTS_PAUSED: "ระบบบัญชีพักชั่วคราวระหว่างปรับปรุง กรุณาลองใหม่ภายหลัง",
  ACCOUNT_WRITE_REFUSED: "ระบบปฏิเสธการเขียนข้อมูลบัญชี กรุณาแจ้งผู้ดูแลระบบ",
};
export function accountErrorCode(error) {
  const text = typeof error === "string" ? error : `${error?.code || ""} ${error?.message || ""}`;
  return Object.keys(messages).find((code) => new RegExp(`\\b${code}\\b`).test(text)) || "";
}
export function accountErrorMessage(error) {
  const code = accountErrorCode(error);
  if (code) return messages[code];
  const text = typeof error === "string" ? error : error?.message || "";
  if (/Active Admin|Admin role required|JWT|session expired/i.test(text)) return "ไม่มีสิทธิ์ใช้งานหรือเซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
  if (/Account was not found/i.test(text)) return "ไม่พบบัญชีนี้ กรุณาโหลดรายชื่อใหม่";
  return "ตรวจสอบผลไม่สำเร็จ กรุณาลองใหม่ หรือตรวจข้อมูลล่าสุดก่อนดำเนินการต่อ";
}
export function accountDraft(account) {
  return { full_name: account.full_name || "", pgy: account.pgy == null ? "" : String(account.pgy), unit_name: account.unit_name || "", admin_tag: account.admin_tag || "", reason: "" };
}
export function accountEditPlan(account, draft) {
  const changes = {};
  const errors = {};
  const name = draft.full_name.trim();
  if (length(name) < 2 || length(name) > 160) errors.full_name = "กรุณากรอกชื่อ 2–160 ตัวอักษร";
  if (name !== account.full_name) changes.full_name = name;
  if (account.role === "resident" && (account.pgy == null ? "" : String(account.pgy)) !== String(draft.pgy)) {
    if (!/^[1-4]$/.test(String(draft.pgy))) errors.pgy = "กรุณาเลือก PGY 1–4";
    else changes.pgy = Number(draft.pgy);
  }
  if (account.role === "staff" && draft.unit_name.trim() !== (account.unit_name || "")) {
    const unit = draft.unit_name.trim();
    if (length(unit) < 2 || length(unit) > 80) errors.unit_name = "กรุณากรอกชื่อหน่วย 2–80 ตัวอักษร";
    else changes.unit_name = unit;
  }
  if (account.role === "admin" && draft.admin_tag.trim() !== (account.admin_tag || "")) {
    if (length(draft.admin_tag.trim()) > 40) errors.admin_tag = "ป้าย Admin ต้องไม่เกิน 40 ตัวอักษร";
    else changes.admin_tag = draft.admin_tag.trim() || null;
  }
  const reason = draft.reason.trim();
  if (Object.hasOwn(changes, "pgy") && !reason) errors.reason = "กรุณาระบุเหตุผลที่เปลี่ยน PGY";
  if (length(reason) > 300) errors.reason = "เหตุผลต้องไม่เกิน 300 ตัวอักษร";
  return { changes, reason: reason || null, errors, changed: Object.keys(changes).length > 0, valid: Object.keys(errors).length === 0 };
}
export function accountStatusReason(reason) {
  const trimmed = reason.trim();
  return !trimmed ? "กรุณาระบุเหตุผลก่อนยืนยัน" : length(trimmed) > 300 ? "เหตุผลต้องไม่เกิน 300 ตัวอักษร" : "";
}
export function accountPreviewValid(preview, userId, action) {
  const count = (n) => Number.isInteger(n) && n >= 0;
  return Boolean(preview && preview.user_id === userId && preview.action === action &&
    typeof preview.active === "boolean" && typeof preview.updated_at === "string" &&
    !Number.isNaN(Date.parse(preview.updated_at)) && Array.isArray(preview.blockers) &&
    preview.blockers.every((code) => typeof code === "string") &&
    (action !== "deactivate" || (preview.active === true &&
      count(preview.preview_counts?.pending_requests) && count(preview.preview_counts?.active_assignments) &&
      preview.pending_requests === preview.preview_counts.pending_requests &&
      preview.active_assignments === preview.preview_counts.active_assignments)) &&
    (action !== "reactivate" || preview.active === false));
}
export function prepareAccountAttempt(previous, kind, payload, createId = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify([kind, payload]);
  return previous?.fingerprint === fingerprint ? previous : { kind, payload, fingerprint, requestId: createId() };
}
export function accountEventSummary(event) {
  const labels = { full_name: "ชื่อ", pgy: "PGY", unit_name: "หน่วย", admin_tag: "ป้าย Admin", active: "สถานะ" };
  const action = { "account.updated": "แก้ไขข้อมูล", "account.deactivated": "ปิดใช้งาน", "account.reactivated": "เปิดใช้งาน" }[event.action] || "เปลี่ยนข้อมูลบัญชี";
  const fields = Object.keys(event.changes || {}).filter((key) => labels[key]).map((key) => labels[key]);
  return fields.length ? `${action} · ${fields.join(", ")}` : action;
}
