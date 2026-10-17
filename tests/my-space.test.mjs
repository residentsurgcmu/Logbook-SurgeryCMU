import assert from "node:assert/strict";
import test from "node:test";
import { EPA_CODES, PBA_CODES } from "../src/adminProgress.js";
import { buildMySpace, EPA_BOARD_CODES, PBA_TARGET, PBA_YEAR_TARGET, STUCK_TEXT } from "../src/mySpace.js";

const NOW = new Date("2026-10-12T05:00:00Z"); // 12 Oct 2026, academic year starting 2026-07-01 (2569).
const ME = { id: "me", name: "Resident สมมติ", pgy: 2 };
const profiles = [{ id: "s1", name: "Staff สมมติ หนึ่ง" }, { id: "s2", name: "Staff สมมติ สอง" }];
const templates = [...EPA_CODES, ...PBA_CODES].map((code) => ({
  id: `t-${code}`, template_code: code, title: `ชื่อแบบ ${code}`, template_type: code.startsWith("EPA") ? "EPA" : "PBA",
  max_attempts: code.startsWith("EPA") && code !== "EPA-8" ? 3 : null,
  max_attempts_per_year: code.startsWith("EPA") && code !== "EPA-8" ? 1 : null,
  score_options: code.startsWith("EPA-7") ? ["F", "M", "E"] : code.startsWith("EPA") ? ["L1", "L2", "L3", "L4", "L5"] : [],
}));
const progressRow = (code, patch = {}) => ({
  template_id: `t-${code}`, template_code: code, title: `ชื่อแบบ ${code}`, counts_for_board: code !== "EPA-8",
  attempts_used: 0, attempts_cap: 3, attempts_this_year: 0, met: false, latest_assessment_date: null, latest_below: null, ...patch,
});
const epaProgress = () => EPA_CODES.map((code) => progressRow(code, code === "EPA-8" ? { attempts_cap: null } : {}));
const request = (code, patch = {}) => ({
  id: `r-${code}-${Math.random()}`, resident_id: "me", template_id: `t-${code}`, staff_id: "s1", status: "pending",
  submitted_at: "2026-10-10T03:00:00Z", resident_template_definitions: { template_code: code, title: `ชื่อแบบ ${code}`, template_type: code.slice(0, 3) }, ...patch,
});
const assessment = (code, date, patch = {}) => ({
  id: `a-${code}-${date}`, resident_id: "me", template_id: `t-${code}`, evaluator_id: "s2", assessment_date: date, created_at: `${date}T05:00:00Z`,
  resident_template_definitions: { template_code: code, title: `ชื่อแบบ ${code}`, template_type: code.slice(0, 3) }, ...patch,
});
const build = (over = {}) => buildMySpace({ user: ME, requests: [], assessments: [], templates, epaProgress: epaProgress(), attendance: [], profiles, now: NOW, ...over });

test("constants: 8 board EPA forms (EPA-8 excluded), PBA target 16, PBA per year 4", () => {
  assert.deepEqual(EPA_BOARD_CODES, ["EPA-1", "EPA-2", "EPA-3", "EPA-4", "EPA-5", "EPA-6", "EPA-7-L1-L2", "EPA-7-L3"]);
  assert.equal(PBA_TARGET, 16);
  assert.equal(PBA_YEAR_TARGET, 4);
});

test("six separate counters: EPA attempts and PBA distinct topics; nothing combined", () => {
  const rows = epaProgress().map((row) => (["EPA-1", "EPA-2", "EPA-8"].includes(row.template_code) ? { ...row, met: true } : row));
  const space = build({
    epaProgress: rows,
    requests: [request("EPA-3"), request("PBA-02"), request("EPA-4", { status: "cancelled" }), request("EPA-5", { status: "completed" })],
    assessments: [assessment("EPA-1", "2026-09-01"), assessment("PBA-01", "2026-08-01"), assessment("EPA-2", "2026-05-01")],
  });
  assert.deepEqual(space.counters, { waitingEpa: 1, waitingPba: 1, waitingUnknown: 0, finishedEpaThisYear: 1, finishedPbaThisYear: 1, epaReached: 2, epaTotal: 8, pbaFinished: 1, pbaTarget: 16 });
  assert.equal(space.epaAvailable, true);
});

test("EPA-8 never counts toward x/8", () => {
  const rows = epaProgress().map((row) => (row.template_code === "EPA-8" ? { ...row, met: true } : row));
  assert.equal(build({ epaProgress: rows }).counters.epaReached, 0);
});

