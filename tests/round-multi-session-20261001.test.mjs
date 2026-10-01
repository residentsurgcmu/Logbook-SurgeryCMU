import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatRoundTimeRange,
  roundScheduleErrorMessage,
  roundSessionFileKey,
  roundSessionStatus,
} from "../src/roundSchedule.js";
import { roundSessionsInDateRange } from "../src/roundAttendanceExport.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261001090000_round_multi_session_cancel_activity_time.sql";

// 29-9-69 note, item 1: cancel a scheduled activity, several sessions per day.
test("migration lets one date hold several non-overlapping sessions and adds cancel", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /drop constraint if exists resident_round_sessions_meeting_date_key/i);
  assert.doesNotMatch(sql, /on conflict \(meeting_date\)/i);
  assert.match(sql, /add column if not exists cancelled_at timestamptz/i);
  assert.match(sql, /add column if not exists activity_start_time time/i);
  assert.match(sql, /add column if not exists activity_end_time time/i);
  // Overlap is checked in a trigger, serialised with an advisory lock.
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /o\.starts_at < new\.ends_at and o\.ends_at > new\.starts_at/);
  assert.match(sql, /before insert or update of starts_at, ends_at, closed_at, cancelled_at/i);
  // Old signatures are dropped so PostgREST never sees two overloads.
  assert.match(sql, /drop function if exists public\.open_resident_round\(date, time, time\)/i);
  assert.match(sql, /drop function if exists public\.update_resident_round_session\(uuid, date, time, time\)/i);
  // Cancel is admin-only, refuses sessions with attendance and stops scanning.
  const cancel = sql.slice(sql.indexOf("function public.cancel_resident_round_session"));
  assert.match(cancel, /private\.resident_round_role_check|private\.resident_role_is\('admin'\)/);
  assert.match(cancel, /resident_round_attendance/);
  assert.match(cancel, /closed_at = coalesce\(closed_at, clock_timestamp\(\)\)/);
  assert.match(sql, /revoke all on function public\.cancel_resident_round_session\(uuid\) from public, anon/i);
  assert.match(sql, /revoke all on function public\.open_resident_round\(date, time, time, time, time\) from public, anon/i);
  assert.match(sql, /revoke all on function public\.update_resident_round_session\(uuid, date, time, time, time, time\) from public, anon/i);
});

