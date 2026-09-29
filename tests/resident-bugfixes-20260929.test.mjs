import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildExportRecords } from "../src/residentAnalytics.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = () => read("supabase/migrations/20260929090000_cancel_requests_and_email_claim.sql");

test("notifications load only the signed-in user's own inbox", async () => {
  const api = await read("src/residentApi.js");
  const query = api.slice(api.indexOf('.from("resident_notifications")'), api.indexOf(".limit(100)"));
  assert.match(query, /\.eq\("recipient_id", authData\.user\.id\)/);
});

test("a refresh requested while one is running queues a follow-up reload", async () => {
  const app = await read("src/App.jsx");
  const body = app.slice(app.indexOf("function refresh()"), app.indexOf("const pending = (async"));
  assert.doesNotMatch(body, /if \(refreshInFlight\.current\) return refreshInFlight\.current;/);
  assert.match(body, /refreshQueued\.current = refreshInFlight\.current\.then\(\(\) => \{ refreshQueued\.current = null; return refresh\(\); \}\)/);
});

test("Login refuses an account whose role differs from the chosen role", async () => {
  const app = await read("src/App.jsx");
  assert.match(app, /loginRole\.current = credentials\.role/);
  assert.match(app, /if \(chosenRole && next\?\.user && next\.user\.role !== chosenRole\) \{\s+roleMismatch\.current = [^\n]+\s+await signOut\(\);/);
  assert.match(app, /else if \(roleMismatch\.current\) setError\(roleMismatch\.current\);/);
});

test("exports keep names of deactivated Residents and Staff", () => {
  const workspace = {
    profiles: [],
    allProfiles: [
      { id: "r1", name: "Graduated Resident", pgy: 4, active: false },
      { id: "s1", name: "Retired Staff", pgy: null, active: false },
    ],
    requests: [],
    assessments: [{ id: "a1", resident_id: "r1", evaluator_id: "s1", resident_pgy: 4, assessment_date: "2026-01-02" }],
  };
  const [record] = buildExportRecords(workspace);
  assert.equal(record.residentName, "Graduated Resident");
  assert.equal(record.staffName, "Retired Staff");
});

test("workspace loads every profile but pickers get only active ones", async () => {
  const api = await read("src/residentApi.js");
  const query = api.slice(api.indexOf('.select("user_id,full_name,email,pgy,active")'), api.indexOf('.from("resident_evaluator_assignments")'));
  assert.doesNotMatch(query, /\.eq\("active", true\)/);
  assert.match(api, /profiles: \(profiles \|\| \[\]\)\.filter\(\(row\) => row\.active\)\.map\(mapProfile\)/);
  assert.match(api, /allProfiles: \[\.\.\.\(profiles \|\| \[\]\)\.map\(mapProfile\), \.\.\.counterpartProfiles\]/);
});

test("email worker claims a delivery atomically and never silently drops 'sent'", async () => {
  const fn = await read("supabase/functions/resident-assessment-notifier/index.ts");
  assert.match(fn, /admin\.rpc\("claim_resident_assessment_email_delivery"/);
  assert.doesNotMatch(fn, /\.upsert\(attempt, \{ onConflict: "request_id,delivery_type" \}\)/);
  const markSent = fn.slice(fn.indexOf("async function markSent"), fn.indexOf("Deno.serve"));
  assert.match(markSent, /const \{ error \} = await admin\.from\("resident_assessment_email_deliveries"\)\.update\(update\)/);
  assert.match(markSent, /throw new MarkSentError/);
  assert.match(fn, /if \(error instanceof MarkSentError\) throw error;/);
  assert.match(fn, /if \(Date\.now\(\) - startedAt > RUN_TIME_BUDGET_MS\) break;/);
  const inactive = fn.slice(fn.indexOf("if (!directory?.active"), fn.indexOf("throw new Error(reason)"));
  assert.match(inactive, /update\(\{ status: "failed", error_message: reason \}\)/, "inactive Staff must record a failed row so the backoff applies");
  assert.match(fn, /row\?\.status === "failed" && Date\.now\(\) - new Date\(row\.attempted_at\)\.getTime\(\) < FAILED_RETRY_AFTER_MS/);
  const sql = await migration();
  const claim = sql.slice(sql.indexOf("function public.claim_resident_assessment_email_delivery"));
  assert.match(claim, /where delivery\.status = 'failed'\s+or \(delivery\.status = 'sending'\s+and delivery\.attempted_at < clock_timestamp\(\) - interval '10 minutes'\)/);
  assert.match(claim, /revoke all on function public\.claim_resident_assessment_email_delivery\(uuid, text, text\) from public, anon, authenticated;/);
  assert.match(claim, /grant execute on function public\.claim_resident_assessment_email_delivery\(uuid, text, text\) to service_role;/);
});

test("Resident or Admin can cancel a pending request", async () => {
  const sql = await migration();
  const fn = sql.slice(sql.indexOf("function public.cancel_resident_assessment_request"), sql.indexOf("-- 2)"));
  assert.match(fn, /security definer\s+set search_path = ''/);
  assert.match(fn, /for update;/);
  assert.match(fn, /v_request\.resident_id <> \(select auth\.uid\(\)\)\s+and not \(select private\.resident_role_is\('admin'\)\)/);
  assert.match(fn, /if v_request\.status <> 'pending' then/);
  assert.match(sql, /revoke all on function public\.cancel_resident_assessment_request\(uuid\) from public, anon;/);
  const api = await read("src/residentApi.js");
  assert.match(api, /rpc\("cancel_resident_assessment_request", \{\s+p_request_id: requestId,/);
  const views = await read("src/features/ResidentAssessmentViews.jsx");
  assert.match(views, /request\.status === "pending" && \(/);
  const platform = await read("src/features/ResidentPlatform.jsx");
  assert.match(platform, /<ResidentRequestHistory workspace=\{workspace\} onRefresh=\{onRefresh\} \/>/);
});

test("admin invite and assignment forms ignore a second click while busy", async () => {
  const platform = await read("src/features/ResidentPlatform.jsx");
  for (const name of ["addAccount", "assign"]) {
    const body = platform.slice(platform.indexOf(`async function ${name}(event)`));
    assert.match(body.slice(0, 200), /if \(formBusyRef\.current\) return;/, name);
  }
  assert.match(platform, /formBusy === "account" \? "กำลังส่งคำเชิญ…" : "ส่งคำเชิญ"/);
});

test("assessment history PGY filter matches the export center rule", async () => {
  const views = await read("src/features/ResidentAssessmentViews.jsx");
  assert.match(views, /String\(item\.resident_pgy\) === pgy/);
  assert.match(views, /\.filter\(matchesPgy\)/);
});

test("exam participants are pre-selected once, not after every refresh", async () => {
  const exams = await read("src/features/ResidentExams.jsx");
  assert.match(exams, /if \(participantsFilled\.current \|\| !residentIds\.length\) return;/);
});

test("QR lookups ignore stale responses and the camera is stopped even mid-start", async () => {
  const qr = await read("src/features/ResidentQr.jsx");
  assert.match(qr, /const seq = \+\+lookupSeq\.current;/);
  assert.match(qr, /if \(seq !== lookupSeq\.current\) return; setResident\(result\);/);
  assert.match(qr, /function stopScanner\(scanner\)/);
  assert.doesNotMatch(qr, /scannerRef\.current\?\.clear\(\)/);
});

test("round check-in is shared across remounts and old poll errors are ignored", async () => {
  const round = await read("src/features/RoundAttendance.jsx");
  assert.match(round, /const roundCheckIns = new Map\(\);/);
  assert.match(round, /if \(!roundCheckIns\.has\(token\)\) roundCheckIns\.set\(token, checkInRound\(token\)\.finally\(\(\) => roundCheckIns\.delete\(token\)\)\);/);
  assert.match(round, /if \(mounted\.current && seq === refreshSeq\.current\) setError/);
});

test("CME QR storage cleanup failures do not fail a saved change", async () => {
  const api = await read("src/residentApi.js");
  const clear = api.slice(api.indexOf("export async function clearRoundCmeQr"), api.indexOf("export async function openRound"));
  assert.match(clear, /if \(storagePath\) await removeCmeQrImage\(storagePath\);/);
  assert.doesNotMatch(clear, /fail\(removeError\)/);
  const upload = api.slice(api.indexOf("export async function uploadRoundCmeQr"), api.indexOf("async function removeCmeQrImage"));
  const tryBlock = upload.slice(upload.indexOf("try {"), upload.indexOf("} catch"));
  assert.doesNotMatch(tryBlock, /remove\(\[previousPath\]\)/, "old image cleanup must not run inside the rollback try");
});

test("auth email hook sends both email-change confirmations and the reauth code", async () => {
  const fn = await read("supabase/functions/auth-send-email-gmail/index.ts");
  assert.match(fn, /to: user\.new_email, \.\.\.emailContent\(action, verifyUrl\(emailData\.token_hash\)\)/);
  assert.match(fn, /to: user\.email, \.\.\.emailContent\("email_change_current", verifyUrl\(emailData\.token_hash_new\)\)/);
  assert.match(fn, /to: user\.email, \.\.\.emailContent\(action, "", emailData\.token\)/);
  assert.match(fn, /htmlEscape\(code\)/);
});

test("Residents cannot read Staff profile rows; they get Staff names without email", async () => {
  const sql = await read("supabase/migrations/20260929100000_hide_staff_email_from_residents.sql");
  const request = sql.slice(sql.indexOf("create policy resident_profiles_request_party_select"), sql.indexOf("drop policy if exists resident_profiles_assessment_party_select"));
  assert.match(request, /request\.staff_id = \(select auth\.uid\(\)\)\s+and request\.resident_id = user_id/);
  assert.doesNotMatch(request, /request\.resident_id = \(select auth\.uid\(\)\)/);
  const assessment = sql.slice(sql.indexOf("create policy resident_profiles_assessment_party_select"), sql.indexOf("create or replace function"));
  assert.match(assessment, /assessment\.evaluator_id = \(select auth\.uid\(\)\)\s+and assessment\.resident_id = user_id/);
  assert.doesNotMatch(assessment, /assessment\.resident_id = \(select auth\.uid\(\)\)/);
  const fn = sql.slice(sql.indexOf("function public.list_resident_counterpart_staff"));
  assert.match(fn, /returns table \(user_id uuid, full_name text\)/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("revoke")), /email|qr_token/);
  assert.match(fn, /security definer\s+set search_path = ''/);
  const api = await read("src/residentApi.js");
  assert.match(api, /role\.role === "resident"\s+\? supabase\.rpc\("list_resident_counterpart_staff"\)/);
  assert.match(api, /mapProfile\(\{ \.\.\.row, email: null, pgy: null, active: false \}\)/);
  assert.doesNotMatch(api, /fail\(counterpartStaffError\)/, "a missing function must not block the whole workspace");
});