test("PBA: a waiting request is not finished; distinct forms only", () => {
  const space = build({
    requests: [request("PBA-03")],
    assessments: [assessment("PBA-01", "2026-08-01"), assessment("PBA-01", "2026-09-01"), assessment("PBA-02", "2026-09-02")],
  });
  assert.equal(space.counters.pbaFinished, 2);
  const state = (code) => space.board.pba.forms.find((form) => form.code === code).state;
  assert.equal(state("PBA-01"), "finished");
  assert.equal(state("PBA-03"), "waiting");
  assert.equal(state("PBA-04"), "empty");
  assert.equal(space.board.pba.forms.length, 21);
});

test("academic year boundary in Bangkok: 30 June 23:59 vs 1 July 00:00", () => {
  const before = build({ now: new Date("2026-06-30T16:59:00Z") });
  const after = build({ now: new Date("2026-06-30T17:00:00Z") });
  assert.equal(before.year.start, "2025-07-01");
  assert.equal(before.year.label, "ปีการศึกษา 2568");
  assert.equal(after.year.start, "2026-07-01");
  assert.equal(after.year.label, "ปีการศึกษา 2569");
  const items = { assessments: [assessment("EPA-1", "2026-06-30"), assessment("EPA-2", "2026-07-01"), assessment("PBA-01", "2026-06-30"), assessment("PBA-02", "2026-07-01")], attendance: [{ session_id: "x", checked_in_at: "2026-06-30T16:59:00Z" }, { session_id: "y", checked_in_at: "2026-06-30T17:00:00Z" }] };
  const a = build({ ...items, now: new Date("2026-06-30T16:59:00Z") });
  const b = build({ ...items, now: new Date("2026-06-30T17:00:00Z") });
  assert.equal(a.counters.finishedEpaThisYear, 1); // EPA dates stay on the assessment-date basis.
  assert.equal(a.counters.finishedPbaThisYear, 1);
  assert.equal(b.counters.finishedEpaThisYear, 1);
  assert.equal(b.counters.finishedPbaThisYear, 1);
  assert.equal(a.plan.pbaThisYear, 1); // only the 30 June PBA belongs to the old year
  assert.equal(b.plan.pbaThisYear, 1); // only the 1 July PBA belongs to the new year
  assert.equal(a.attendance.countThisYear, 1);
  assert.equal(b.attendance.countThisYear, 1);
  const c = build({ assessments: items.assessments, now: new Date("2026-07-02T05:00:00Z") });
  assert.equal(c.counters.finishedEpaThisYear, 1);
  assert.equal(c.counters.finishedPbaThisYear, 1);
  assert.equal(c.plan.pbaThisYear, 1);
});

test("can still send this year: not reached, under yearly limit, under cap; PBA n/4", () => {
  const rows = epaProgress().map((row) => {
    if (row.template_code === "EPA-1") return { ...row, met: true };
    if (row.template_code === "EPA-2") return { ...row, attempts_used: 1, attempts_this_year: 1 };
    if (row.template_code === "EPA-3") return { ...row, attempts_used: 3, attempts_cap: 3 };
    return row;
  });
  const space = build({ epaProgress: rows, assessments: [assessment("PBA-01", "2026-08-01"), assessment("PBA-02", "2026-09-01")] });
  const codes = space.plan.epaCanSend.map((item) => item.code);
  assert.ok(!codes.includes("EPA-1"));
  assert.ok(!codes.includes("EPA-2"));
  assert.ok(!codes.includes("EPA-3"));
  assert.ok(!codes.includes("EPA-8"));
  assert.deepEqual(codes, ["EPA-4", "EPA-5", "EPA-6", "EPA-7-L1-L2", "EPA-7-L3"]);
  assert.equal(space.plan.pbaThisYear, 2);
  assert.equal(space.plan.pbaYearTarget, 4);
});

test("board checklist rows: reached, open with below-count, stuck with Admin text", () => {
  const rows = epaProgress().map((row) => {
    if (row.template_code === "EPA-1") return { ...row, met: true, attempts_used: 2 };
    if (row.template_code === "EPA-2") return { ...row, attempts_used: 1, attempts_this_year: 1, latest_below: [{ criterion: "ก", score: "L2" }, { criterion: "ข", score: "L3" }] };
    if (row.template_code === "EPA-3") return { ...row, attempts_used: 3, attempts_cap: 3, latest_below: [{ criterion: "ก", score: "L1" }] };
    if (row.template_code === "EPA-7-L1-L2") return { ...row, attempts_used: 1, attempts_this_year: 1, latest_below: [{ criterion: "ก", score: "F" }] };
    return row;
  });
  const epa = build({ epaProgress: rows }).board.epa;
  const row = (code) => epa.find((item) => item.code === code);
  assert.equal(epa.length, 8);
  assert.equal(row("EPA-1").state, "reached");
  assert.deepEqual([row("EPA-2").state, row("EPA-2").used, row("EPA-2").cap, row("EPA-2").thisYear, row("EPA-2").perYear, row("EPA-2").belowCount, row("EPA-2").level], ["open", 1, 3, 1, 1, 2, "L4"]);
  assert.equal(row("EPA-3").state, "stuck");
  assert.equal(row("EPA-7-L1-L2").level, "M");
  assert.equal(STUCK_TEXT, "ติดต่อ Admin เพื่อพิจารณาเพิ่มครั้ง");
  assert.equal(row("EPA-4").belowCount, null);
});

