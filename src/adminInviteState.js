export function inviteState(row) {
  if (!row) return { key: "unknown", label: "ไม่ทราบสถานะ", resend: false };
  if (row.activated_at) return { key: "activated", label: "เปิดใช้งานแล้ว", resend: false };
  if (row.mail_status === "rate_limited") return { key: "failed", label: "ส่งล่าสุดไม่สำเร็จ · ถึงขีดจำกัด", resend: true };
  if (row.mail_status === "failed") return { key: "failed", label: "ส่งล่าสุดไม่สำเร็จ", resend: true };
  if (["sending", "unknown"].includes(row.mail_status)) return { key: "unknown", label: "ยังไม่ยืนยันผลการส่งล่าสุด", resend: true };
  if (row.sent_at) return { key: "sent", label: "ส่งคำเชิญแล้ว", resend: true };
  if (row.prior_auth_sign_in) return { key: "unknown", label: "ยังไม่ยืนยันการเข้าใช้งาน", resend: true };
  return { key: "pending", label: "ไม่มีประวัติการส่งคำเชิญ", resend: true };
}

export function accountProvisionMessage(result) {
  if (result.invitationSent) return "ส่งคำเชิญเปิดบัญชีแล้ว";
  if (result.linkedExistingAccount) {
    if (result.setupMailStatus === "sent") return "ผูกบัญชีเดิมแล้ว และส่งลิงก์ตั้งรหัสผ่านแล้ว";
    if (result.setupMailStatus === "rate_limited") return "ผูกบัญชีเดิมแล้ว แต่ส่งอีเมลไม่สำเร็จเพราะถึงขีดจำกัด กรุณารอแล้วกดส่งซ้ำจากรายชื่อบัญชี";
    if (result.setupMailStatus === "failed") return "ผูกบัญชีเดิมแล้ว แต่ส่งอีเมลไม่สำเร็จ กดส่งซ้ำได้จากรายชื่อบัญชี";
    return "ผูกบัญชีเดิมแล้ว แต่ยังยืนยันผลการส่งอีเมลไม่ได้ กรุณาตรวจในรายชื่อบัญชี";
  }
  return result.alreadyProvisioned ? "บัญชี Staff พร้อมใช้งานตามสิทธิ์เดิม" : "บันทึกสิทธิ์บัญชีแล้ว";
}
