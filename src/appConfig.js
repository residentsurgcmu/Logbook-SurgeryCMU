const configuredAppUrl = import.meta.env.VITE_APP_URL?.trim();

export const appUrl = (configuredAppUrl || window.location.origin).replace(/\/+$/, "");
export const defaultAcademicYear = 2569;
export const defaultStartingClassYear = 5;
