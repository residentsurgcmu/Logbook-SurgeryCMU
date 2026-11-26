// Personal display filter. A first click is a single day; the second picks an inclusive range.
export function pickConferenceDay({ start, end }, day) {
  if (!start || end) return { start: day, end: "" };
  return day < start ? { start: day, end: start } : { start, end: day };
}

export const includesConferenceDay = ({ start, end }, day) =>
  !start || Boolean(day && day >= start && day <= (end || start));
