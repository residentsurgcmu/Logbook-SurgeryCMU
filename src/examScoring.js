// Pure helpers for exam scores, MPL and pass / not pass. No React, no network.
export const PGY_LEVELS = [1, 2, 3, 4];

const blank = (value) => value === null || value === undefined || String(value).trim() === "";
const cents = (value) => Math.round(Number(value) * 100);

// score >= MPL passes. Both blank/non-numeric -> null ("ยังไม่ตั้งเกณฑ์" / not scored).
export function examOutcome(score, mpl) {
  if (blank(score) || blank(mpl)) return null;
  const s = Number(score);
  const m = Number(mpl);
  if (!Number.isFinite(s) || !Number.isFinite(m)) return null;
  return cents(s) >= cents(m) ? "pass" : "remediation";
}

const NUMBER_FORMAT = /^[0-9]{1,8}(\.[0-9]{1,2})?$/;

export function mplError(value, maxScore) {
  const text = String(value ?? "").trim();
  if (text === "") return "";
  if (!NUMBER_FORMAT.test(text)) {
    if (/^[0-9]+\.[0-9]{3,}$/.test(text)) return "MPL ต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง";
    if (text.startsWith("-")) return "MPL ต้องไม่ติดลบ";
    return "MPL ต้องเป็นตัวเลข";
  }
  if (!blank(maxScore) && Number(text) > Number(maxScore)) return `MPL ต้องไม่เกินคะแนนเต็ม ${maxScore}`;
  return "";
}

export function fullScoreError(value) {
  const text = String(value ?? "").trim();
  if (/^[0-9]+\.[0-9]{3,}$/.test(text)) return "คะแนนเต็มต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง";
  if (!NUMBER_FORMAT.test(text) || Number(text) <= 0) return "คะแนนเต็มต้องเป็นตัวเลขที่มากกว่า 0";
  return "";
}

export const resultKey = (residentId, partId) => `${residentId}:${partId || "mcq"}`;
export const mplMapKey = (partId, pgy) => `${partId || "mcq"}:${pgy}`;

export function mplRowsToState(rows) {
  const state = {};
  for (const row of rows || []) state[mplMapKey(row.part_id, row.pgy)] = String(row.mpl);
  return state;
}

export function stateToMplRows(state) {
  const rows = [];
  for (const [key, value] of Object.entries(state || {})) {
    if (blank(value)) continue;
    const separator = key.lastIndexOf(":");
    const part = key.slice(0, separator);
    rows.push({ partId: part === "mcq" ? null : part, pgy: Number(key.slice(separator + 1)), mpl: String(value).trim() });
  }
  return rows;
}

export const mplFor = (state, partId, pgy) => state?.[mplMapKey(partId, pgy)] ?? "";

export function missingMplCount(cells, state) {
  return cells.filter((cell) => !cell.pgy || blank(mplFor(state, cell.partId, cell.pgy))).length;
}

export function groupExamRecords(records) {
  const events = new Map();
  for (const row of records || []) {
    if (!events.has(row.event_id)) {
      events.set(row.event_id, {
        id: row.event_id,
        type: row.exam_type,
        date: row.exam_date,
        title: row.title,
        maxScore: row.max_score,
        status: row.status,
        scoringMode: row.scoring_mode || "manual",
        participants: new Map(),
        parts: new Map(),
        results: new Map(),
        mpls: new Map(),
      });
    }
    const event = events.get(row.event_id);
    if (!event.participants.has(row.participant_id)) {
      event.participants.set(row.participant_id, {
        id: row.participant_id,
        name: row.resident_name,
        // An MPL exam never falls back to today's profile PGY: a null lock means "no MPL level".
        pgy: event.scoringMode === "mpl" ? (row.pgy_at_exam ?? null) : (row.pgy_at_exam ?? row.resident_pgy),
      });
    }
    if (row.part_id && !event.parts.has(row.part_id)) {
      event.parts.set(row.part_id, {
        id: row.part_id,
        name: row.part_name,
        sortOrder: row.part_sort_order,
        maxScore: row.part_max_score ?? null,
      });
    }
    const key = resultKey(row.participant_id, row.part_id);
    if (row.mpl !== null && row.mpl !== undefined) event.mpls.set(key, Number(row.mpl));
    if (row.outcome || (row.score !== null && row.score !== undefined)) {
      event.results.set(key, {
        score: row.score,
        outcome: row.outcome ?? null,
        outcomeSource: row.outcome_source || "manual",
        updatedAt: row.result_updated_at,
      });
    }
  }
  return [...events.values()]
    .map((event) => ({
      ...event,
      participants: [...event.participants.values()].sort((a, b) => a.name.localeCompare(b.name, "th")),
      parts: [...event.parts.values()].sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .sort((a, b) => `${b.date}:${b.id}`.localeCompare(`${a.date}:${a.id}`));
}

// One entry per Resident; events are newest first, so the first sighting carries the newest PGY.
export function residentChoices(events) {
  const choices = new Map();
  events.forEach((event) => event.participants.forEach((participant) => {
    if (!choices.has(participant.id)) choices.set(participant.id, participant);
  }));
  return [...choices.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));
}

export function participantOutcome(event, participant) {
  const cells = event.type === "mcq" ? [null] : event.parts.map((part) => part.id);
  const outcomes = cells.map((partId) => event.results.get(resultKey(participant.id, partId))?.outcome ?? null);
  if (outcomes.includes("remediation")) return "fail";
  if (outcomes.length && outcomes.every((outcome) => outcome === "pass")) return "pass";
  return "pending";
}

export function outcomeLabel(outcome, source = "manual") {
  if (outcome === "pass") return "ผ่าน";
  if (outcome === "remediation") return source === "computed" ? "ไม่ผ่าน" : "ต้องซ่อม";
  return source === "computed" ? "ยังไม่ตั้งเกณฑ์" : "—";
}
