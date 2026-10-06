import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { residentTemplates } from "../src/generated/residentTemplates.js";
import {
  academicYearStart,
  bangkokDate,
  criteriaBelowLevel,
  evaluateRequestRules,
  friendlyAssessmentError,
  levelThreshold,
} from "../src/residentAssessmentRules.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = () => read("../supabase/migrations/20261007090000_epa_pba_attempt_rules.sql");
const L = ["L1", "L2", "L3", "L4", "L5"];
const epa = { id: "t-epa", template_type: "EPA", template_code: "EPA-1", max_attempts: 3, max_attempts_per_year: 1, score_options: L };
const epa7 = { id: "t-epa7", template_type: "EPA", template_code: "EPA-7-L3", max_attempts: 1, max_attempts_per_year: 1, score_options: ["F", "M", "E"] };
const epa8 = { id: "t-epa8", template_type: "EPA", template_code: "EPA-8", max_attempts: null, max_attempts_per_year: null, score_options: L };
const pba = { id: "t-pba", template_type: "PBA", template_code: "PBA-01", max_attempts: null, max_attempts_per_year: null, score_options: ["F", "M", "E"] };
const now = new Date("2026-10-06T10:00:00+07:00");
const request = (template, over = {}) => ({ id: Math.random().toString(36), template_id: template.id, staff_id: "s1", status: "completed", submitted_at: "2026-09-01T10:00:00+07:00", ...over });
const codes = (result) => result.reasons.map((item) => item.code);

test("generated templates carry the agreed limits: EPA 1-6 limit 3 and 1 per year, EPA 7 forms 1 and 1 per year, the rest unlimited", () => {
  for (const form of residentTemplates) {
    if (/^EPA-[1-6]$/.test(form.code)) assert.deepEqual([form.maxAttempts, form.maxAttemptsPerYear], [3, 1], form.code);
    else if (form.code.startsWith("EPA-7")) assert.deepEqual([form.maxAttempts, form.maxAttemptsPerYear], [1, 1], form.code);
    else assert.deepEqual([form.maxAttempts, form.maxAttemptsPerYear], [null, null], form.code);
  }
});

test("the academic year starts on 1 July Bangkok time (17:00 UTC on 30 June)", () => {
  assert.equal(academicYearStart(new Date("2026-10-06T10:00:00+07:00")), "2026-07-01");
  assert.equal(academicYearStart(new Date("2027-06-30T16:59:59Z")), "2026-07-01");
  assert.equal(academicYearStart(new Date("2027-06-30T17:00:00Z")), "2027-07-01");
  assert.equal(academicYearStart(new Date("2027-01-15T00:00:00+07:00")), "2026-07-01");
  assert.equal(bangkokDate(new Date("2026-10-06T23:30:00Z")), "2026-10-07");
});

test("rules: the same EPA twice in one academic year is blocked; the next academic year is fine", () => {
  const sameYear = evaluateRequestRules({ template: epa, requests: [request(epa)], now });
  assert.ok(codes(sameYear).includes("per-year"));
  const lastYear = evaluateRequestRules({ template: epa, requests: [request(epa, { submitted_at: "2026-06-30T23:59:00+07:00" })], now });
  assert.deepEqual(codes(lastYear), []);
  assert.equal(lastYear.attempt.number, 2);
  assert.equal(lastYear.attempt.cap, 3);
});

test("rules: cancelled requests never count", () => {
  assert.deepEqual(codes(evaluateRequestRules({ template: epa, requests: [request(epa, { status: "cancelled" })], now })), []);
});

test("rules: the lifetime limit blocks, and says to ask the course director only when the level is not reached", () => {
  const old = [1, 2, 3].map((n) => request(epa, { submitted_at: `${2023 + n}-08-01T10:00:00+07:00` }));
  const notMet = evaluateRequestRules({ template: epa, requests: old, progress: { attempts_used: 3, attempts_cap: 3, attempts_this_year: 0, met: false }, now });
  assert.ok(codes(notMet).includes("limit"));
  assert.match(notMet.reasons.find((item) => item.code === "limit").text, /ปรึกษาผู้อำนวยการหลักสูตร/);
  const met = evaluateRequestRules({ template: epa, requests: old, progress: { attempts_used: 3, attempts_cap: 3, attempts_this_year: 0, met: true }, now });
  assert.doesNotMatch(met.reasons.find((item) => item.code === "limit").text, /ปรึกษา/);
  const granted = evaluateRequestRules({ template: epa, requests: old, progress: { attempts_used: 3, attempts_cap: 4, attempts_this_year: 0, met: false }, now });
  assert.deepEqual(codes(granted), [], "an Admin-granted extra attempt raises the limit");
});

