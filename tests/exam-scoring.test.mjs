import assert from "node:assert/strict";
import test from "node:test";
import {
  examOutcome, mplError, fullScoreError, resultKey, mplMapKey, mplRowsToState, stateToMplRows,
  mplFor, missingMplCount, groupExamRecords, participantOutcome, outcomeLabel, PGY_LEVELS,
} from "../src/examScoring.js";

test("examOutcome: equal passes, one hundredth below fails, blanks give null", () => {
  assert.equal(examOutcome("65", "65"), "pass");
  assert.equal(examOutcome("65.00", 65), "pass");
  assert.equal(examOutcome("64.99", "65"), "remediation");
  assert.equal(examOutcome("0", "0"), "pass");
  assert.equal(examOutcome("", "65"), null);
  assert.equal(examOutcome("70", ""), null);
  assert.equal(examOutcome("70", null), null);
  assert.equal(examOutcome("abc", "65"), null);
  assert.equal(examOutcome("0.1", "0.10"), "pass");
});

test("mplError and fullScoreError mirror the server number rule", () => {
  assert.equal(mplError("", 100), "");
  assert.equal(mplError("65", 100), "");
  assert.equal(mplError("100", 100), "");
  assert.match(mplError("100.01", 100), /ไม่เกินคะแนนเต็ม 100/);
  assert.match(mplError("-1", 100), /ไม่ติดลบ/);
  assert.match(mplError("65.123", 100), /ทศนิยม/);
  assert.match(mplError("x", 100), /ตัวเลข/);
  assert.equal(fullScoreError("100"), "");
  assert.match(fullScoreError("0"), /มากกว่า 0/);
  assert.match(fullScoreError(""), /มากกว่า 0/);
  assert.match(fullScoreError("12.345"), /ทศนิยม/);
});

test("MPL state helpers round-trip and ignore blanks", () => {
  const state = mplRowsToState([{ part_id: "p1", pgy: 1, mpl: 60 }, { part_id: null, pgy: 2, mpl: "30.5" }]);
  assert.equal(mplFor(state, "p1", 1), "60");
  assert.equal(mplFor(state, null, 2), "30.5");
  assert.equal(mplFor(state, "p1", 3), "");
  assert.deepEqual(stateToMplRows({ [mplMapKey("p1", 1)]: "60", [mplMapKey("p1", 2)]: "", [mplMapKey(null, 3)]: "20" }), [
    { partId: "p1", pgy: 1, mpl: "60" },
    { partId: null, pgy: 3, mpl: "20" },
  ]);
  assert.deepEqual(PGY_LEVELS, [1, 2, 3, 4]);
  assert.equal(resultKey("r", null), "r:mcq");
  assert.equal(resultKey("r", "p"), "r:p");
});

test("missingMplCount counts cells whose PGY has no MPL (null PGY always counts)", () => {
  const state = mplRowsToState([{ part_id: "p1", pgy: 1, mpl: 60 }]);
  assert.equal(missingMplCount([{ pgy: 1, partId: "p1" }, { pgy: 2, partId: "p1" }, { pgy: null, partId: "p1" }], state), 2);
});

const row = (over) => ({
  event_id: "e1", exam_type: "xray_anatomy", exam_date: "2026-10-15", title: "T", max_score: null, status: "published",
  participant_id: "r1", resident_name: "ผู้ทดสอบ ก", resident_pgy: 3, part_id: "p1", part_name: "Anatomy", part_sort_order: 1,
  score: 70, outcome: "pass", result_updated_at: "2026-10-15T00:00:00Z", scoring_mode: "mpl", part_max_score: 100,
  pgy_at_exam: 2, mpl: 65, outcome_source: "computed", ...over,
});

test("groupExamRecords uses PGY at exam time, keeps part max, MPL and null outcomes", () => {
  const [event] = groupExamRecords([
    row({}),
    row({ participant_id: "r2", resident_name: "ผู้ทดสอบ ข", resident_pgy: 1, pgy_at_exam: null, mpl: null, score: 80, outcome: null }),
  ]);
  assert.equal(event.scoringMode, "mpl");
  assert.equal(event.parts[0].maxScore, 100);
  const a = event.participants.find((p) => p.id === "r1");
  assert.equal(a.pgy, 2, "promoted Resident keeps the PGY at exam time");
  const b = event.participants.find((p) => p.id === "r2");
  assert.equal(b.pgy, 1, "falls back to the profile PGY when none was locked");
  assert.equal(event.mpls.get(resultKey("r1", "p1")), 65);
  assert.equal(event.mpls.has(resultKey("r2", "p1")), false);
  const noOutcome = event.results.get(resultKey("r2", "p1"));
  assert.equal(noOutcome.score, 80);
  assert.equal(noOutcome.outcome, null);
});

test("legacy rows (no new columns) still group as manual exams", () => {
  const [event] = groupExamRecords([{ ...row({}), scoring_mode: undefined, part_max_score: undefined, pgy_at_exam: undefined, mpl: undefined, outcome_source: undefined, score: null }]);
  assert.equal(event.scoringMode, "manual");
  assert.equal(event.participants[0].pgy, 3);
  assert.equal(event.results.get(resultKey("r1", "p1")).outcome, "pass");
});

test("participantOutcome: any fail -> fail, all pass -> pass, missing or no-MPL -> pending", () => {
  const event = groupExamRecords([
    row({ part_id: "p1", part_name: "A", part_sort_order: 1 }),
    row({ part_id: "p2", part_name: "B", part_sort_order: 2, outcome: "remediation", score: 10 }),
    row({ participant_id: "r2", resident_name: "ข", part_id: "p1", part_name: "A", part_sort_order: 1 }),
    row({ participant_id: "r2", resident_name: "ข", part_id: "p2", part_name: "B", part_sort_order: 2 }),
    row({ participant_id: "r3", resident_name: "ค", part_id: "p1", part_name: "A", part_sort_order: 1, outcome: null, mpl: null }),
    row({ participant_id: "r3", resident_name: "ค", part_id: "p2", part_name: "B", part_sort_order: 2 }),
  ])[0];
  const by = (id) => event.participants.find((p) => p.id === id);
  assert.equal(participantOutcome(event, by("r1")), "fail");
  assert.equal(participantOutcome(event, by("r2")), "pass");
  assert.equal(participantOutcome(event, by("r3")), "pending");
});

test("outcomeLabel: computed says ไม่ผ่าน, legacy manual says ต้องซ่อม, null says ยังไม่ตั้งเกณฑ์ only for computed rows", () => {
  assert.equal(outcomeLabel("pass", "computed"), "ผ่าน");
  assert.equal(outcomeLabel("remediation", "computed"), "ไม่ผ่าน");
  assert.equal(outcomeLabel("remediation", "manual"), "ต้องซ่อม");
  assert.equal(outcomeLabel(null, "computed"), "ยังไม่ตั้งเกณฑ์");
  assert.equal(outcomeLabel(null, "manual"), "—");
});
