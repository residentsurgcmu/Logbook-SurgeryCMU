export const residentRoles = ["resident", "staff", "admin"];

export const residentRoleLabels = {
  resident: "Resident",
  staff: "Staff",
  admin: "Admin",
};

export const residentSessionClockErrorMessage = "ระบบยืนยันตัวตนกับฐานข้อมูลตรวจเวลาไม่ตรงกันชั่วคราว กรุณารอสักครู่แล้วกดตรวจสอบเซสชันอีกครั้ง หากยังเกิดซ้ำ กรุณาแจ้ง Admin";

export function isJwtIssuedInFutureError(error) {
  return /jwt\s+issued\s+at\s+future/i.test(String(error?.message || error || ""));
}

export function residentSessionClockError() {
  const error = new Error(residentSessionClockErrorMessage);
  error.code = "RESIDENT_SESSION_CLOCK_SKEW";
  return error;
}

export async function retryResidentClockSkew(operation, { delays = [1000, 2000, 3000], wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isJwtIssuedInFutureError(error)) throw error;
      if (attempt === delays.length) throw residentSessionClockError();
      await wait(delays[attempt]);
    }
  }
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
