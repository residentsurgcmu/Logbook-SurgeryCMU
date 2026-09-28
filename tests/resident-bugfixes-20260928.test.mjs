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

test("legacy Year 4 / Breast system is retired without touching Resident objects", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260928110000_retire_legacy_year4_breast.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated/);
  assert.match(sql, /'profiles'/);
  assert.match(sql, /'year4_logbook_entries'/);
  assert.match(sql, /drop trigger if exists on_auth_user_created on auth\.users/);
  assert.doesNotMatch(sql, /drop table/i);
  const listed = sql.slice(sql.indexOf("v_legacy_tables"), sql.indexOf("begin", sql.indexOf("v_legacy_tables")));
  assert.doesNotMatch(listed, /resident_/);
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /year4|Year4|trainingApi/);
});

test("round 2 fixes: ended sessions editable, invite links existing accounts, exam RLS helpers", async () => {
  const round = await readFile(new URL("../src/features/RoundAttendance.jsx", import.meta.url), "utf8");
  const ended = round.slice(round.indexOf('className="round-ended-sessions"'));
  assert.match(ended, /onClick=\{\(\) => startEdit\(session\)\}/);
  assert.match(ended, /onClick=\{\(\) => stop\(session\)\}/);
  assert.match(ended, /renderEditForm\(\)/);
  const fn = await readFile(new URL("../supabase/functions/resident-admin/index.ts", import.meta.url), "utf8");
  assert.match(fn, /admin_find_auth_user_id/);
  assert.equal((fn.match(/auth\.admin\.inviteUserByEmail/g) || []).length, 1, "all invites go through inviteOrLinkUser");
  const api = await readFile(new URL("../src/residentApi.js", import.meta.url), "utf8");
  assert.equal((api.match(/throw await residentAdminError\(error, "ไม่สามารถบันทึกบัญชีได้"\)/g) || []).length, 2);
  const sql = await readFile(new URL("../supabase/migrations/20260928120000_link_existing_auth_users_and_exam_rls.sql", import.meta.url), "utf8");
  assert.match(sql, /grant execute on function public\.admin_find_auth_user_id\(text\) to service_role/);
  assert.match(sql, /revoke all on function public\.admin_find_auth_user_id\(text\) from public, anon, authenticated/);
  const eventsPolicy = sql.slice(sql.indexOf("create policy resident_exam_events_visible"), sql.indexOf("drop policy if exists resident_exam_participants_visible"));
  assert.doesNotMatch(eventsPolicy, /from public\.resident_exam_participants/);
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /setStaleRefresh\(true\)/);
});

test("assessment notifier sends via Gmail SMTP on port 465 and is scheduled", async () => {
  const fn = await readFile(new URL("../supabase/functions/resident-assessment-notifier/index.ts", import.meta.url), "utf8");
  assert.match(fn, /npm:nodemailer/);
  assert.match(fn, /const messageId = await sendMail\(/);
  assert.match(fn, /secure: true/);
  assert.match(fn, /resident_reminder_secret_matches/);
  const sql = await readFile(new URL("../supabase/migrations/20260928130000_schedule_assessment_email_delivery.sql", import.meta.url), "utf8");
  assert.match(sql, /'resident-assessment-email-delivery',\s*'\*\/15 \* \* \* \*'/);
  assert.match(sql, /grant execute on function public\.resident_reminder_secret_matches\(text\) to service_role/);
  assert.match(sql, /revoke all on function public\.resident_reminder_secret_matches\(text\) from public, anon, authenticated/);
  assert.match(sql, /"action":"deliver_due"/);
});