test("admin API passes activity time, orders same-day sessions by start and can cancel", async () => {
  const api = await read("src/residentApi.js");
  assert.match(api, /p_activity_start: activityStart \|\| null/);
  assert.match(api, /p_activity_end: activityEnd \|\| null/);
  assert.match(api, /export async function cancelRoundSession\(sessionId\)/);
  assert.match(api, /rpc\("cancel_resident_round_session"/);
  const load = api.slice(api.indexOf("export async function loadRoundAdminData"), api.indexOf("export async function openRound"));
  assert.match(load, /activity_start_time,activity_end_time/);
  assert.match(load, /closed_at,cancelled_at/);
  assert.match(load, /\.order\("starts_at", \{ ascending: false \}\)/);
});

// Item 2: every scheduled activity must stay visible on the left, with a status.
test("schedule panel lists today's and upcoming sessions with a status, hides cancelled ones", async () => {
  const ui = await read("src/features/RoundAttendance.jsx");
  assert.match(ui, /visibleSessions/);
  assert.match(ui, /cancelRoundSession/);
  assert.match(ui, /ปิดแล้ว/);
  assert.match(ui, /round-status-chip/);
  // Cancelled sessions never reach the attendance dropdown or the PDF range.
  assert.match(ui, /reportSessions/);
  assert.match(ui, /!item\.cancelled_at/);
  // The raw English duplicate-date error is gone from the UI path.
  assert.match(ui, /roundScheduleErrorMessage\(nextError\)/);
});

// Item 3: the summary must state the time of the activity.
test("reports and filenames carry the session time", async () => {
  const [ui, exporter] = await Promise.all([read("src/features/RoundAttendance.jsx"), read("src/roundAttendanceExport.js")]);
  assert.match(exporter, /formatRoundTimeRange\(session\)/);
  assert.match(exporter, /roundSessionFileKey\(session\)/);
  assert.match(ui, /formatRoundTimeRange\(session\)/);
  assert.match(ui, /"เวลา"/);
  assert.match(ui, /activityStart/);
  assert.match(ui, /เวลาจัดกิจกรรม/);
});

// 30-9-69 note, item 1: no camera picker, scan immediately.
test("Staff QR scanner starts the rear camera directly without the library widget", async () => {
  const qr = await read("src/features/ResidentQr.jsx");
  assert.match(qr, /Html5Qrcode\b/);
  assert.doesNotMatch(qr, /Html5QrcodeScanner/);
  assert.doesNotMatch(qr, /rememberLastUsedCamera/);
  assert.match(qr, /facingMode: facing/);
  assert.match(qr, /function stopScanner\(scanner\)/);
  assert.doesNotMatch(qr, /scannerRef\.current\?\.clear\(\)/);
  // Camera opens by itself unless a token came in through a link.
  assert.match(qr, /useState\(!initialToken\)/);
});

test("session status reports closed and cancelled before the scan window", () => {
  const live = { starts_at: "2026-09-30T02:00:00Z", ends_at: "2026-09-30T05:00:00Z" };
  const now = new Date("2026-09-30T03:00:00Z").getTime();
  assert.equal(roundSessionStatus(live, now), "live");
  assert.equal(roundSessionStatus({ ...live, closed_at: "2026-09-30T02:30:00Z" }, now), "closed");
  assert.equal(roundSessionStatus({ ...live, closed_at: "2026-09-30T02:30:00Z", cancelled_at: "2026-09-30T02:31:00Z" }, now), "cancelled");
});

test("time range prefers the activity time and falls back to the scan window (Bangkok)", () => {
  assert.equal(
    formatRoundTimeRange({ activity_start_time: "09:00:00", activity_end_time: "12:00:00", starts_at: "2026-09-30T02:00:00Z", ends_at: "2026-09-30T03:00:00Z" }),
    "เวลา 09:00–12:00 น.",
  );
  assert.equal(
    formatRoundTimeRange({ starts_at: "2026-09-30T02:00:00Z", ends_at: "2026-09-30T03:00:00Z" }),
    "ช่วงสแกน 09:00–10:00 น.",
  );
  assert.equal(formatRoundTimeRange({ meeting_date: "2026-09-30" }), "");
});

test("file keys differ for two sessions on the same day", () => {
  const morning = { meeting_date: "2026-09-30", starts_at: "2026-09-30T02:00:00Z" };
  const noon = { meeting_date: "2026-09-30", starts_at: "2026-09-30T05:30:00Z" };
  assert.equal(roundSessionFileKey(morning), "2026-09-30-0900");
  assert.equal(roundSessionFileKey(noon), "2026-09-30-1230");
  assert.equal(roundSessionFileKey({ meeting_date: "2026-09-30" }), "2026-09-30");
});

test("same-day sessions are ordered by start time inside a date range", () => {
  const sessions = [
    { id: "pm", meeting_date: "2026-09-30", starts_at: "2026-09-30T06:00:00Z" },
    { id: "am", meeting_date: "2026-09-30", starts_at: "2026-09-30T02:00:00Z" },
    { id: "next", meeting_date: "2026-10-01", starts_at: "2026-10-01T02:00:00Z" },
  ];
  assert.deepEqual(roundSessionsInDateRange(sessions, "2026-09-30", "2026-10-01").map((s) => s.id), ["am", "pm", "next"]);
});

test("server messages are shown in Thai", () => {
  assert.match(roundScheduleErrorMessage(new Error("Another scan window overlaps this time")), /ซ้อนกับ/);
  assert.match(roundScheduleErrorMessage(new Error("Cannot cancel a session that already has attendance")), /มีผู้เช็กชื่อแล้ว/);
  assert.match(roundScheduleErrorMessage(new Error("Activity end time must be after start time")), /เวลาสิ้นสุด/);
  assert.equal(roundScheduleErrorMessage(new Error("something else")), "something else");
});