test("rules: PBA topics are never repeated, EPA 8 is unlimited, EPA 7 forms stop after one", () => {
  assert.ok(codes(evaluateRequestRules({ template: pba, requests: [request(pba, { status: "pending" })], now })).includes("pba-repeat"));
  assert.deepEqual(codes(evaluateRequestRules({ template: epa8, requests: [1, 2, 3, 4, 5].map(() => request(epa8)), now })), []);
  assert.ok(codes(evaluateRequestRules({ template: epa7, requests: [request(epa7, { submitted_at: "2025-08-01T10:00:00+07:00" })], now })).includes("limit"));
});

test("rules: an unavailable Staff cannot be chosen; a past period is ignored", () => {
  const staff = [
    { user_id: "s1", full_name: "อ. ตัวอย่าง", unit_name: "A", unavailable_until: "2026-10-10" },
    { user_id: "s2", full_name: "อ. อีกท่าน", unit_name: "B", unavailable_until: "2026-10-01" },
    { user_id: "s3", full_name: "อ. ว่าง", unit_name: "C", unavailable_until: null },
  ];
  assert.ok(codes(evaluateRequestRules({ template: epa, staffId: "s1", staff, now })).includes("unavailable"));
  assert.deepEqual(codes(evaluateRequestRules({ template: epa, staffId: "s2", staff, now })), []);
  assert.deepEqual(codes(evaluateRequestRules({ template: epa, staffId: "s3", staff, now })), []);
  assert.deepEqual(codes(evaluateRequestRules({ template: epa, staffId: "s1", staff, now: new Date("2026-10-10T20:00:00+07:00") })), ["unavailable"], "unavailable through the whole last day");
  assert.deepEqual(codes(evaluateRequestRules({ template: epa, staffId: "s1", staff, now: new Date("2026-10-11T00:30:00+07:00") })), []);
});

test("rules: warnings never block (same Staff as before, one Staff for most requests, level already reached)", () => {
  const staff = [{ user_id: "s1", full_name: "x", unit_name: "A", unavailable_until: null }];
  const many = [1, 2, 3].map((n) => request({ id: `o${n}` }, { staff_id: "s1" }));
  const r = evaluateRequestRules({ template: epa, requests: [...many, request(epa, { submitted_at: "2025-08-01T10:00:00+07:00", staff_id: "s1" })], progress: { attempts_used: 1, attempts_cap: 3, attempts_this_year: 0, met: true }, staffId: "s1", staff, now });
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.warnings.map((item) => item.code).sort(), ["already-met", "same-staff-before", "variety"]);
});

test("level: every criterion of ONE assessment must be at L4/L5 (M/E for the F/M/E forms); EPA 8 and PBA have no level", () => {
  assert.equal(levelThreshold(epa).label, "L4");
  assert.equal(levelThreshold(epa7).label, "M");
  assert.equal(levelThreshold(epa8), null);
  assert.equal(levelThreshold(pba), null);
  const criteria = [1, 2, 3].map((n) => ({ id: `c${n}`, criterion_text: `ข้อ ${n}`, sort_order: n }));
  const rows = (scores) => scores.map((score, index) => ({ criterion_id: `c${index + 1}`, score }));
  const mixed = criteriaBelowLevel(epa, rows(["L5", "L3", "L2"]), criteria);
  assert.equal(mixed.reached, false);
  assert.deepEqual(mixed.below.map((item) => [item.text, item.score]), [["ข้อ 2", "L3"], ["ข้อ 3", "L2"]]);
  assert.equal(criteriaBelowLevel(epa, rows(["L4", "L5", "L4"]), criteria).reached, true);
  assert.equal(criteriaBelowLevel(epa7, rows(["M", "E", "F"]), criteria).reached, false);
  assert.equal(criteriaBelowLevel(epa7, rows(["M", "E", "E"]), criteria).reached, true);
  assert.equal(criteriaBelowLevel(pba, rows(["F", "M", "E"]), criteria), null);
});

test("database refusals are explained in Thai; unknown messages pass through unchanged", () => {
  assert.match(friendlyAssessmentError("Selected Staff is not accepting assessments until 2026-10-10"), /ไม่สะดวกรับการประเมินถึง/);
  assert.match(friendlyAssessmentError("Assessment already requested this academic year"), /ปีการศึกษานี้ส่งแบบนี้แล้ว/);
  assert.match(friendlyAssessmentError("Assessment attempt limit reached"), /ใช้ครบจำนวนครั้ง/);
  assert.match(friendlyAssessmentError("This PBA topic was already requested"), /ไม่สอบเรื่องซ้ำ/);
  assert.match(friendlyAssessmentError("This assessment already has a pending request"), /รอประเมิน/);
  assert.equal(friendlyAssessmentError("something else"), "something else");
});

