export const residentRoles = ["resident", "staff", "admin"];

export const residentRoleLabels = {
  resident: "Resident",
  staff: "Staff",
  admin: "Admin",
};

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