test("epaProgress null or empty: note-able state, other counters still right", () => {
  for (const missing of [null, []]) {
    const space = build({ epaProgress: missing, requests: [request("EPA-3")], assessments: [assessment("PBA-01", "2026-09-01")] });
    assert.equal(space.epaAvailable, false);
    assert.equal(space.counters.epaReached, null);
    assert.equal(space.counters.waitingEpa, 1);
    assert.equal(space.counters.pbaFinished, 1);
    assert.ok(space.board.epa.every((item) => item.state === "unknown"));
    assert.deepEqual(space.plan.epaCanSend, []);
  }
});

test("cancelled requests ignored; Admin-recorded assessments (no request) counted", () => {
  const space = build({
    requests: [request("EPA-1", { status: "cancelled" })],
    assessments: [assessment("EPA-2", "2026-09-15")], // no request row = recorded directly by an Admin
  });
  assert.equal(space.counters.waitingEpa, 0);
  assert.equal(space.counters.finishedEpaThisYear, 1);
  assert.equal(space.recent.length, 1);
});

test("waiting list: newest first, Staff name, days waiting in Bangkok calendar days; recent: last 5 newest first", () => {
  const space = build({
    requests: [request("EPA-3", { submitted_at: "2026-10-05T02:00:00Z" }), request("EPA-4", { submitted_at: "2026-10-11T18:30:00Z", staff_id: "s2" })],
    assessments: ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-09-01", "2026-09-20"].map((date, i) => assessment(EPA_CODES[i], date)),
  });
  assert.deepEqual(space.waitingList.map((item) => [item.code, item.staffName, item.submittedAt, item.daysWaiting]), [["EPA-4", "Staff สมมติ สอง", "2026-10-12", 0], ["EPA-3", "Staff สมมติ หนึ่ง", "2026-10-05", 7]]);
  assert.equal(space.recent.length, 5);
  assert.deepEqual(space.recent.map((item) => item.date), ["2026-09-20", "2026-09-01", "2026-04-01", "2026-03-01", "2026-02-01"]);
  assert.equal(space.recent[0].staffName, "Staff สมมติ สอง");
});

test("unknown template or Staff never throws", () => {
  const space = build({
    requests: [{ id: "r", resident_id: "me", template_id: "gone", staff_id: "nobody", status: "pending", submitted_at: "2026-10-10T03:00:00Z" }],
    assessments: [{ id: "a", resident_id: "me", template_id: "gone", evaluator_id: "nobody", assessment_date: "2026-09-01", created_at: "2026-09-01T00:00:00Z" }],
  });
  assert.equal(space.waitingList[0].staffName, "—");
  assert.equal(space.waitingList[0].code, "—");
  assert.equal(space.recent[0].staffName, "—");
});

test("only the signed-in Resident's own rows are counted", () => {
  const space = build({ requests: [request("EPA-3", { resident_id: "someone-else" })], assessments: [assessment("PBA-01", "2026-09-01", { resident_id: "someone-else" })] });
  assert.equal(space.counters.waitingEpa, 0);
  assert.equal(space.counters.pbaFinished, 0);
});

test("attendance: null = not loaded; rows = count this year + last 5 newest first", () => {
  assert.equal(build({ attendance: null }).attendance.available, false);
  const rows = ["2026-07-02", "2026-07-09", "2026-08-01", "2026-08-08", "2026-09-05", "2026-09-12", "2026-05-01"].map((day, i) => ({ session_id: `s${i}`, checked_in_at: `${day}T03:00:00Z` }));
  const space = build({ attendance: rows });
  assert.equal(space.attendance.available, true);
  assert.equal(space.attendance.countThisYear, 6);
  assert.deepEqual(space.attendance.last5, ["2026-09-12T03:00:00Z", "2026-09-05T03:00:00Z", "2026-08-08T03:00:00Z", "2026-08-01T03:00:00Z", "2026-07-09T03:00:00Z"]);
});

