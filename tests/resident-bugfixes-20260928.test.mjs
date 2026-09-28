import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keepWorkspaceOnRefreshError } from "../src/residentAuth.js";
import { wrapText } from "../src/residentExport.js";

const fakeFont = { widthOfTextAtSize: (text) => Array.from(text).length * 5 };

test("assessment PDF wraps long Thai text without spaces", () => {
  const thai = "ผู้ป่วยหญิงอายุหกสิบปีมาด้วยก้อนที่เต้านมข้างซ้ายขนาดสามเซนติเมตรได้รับการผ่าตัดเรียบร้อยดี".repeat(3);
  const lines = wrapText(thai, fakeFont, 9, 200);
  assert.ok(lines.length > 1, "long Thai text should be split into several lines");
  for (const line of lines) assert.ok(fakeFont.widthOfTextAtSize(line) <= 200, `line too wide: ${line}`);
  assert.equal(lines.join("").replaceAll(" ", ""), thai, "no characters lost");
  for (const line of lines) assert.doesNotMatch(line, /^[ัิ-ฺ็-๎]/, "line must not start with a combining vowel/tone mark");
  assert.deepEqual(wrapText("short text", fakeFont, 9, 200), ["short text"]);
  assert.deepEqual(wrapText("", fakeFont, 9, 200), ["—"]);
});

test("failed background refresh keeps a signed-in workspace", () => {
  const workspace = { user: { id: "u" } };
  assert.equal(keepWorkspaceOnRefreshError(workspace, new Error("Failed to fetch")), true);
  assert.equal(keepWorkspaceOnRefreshError(workspace, Object.assign(new Error("JWT expired"), { status: 401 })), false);
  assert.equal(keepWorkspaceOnRefreshError(workspace, new Error("Invalid Refresh Token: Refresh Token Not Found")), false);
  assert.equal(keepWorkspaceOnRefreshError(null, new Error("Failed to fetch")), false);
  assert.equal(keepWorkspaceOnRefreshError({ unauthorized: true }, new Error("Failed to fetch")), false);
});

test("frontend uses Bangkok date for assessment defaults", async () => {
  const platform = await readFile(new URL("../src/features/ResidentPlatform.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(platform, /const today = \(\) => new Date\(\)\.toISOString\(\)/);
  assert.match(platform, /const today = \(\) => new Intl\.DateTimeFormat\("en-CA"[^\n]*Asia\/Bangkok/);
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /keepWorkspaceOnRefreshError\(workspaceRef\.current, nextError\)/);
});

test("migration moves assessment dates to Bangkok and opens CME QR ahead of time", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260928090000_bangkok_assessment_date_and_cme_ahead.sql", import.meta.url), "utf8");
  assert.match(sql, /'submit_resident_assessment_request', 'admin_record_historical_resident_assessment'/);
  assert.match(sql, /replace\(v_def, 'current_date', '\(clock_timestamp\(\) at time zone ''Asia\/Bangkok''\)::date'\)/);
  assert.match(sql, /ilike '%CURRENT_DATE%'/);
  const setFn = sql.slice(sql.indexOf("function public.set_resident_round_cme_qr"), sql.indexOf("function public.clear_resident_round_cme_qr"));
  assert.match(setFn, /closed_at is null\s+and ends_at >= clock_timestamp\(\)/);
  assert.doesNotMatch(setFn, /meeting_date = \(clock_timestamp\(\)/);
});

test("no migration grants admin to the mistyped owner email", async () => {
  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const name of await readdir(dir)) {
    const sql = await readFile(new URL(name, dir), "utf8");
    assert.doesNotMatch(sql, /resident\.surgerycmu@gmail\.com/i, name);
  }
});

test("exam score validation names the Resident and mirrors the server rule", async () => {
  const src = await readFile(new URL("../src/features/ResidentExams.jsx", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function examScoreError"), src.indexOf("const today = () =>"));
  const examScoreError = new Function(`${body.replace("export function", "function")}; return examScoreError;`)();
  assert.equal(examScoreError("12.5", 20), "");
  assert.equal(examScoreError("20", 20), "");
  assert.match(examScoreError("12.345", 20), /ทศนิยม/);
  assert.match(examScoreError("-1", 20), /ไม่ติดลบ/);
  assert.match(examScoreError("21", 20), /คะแนนเต็ม 20/);
  assert.match(src, /คะแนนของ \$\{resident\.name/);
});

test("minor Resident fixes are wired in", async () => {
  const analytics = await readFile(new URL("../src/residentAnalytics.js", import.meta.url), "utf8");
  assert.match(analytics, /pgy: assessment\.resident_pgy \|\| resident\?\.pgy/);
  const platform = await readFile(new URL("../src/features/ResidentPlatform.jsx", import.meta.url), "utf8");
  assert.match(platform, /onClick=\{\(\) => !item\.read_at && read\(item\.id\)\}/);
  const round = await readFile(new URL("../src/features/RoundAttendance.jsx", import.meta.url), "utf8");
  assert.match(round, /seq !== refreshSeq\.current/);
  const sql = await readFile(new URL("../supabase/migrations/20260928100000_assessment_party_profile_read.sql", import.meta.url), "utf8");
  assert.match(sql, /assessment\.evaluator_id = \(select auth\.uid\(\)\) and assessment\.resident_id = user_id/);
});
