// "My space": every number on the Resident's own page is computed here, without React or the network,
// so it can be tested. Forms are counted with the same lists the Admin progress file uses.
import { EPA_BOARD_TOTAL, EPA_CODES, PBA_CODES, countBoardEpaMet } from "./adminProgress.js";
import { academicYearStart, bangkokDate, levelThreshold } from "./residentAssessmentRules.js";

export const EPA_BOARD_CODES = EPA_CODES.filter((code) => code !== "EPA-8");
export const PBA_TARGET = 16;
export const PBA_YEAR_TARGET = 4;
export const RECENT_LIMIT = 5;
export const STUCK_TEXT = "ติดต่อ Admin เพื่อพิจารณาเพิ่มครั้ง";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (value) => (!value ? "" : DATE_ONLY.test(value) ? value : bangkokDate(value));
const nextYearStart = (start) => `${Number(start.slice(0, 4)) + 1}-07-01`;
const inYear = (value, start) => {
  if (!value) return false;
  const day = dayOf(value);
  return day >= start && day < nextYearStart(start);
};
const dayNumber = (day) => {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 86400000;
};
const time = (value) => new Date(value).getTime() || 0;

export function buildMySpace({
  user = {},
  requests = [],
  assessments = [],
  templates = [],
  epaProgress = null,
  attendance = null,
  profiles = [],
  now = new Date(),
} = {}) {
  const start = academicYearStart(now);
  const today = bangkokDate(now);
  const templatesById = new Map(templates.map((template) => [template.id, template]));
  const templatesByCode = new Map(templates.map((template) => [template.template_code, template]));
  const names = new Map(profiles.map((person) => [person.id, person.name]));
  const nameOf = (id) => names.get(id) || "—";
  const mine = (row) => !user.id || row.resident_id === user.id;
  const formOf = (row) => {
    const template = row.resident_template_definitions || templatesById.get(row.template_id) || {};
    return { code: template.template_code || "—", title: template.title || "", type: template.template_type || "" };
  };
  const typeOf = (row) => {
    const { code, type } = formOf(row);
    if (type) return type;
    if (EPA_CODES.includes(code)) return "EPA";
    if (PBA_CODES.includes(code)) return "PBA";
    return "";
  };

  const pending = requests
    .filter((row) => mine(row) && row.status === "pending")
    .sort((a, b) => time(b.submitted_at) - time(a.submitted_at));
  const waitingEpa = pending.filter((row) => typeOf(row) === "EPA").length;
  const waitingPba = pending.filter((row) => typeOf(row) === "PBA").length;
  // Keep unclassified requests visible; the two typed counters must not silently lose them.
  const waitingUnknown = pending.length - waitingEpa - waitingPba;
  const waitingList = pending.map((row) => {
    const form = formOf(row);
    const submittedAt = dayOf(row.submitted_at);
    return {
      id: row.id,
      code: form.code,
      title: form.title,
      staffName: nameOf(row.staff_id),
      submittedAt,
      daysWaiting: submittedAt ? Math.max(0, dayNumber(today) - dayNumber(submittedAt)) : 0,
    };
  });

  const finished = assessments.filter(mine);
  const finishedEpaThisYear = finished.filter((row) => typeOf(row) === "EPA" && inYear(row.assessment_date, start));
  const recent = [...finished]
    .sort((a, b) => time(b.assessment_date) - time(a.assessment_date) || time(b.created_at) - time(a.created_at))
    .slice(0, RECENT_LIMIT)
    .map((row) => {
      const form = formOf(row);
      return { id: row.id, code: form.code, title: form.title, date: row.assessment_date, staffName: nameOf(row.evaluator_id) };
    });

  // PBA: a form is finished when at least one FINISHED assessment exists; a waiting request is not finished.
  const requestByAssessment = new Map(
    requests.filter((row) => mine(row) && row.status === "completed" && row.assessment_id).map((row) => [row.assessment_id, row]),
  );
  const pbaDone = new Set();
  const pbaDoneThisYear = new Set();
  for (const row of finished) {
    const { code } = formOf(row);
    if (!PBA_CODES.includes(code)) continue;
    pbaDone.add(code);
    // Same basis as the Admin progress file: a request-linked assessment counts in the year its request was sent
    // (the activity date may be earlier); a directly recorded one counts by its assessment date.
    if (inYear(requestByAssessment.get(row.id)?.submitted_at || row.assessment_date, start)) pbaDoneThisYear.add(code);
  }
  const waitingCodes = new Set(waitingList.map((item) => item.code));
  const pbaWaiting = new Set([...waitingCodes].filter((code) => PBA_CODES.includes(code)));
  const pbaForms = PBA_CODES.map((code) => ({
    code,
    title: templatesByCode.get(code)?.title || "",
    state: pbaDone.has(code) ? "finished" : pbaWaiting.has(code) ? "waiting" : "empty",
  }));

  // EPA "ถึงเกณฑ์" comes only from the database function (epaProgress); null or [] means it did not load.
  const epaAvailable = Array.isArray(epaProgress) && epaProgress.length > 0;
  const progressByCode = new Map((epaAvailable ? epaProgress : []).map((row) => [row.template_code, row]));
  const epaRows = EPA_BOARD_CODES.map((code) => {
    const template = templatesByCode.get(code);
    const row = progressByCode.get(code);
    const title = row?.title || template?.title || code;
    const level = levelThreshold(template)?.label || "L4";
    if (!row) return { code, title, state: "unknown", used: null, cap: null, thisYear: null, perYear: null, belowCount: null, level, canSendThisYear: false };
    const met = row.met === true;
    const used = row.attempts_used ?? 0;
    const cap = row.attempts_cap ?? null;
    const thisYear = row.attempts_this_year ?? 0;
    const perYear = template?.max_attempts_per_year ?? null;
    const atCap = cap != null && used >= cap;
    // The last attempt may still be waiting for Staff and could reach the level: do not tell the Resident to ask for more.
    const waiting = waitingCodes.has(code);
    return {
      code,
      title,
      state: met ? "reached" : waiting ? "waiting" : atCap ? "stuck" : "open",
      used,
      cap,
      thisYear,
      perYear,
      belowCount: Array.isArray(row.latest_below) ? row.latest_below.length : null,
      level,
      canSendThisYear: !met && !waiting && !atCap && (perYear == null || thisYear < perYear),
    };
  });

  const attendanceRows = Array.isArray(attendance)
    ? attendance.filter((row) => inYear(row.checked_in_at, start)).sort((a, b) => time(b.checked_in_at) - time(a.checked_in_at))
    : null;

  return {
    year: { start, label: `ปีการศึกษา ${Number(start.slice(0, 4)) + 543}` },
    greeting: { name: user.name || "", pgy: user.pgy ?? null },
    counters: {
      waitingEpa,
      waitingPba,
      waitingUnknown,
      finishedEpaThisYear: finishedEpaThisYear.length,
      finishedPbaThisYear: pbaDoneThisYear.size,
      epaReached: epaAvailable ? countBoardEpaMet((code) => epaRows.some((row) => row.code === code && row.state === "reached")) : null,
      epaTotal: EPA_BOARD_TOTAL,
      pbaFinished: pbaDone.size,
      pbaTarget: PBA_TARGET,
    },
    epaAvailable,
    waitingList,
    recent,
    board: { epa: epaRows, pba: { finished: pbaDone.size, target: PBA_TARGET, forms: pbaForms } },
    plan: {
      epaCanSend: epaRows.filter((row) => row.canSendThisYear).map(({ code, title }) => ({ code, title })),
      pbaThisYear: pbaDoneThisYear.size,
      pbaYearTarget: PBA_YEAR_TARGET,
    },
    attendance: {
      available: attendanceRows !== null,
      countThisYear: attendanceRows ? attendanceRows.length : 0,
      last5: attendanceRows ? attendanceRows.slice(0, RECENT_LIMIT).map((row) => row.checked_in_at) : [],
    },
  };
}
