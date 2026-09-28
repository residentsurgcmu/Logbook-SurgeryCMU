import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { residentTemplates } from "../src/generated/residentTemplates.js";
import { parseRoundToken, roundCheckInErrorMessage } from "../src/roundSchedule.js";
import { fetchAllRows } from "../src/supabasePaging.js";
import { crc32, createZip } from "../src/zipStore.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = () => read("supabase/migrations/20260928140000_code_review_fixes.sql");

// 1) Attendance QR grace period
test("attendance QR token stays valid for 60 seconds after its minute", async () => {
  const sql = await migration();
  const fn = sql.slice(sql.indexOf("private.resident_round_token_is_current"), sql.indexOf("$$;"));
  assert.match(fn, /p_at >= p_minute and p_at < p_minute \+ interval '2 minutes'/);
  const db = await read("tests/round-attendance-db.sql");
  assert.match(db, /04:00:30Z[\s\S]*04:01:00Z/);
});

// 2) Check-in link is used once and then cleared
test("attendance link is parsed once, cleared after check-in, and errors are Thai", async () => {
  const token = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.equal(parseRoundToken(`/attendance/${token}`), token);
  assert.equal(parseRoundToken(`/attendance/${token}/`), token);
  assert.equal(parseRoundToken("/"), "");
  assert.match(roundCheckInErrorMessage(new Error("QR has expired or is invalid. Scan the current QR again")), /QR หมดอายุ/);
  const [platform, round] = await Promise.all([read("src/features/ResidentPlatform.jsx"), read("src/features/RoundAttendance.jsx")]);
  assert.match(platform, /useState\(\(\) => parseRoundToken\(window\.location\.pathname\)\)/);
  assert.match(platform, /onTokenUsed=\{\(\) => \{\s*setRoundToken\(""\);\s*window\.history\.replaceState\(\{\}, document\.title, "\/"\);/);
  assert.match(round, /submittedToken\.current === token/);
  assert.match(round, /onTokenUsed\?\.\(\)/);
});

// 3) Workspace paging beyond the 1,000-row API cap
test("fetchAllRows pages through every row with stable ranges", async () => {
  const data = Array.from({ length: 2345 }, (_, index) => index);
  const ranges = [];
  const build = () => ({ range: async (from, to) => { ranges.push([from, to]); return { data: data.slice(from, to + 1), error: null }; } });
  const result = await fetchAllRows(build, 1000);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, data);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  const failing = await fetchAllRows(() => ({ range: async () => ({ data: null, error: new Error("boom") }) }));
  assert.equal(failing.error.message, "boom");
  const api = await read("src/residentApi.js");
  const load = api.slice(api.indexOf("export async function loadResidentWorkspace"), api.indexOf("export async function syncSourceTemplates"));
  for (const source of ["resident_assessments", "resident_profiles\")\n        .select(\"user_id,full_name,email,pgy,active\")", "resident_assessment_requests", "list_resident_exam_records"]) {
    const at = load.indexOf(source);
    assert.ok(at > 0, source);
    assert.match(load.slice(Math.max(0, at - 80), at), /fetchAllRows\(/, `${source} must be paged`);
  }
});

// 4) Reminder cron is not starved by old pending requests
test("deliver_due selects only requests whose due email is unsent", async () => {
  const fn = await read("supabase/functions/resident-assessment-notifier/index.ts");
  const block = fn.slice(fn.indexOf('payload.action === "deliver_due"'), fn.indexOf('payload.action !== "deliver_initial"'));
  assert.doesNotMatch(block, /\.limit\(200\)/);
  assert.match(block, /resident_assessment_email_deliveries\(delivery_type,status\)/);
  assert.match(block, /row\.delivery_type === type && row\.status === "sent"/);
  assert.match(block, /\.range\(offset, offset \+ pageSize - 1\)/);
  assert.match(block, /due\.slice\(0, MAX_DELIVERIES_PER_RUN\)/);
});

// 5) Linking an existing profile as Staff also grants the Staff role
test("resident-admin grants profile and Staff role whenever it links a Staff account", async () => {
  const fn = await read("supabase/functions/resident-admin/index.ts");
  assert.match(fn, /const ensureStaffAccess = async/);
  const staffBranch = fn.slice(fn.indexOf('if (role === "staff") {'), fn.indexOf("if (directory) throw new Error"));
  assert.equal(staffBranch.match(/await ensureStaffAccess\(/g).length, 3);
  const existingBranch = staffBranch.slice(staffBranch.indexOf("const userId = existing?.user_id;"));
  assert.ok(existingBranch.indexOf("ensureStaffAccess") < existingBranch.indexOf("alreadyProvisioned: true"));
});

// 6) Deleting an assessment renumbers later attempts
test("assessment deletion closes the gap in attempt numbers", async () => {
  const sql = await migration();
  const fn = sql.slice(sql.indexOf("function public.admin_delete_resident_assessment"), sql.indexOf("-- 3)"));
  assert.match(fn, /returning template_id, attempt_number into v_template_id, v_attempt/);
  assert.match(fn, /attempt_number > v_attempt\s+order by attempt_number/);
  assert.match(fn, /set attempt_number = attempt_number - 1/);
  assert.match(fn, /grant execute on function public\.admin_delete_resident_assessment\(uuid, uuid\) to service_role/);
});

// 7) Inactive criteria are not sent to the server
test("workspace scores only active criteria and sync retires removed ones", async () => {
  const api = await read("src/residentApi.js");
  assert.match(api, /criteria: allCriteria\.filter\(\(criterion\) => criterion\.active !== false\)/);
  assert.match(api, /\.update\(\{ active: false \}\)[\s\S]*?\.not\("criterion_code", "in"/);
  const views = await read("src/features/ResidentAssessmentViews.jsx");
  assert.match(views, /template\?\.allCriteria \|\| template\?\.criteria/);
});

// 8) Attendance PDF uses the Thai-aware wrapper
test("attendance PDF reuses the Thai grapheme-safe wrapText", async () => {
  const exporter = await read("src/roundAttendanceExport.js");
  assert.match(exporter, /import \{ wrapText \} from "\.\/residentExport\.js"/);
  assert.doesNotMatch(exporter, /function wrapText\(/);
  assert.doesNotMatch(exporter, /Array\.from\(word\)/);
});

// 9) Per-date PDFs arrive as one zip
test("zip writer produces a valid archive for per-date PDFs", async () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const files = [
    { name: "MM-Grand-Round-2026-09-05.pdf", data: new TextEncoder().encode("%PDF-one") },
    { name: "MM-Grand-Round-2026-09-12.pdf", data: new TextEncoder().encode("%PDF-two!") },
  ];
  const zip = createZip(files, new Date(2026, 8, 28, 10, 30, 0));
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 12, true), 2);
  try {
    const dir = await mkdtemp(join(tmpdir(), "zip-"));
    await writeFile(join(dir, "a.zip"), zip);
    const listing = execFileSync("python3", ["-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(z.read(z.namelist()[1]).decode())", join(dir, "a.zip")]).toString();
    assert.equal(listing.trim(), "%PDF-two!");
  } catch (error) {
    if (error.code !== "ENOENT") throw error; // python3 unavailable: structural checks above still apply
  }
  const exporter = await read("src/roundAttendanceExport.js");
  assert.match(exporter, /createZip\(files\)/);
  assert.match(exporter, /application\/zip/);
});

// 10) Cancelled requests are labelled
test("request history labels cancelled requests", async () => {
  const views = await read("src/features/ResidentAssessmentViews.jsx");
  assert.match(views, /status === "cancelled"\s*\?\s*"ยกเลิก"/);
  assert.match(views, /\{requestStatusLabel\(request\.status\)\}/);
  assert.match(await read("src/resident.css"), /\.status-chip\.cancelled/);
});

// 11) QR scanner handles one decode at a time
test("QR scanner ignores repeated frames while a lookup runs", async () => {
  const qr = await read("src/features/ResidentQr.jsx");
  assert.match(qr, /if \(scanLock\.current\) return;\s*scanLock\.current = true;/);
});

// 12) Dead components removed
test("unused legacy components are removed from ResidentPlatform", async () => {
  const platform = await read("src/features/ResidentPlatform.jsx");
  for (const name of ["function History(", "function RequestForm(", "function EvaluationForm(", "function RequestHistory("]) assert.ok(!platform.includes(name), name);
  assert.doesNotMatch(platform, /completeAssessmentRequest|requestAssessment,/);
});

// 13) Borderline spelling
test("EPA outcome is spelled Borderline in source, catalog and data migration", async () => {
  for (const template of residentTemplates) {
    assert.ok(!template.outcomeOptions.includes("Boarderline"), template.code);
  }
  assert.ok(residentTemplates.filter((template) => template.outcomeOptions.includes("Borderline")).length >= 8);
  assert.doesNotMatch(await read("scripts/generate-resident-templates.mjs"), /Boarderline/);
  const sql = await migration();
  assert.match(sql, /where outcome_options \? 'Boarderline'/);
  assert.match(sql, /set overall_outcome = 'Borderline'\s+where overall_outcome = 'Boarderline'/);
  assert.match(sql, /set self_overall_outcome = 'Borderline'\s+where self_overall_outcome = 'Boarderline'/);
});
