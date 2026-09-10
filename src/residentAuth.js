export const residentRoles = ["resident", "staff", "admin"];

export const residentRoleLabels = {
  resident: "Resident",
  staff: "Staff",
  admin: "Admin",
};

export const residentSessionClockErrorMessage = "เซสชันเดิมมีข้อมูลเวลาไม่สอดคล้อง ระบบล้างเซสชันเฉพาะอุปกรณ์นี้แล้ว กรุณาตั้งวันที่และเวลาเป็นอัตโนมัติ แล้วเข้าสู่ระบบใหม่";

export function isJwtIssuedInFutureError(error) {
  return /jwt\s+issued\s+at\s+future/i.test(String(error?.message || error || ""));
}

export function normalizeResidentEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function passwordResetRedirect(appUrl) {
  return new URL("/reset-password", appUrl).toString();
}

export function hasPasswordRecoveryLink(location) {
  const queryType = new URLSearchParams(location.search || "").get("type");
  const hashType = new URLSearchParams((location.hash || "").replace(/^#/, "")).get("type");
  return [queryType, hashType].some((type) => type === "invite" || type === "recovery");
}

export function isPasswordSetupRoute(location) {
  return location.pathname === "/reset-password" || hasPasswordRecoveryLink(location);
}

export function shouldLoadResidentWorkspace(location) {
  return !isPasswordSetupRoute(location);
}