test("greeting carries name and PGY; the module shares the Admin file's form lists", async () => {
  const space = build();
  assert.deepEqual(space.greeting, { name: "Resident สมมติ", pgy: 2 });
  const admin = await import("../src/adminProgress.js");
  assert.equal(admin.PBA_CODES.length, 21);
  assert.equal(space.board.pba.forms.map((f) => f.code).join(), admin.PBA_CODES.join());
  assert.equal(space.board.epa.map((f) => f.code).join(), admin.EPA_CODES.filter((c) => c !== "EPA-8").join());
});

test("last attempt still waiting for Staff: 'waiting' not 'stuck', and not offered again this year", () => {
  const rows = epaProgress().map((row) => (row.template_code === "EPA-2" ? { ...row, attempts_used: 3, attempts_cap: 3, attempts_this_year: 1 } : row.template_code === "EPA-4" ? { ...row, attempts_used: 1, attempts_this_year: 0 } : row));
  const space = build({ epaProgress: rows, requests: [request("EPA-2"), request("EPA-4", { submitted_at: "2026-06-20T03:00:00Z" })] });
  const row = (code) => space.board.epa.find((item) => item.code === code);
  assert.equal(row("EPA-2").state, "waiting");
  assert.equal(row("EPA-4").state, "waiting");
  assert.ok(!space.plan.epaCanSend.some((item) => item.code === "EPA-4")); // pending request sent last year still blocks a new one
});

test("PBA this year follows the Admin file: request-linked rows by the request's sent date, direct rows by assessment date", () => {
  const linked = { ...assessment("PBA-01", "2026-06-28"), id: "a-linked" }; // activity before 1 July
  const done = request("PBA-01", { status: "completed", assessment_id: "a-linked", submitted_at: "2026-07-02T03:00:00Z" });
  assert.equal(build({ assessments: [linked], requests: [done] }).plan.pbaThisYear, 1);
  const direct = assessment("PBA-02", "2026-06-28"); // recorded by an Admin, no request
  assert.equal(build({ assessments: [direct] }).plan.pbaThisYear, 0);
});

test("split pending counts conserve every own pending request; unknown types stay visible", () => {
  const requests = [
    request("EPA-1"), request("EPA-8"), request("PBA-01"),
    request("PBA-02", { resident_template_definitions: { template_code: "PBA-02" } }),
    request("EPA-2", { resident_template_definitions: undefined }), // catalog fallback
    request("missing", { template_id: "missing", resident_template_definitions: undefined }),
    request("invalid", { resident_template_definitions: { template_type: "OTHER" } }),
    request("EPA-3", { status: "cancelled" }), request("PBA-03", { status: "completed" }),
    request("EPA-4", { resident_id: "someone-else" }),
  ];
  const space = build({ requests });
  assert.equal(space.counters.waitingEpa, 3);
  assert.equal(space.counters.waitingPba, 2);
  assert.equal(space.counters.waitingUnknown, 2);
  const oldTotal = requests.filter((row) => row.resident_id === ME.id && row.status === "pending").length;
  assert.equal(space.counters.waitingEpa + space.counters.waitingPba + space.counters.waitingUnknown, oldTotal);
  assert.equal(space.waitingList.length, oldTotal);
  assert.ok(space.waitingList.some((row) => row.code === "—"));
  const known = build({ requests: requests.slice(0, 5) });
  assert.equal(known.counters.waitingEpa + known.counters.waitingPba, known.waitingList.length);
  assert.equal(known.counters.waitingUnknown, 0);
});

test("EPA yearly summary counts assessments including EPA-8; PBA summary reuses distinct yearly topics", () => {
  const space = build({ assessments: [
    assessment("EPA-1", "2026-08-01"), assessment("EPA-1", "2026-09-01"), assessment("EPA-8", "2026-09-02"),
    assessment("EPA-2", "2026-06-30"), assessment("PBA-01", "2026-08-01"), assessment("PBA-01", "2026-09-01"),
  ] });
  assert.equal(space.counters.finishedEpaThisYear, 3);
  assert.equal(space.counters.finishedPbaThisYear, 1);
  assert.equal(space.counters.finishedPbaThisYear, space.plan.pbaThisYear);
});

test("a request with no sent date does not crash or claim 'today'", () => {
  const space = build({ requests: [{ id: "r", resident_id: "me", template_id: "t-EPA-3", staff_id: "s1", status: "pending", submitted_at: null }] });
  assert.equal(space.waitingList[0].submittedAt, "");
});