test("migration: limits, academic year, Staff availability, grants, progress and the replaced submit function", async () => {
  const sql = await migration();
  assert.match(sql, /add column if not exists max_attempts_per_year smallint/);
  assert.match(sql, /set max_attempts = 3, max_attempts_per_year = 1\s+where template_code in \('EPA-1','EPA-2','EPA-3','EPA-4','EPA-5','EPA-6'\)/);
  assert.match(sql, /set max_attempts_per_year = 1\s+where template_code in \('EPA-7-L1-L2','EPA-7-L3'\)/);
  assert.match(sql, /function private\.resident_academic_year_start/);
  assert.match(sql, /at time zone 'Asia\/Bangkok'/);
  for (const message of ["Selected Staff is not accepting assessments until", "Assessment attempt limit reached", "This PBA topic was already requested", "Assessment already requested this academic year", "This assessment already has a pending request"])
    assert.ok(sql.includes(message), message);
  assert.match(sql, /not exists \(select 1 from public\.resident_assessment_requests linked where linked\.assessment_id = assessment\.id\)/, "assessments an Admin recorded directly are counted");
  assert.match(sql, /resident_attempt_grants grants/);
  assert.match(sql, /Selected Staff must match an active registered Staff account/, "the old Staff check is kept");
  assert.match(sql, /Every self-assessment criterion requires one score/, "the old self-assessment check is kept");
});

test("migration: new tables are closed to direct access; every new function is closed to anon", async () => {
  const sql = await migration();
  for (const table of ["resident_staff_availability", "resident_attempt_grants"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
  }
  for (const fn of ["set_my_resident_staff_availability\\(date\\)", "list_registered_resident_staff\\(\\)", "admin_grant_resident_extra_attempt\\(uuid, uuid, text\\)", "get_my_epa_progress\\(\\)", "submit_resident_assessment_request\\(uuid, uuid, date, text, text, text, text, jsonb\\)"])
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn} from public, anon`), fn);
  assert.match(sql, /Active Admin account required/);
  assert.match(sql, /Active Staff role required/);
});

test("front end: the form checks the rules, explains refusals in Thai, and blocks sending", async () => {
  const views = await read("../src/features/ResidentAssessmentViews.jsx");
  assert.match(views, /evaluateRequestRules\(\{ template, requests, progress, staffId, staff: registeredStaff \}\)/);
  assert.match(views, /disabled=\{busy \|\| pending \|\| blocked \|\| !registeredStaff\.length\}/);
  assert.match(views, /friendlyAssessmentError\(nextError\.message\)/);
  assert.match(views, /disabled=\{Boolean\(away\)\}/, "an unavailable Staff cannot be selected");
  assert.match(views, /user\.role === "resident" && \(\s*<BelowLevelCallout/, "the 'below L4' list is for the Resident who was assessed");
  const platform = await read("../src/features/ResidentPlatform.jsx");
  assert.match(platform, /workspace\.user\.role === "staff" && \(\s*<StaffAvailabilityCard/);
  assert.match(platform, /includePerYear: workspace\.templates\.some\(\(item\) => "max_attempts_per_year" in item\)/);
});

test("front end: progress is loaded only for Residents and never blocks the workspace if the function is not installed yet", async () => {
  const api = await read("../src/residentApi.js");
  assert.match(api, /if \(role\.role === "resident"\) \{\s*const \{ data: progress, error: progressError \} = await supabase\.rpc\("get_my_epa_progress"\)/);
  assert.match(api, /if \(progressError\) console\.warn\("Could not load EPA progress", progressError\)/);
  assert.match(api, /rpc\("set_my_resident_staff_availability"/);
  assert.match(api, /options\.includePerYear \? \{ max_attempts_per_year: source\.maxAttemptsPerYear \?\? null \} : \{\}/);
});

test("the behaviour test script refuses to run against a database that has Resident data and rolls everything back", async () => {
  const sql = await read("../tests/resident-attempt-rules-behavior.sql");
  assert.match(sql, /Refusing to run: this database already has Resident data/);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^rollback;/m);
});

test("the Staff availability card is independent of the request form (it must not use the form's variables)", async () => {
  const views = await read("../src/features/ResidentAssessmentViews.jsx");
  const card = views.slice(views.indexOf("export function StaffAvailabilityCard"), views.indexOf("export function ResidentRequestForm"));
  assert.ok(card.length > 200);
  assert.doesNotMatch(card, /\brules\./);
  assert.doesNotMatch(card, /\bpast\./);
  assert.doesNotMatch(card, /\bprogress\b/);
  const form = views.slice(views.indexOf("export function ResidentRequestForm"), views.indexOf("export function StaffEvaluationForm"));
  assert.match(form, /rules\.attempt\?\.number/);
  assert.equal((form.match(/<RuleMessages rules=\{rules\} \/>/g) || []).length, 1);
});
