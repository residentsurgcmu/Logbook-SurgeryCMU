import { CASE_MIN_ADMIT_DATE } from "./residentCases.js";
import { shiftIsoDate } from "./roundSchedule.js";

export function admissionWeek(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const from = shiftIsoDate(date, -((weekday + 2) % 7));
  return { from, to: shiftIsoDate(from, 6) };
}

export function archiveRange(currentFrom, weeks) {
  return {
    from: weeks ? [shiftIsoDate(currentFrom, -7 * weeks), CASE_MIN_ADMIT_DATE].sort().at(-1) : CASE_MIN_ADMIT_DATE,
    to: shiftIsoDate(currentFrom, -1),
  };
}

export function groupAdmissionWeeks(rows) {
  const weeks = new Map();
  for (const row of rows) {
    const range = admissionWeek(row.admit_date);
    const group = weeks.get(range.from) ?? { ...range, rows: [] };
    group.rows.push(row);
    weeks.set(range.from, group);
  }
  return [...weeks.values()].sort((a, b) => b.from.localeCompare(a.from));
}

export function caseMatchesSearch(row, needle, ownerName) {
  return [row.diagnosis, row.case_code, ownerName].some((value) => String(value ?? "").toLowerCase().includes(needle));
}
