import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createRoundAttendancePdf, filterRoundAttendance, roundSessionsInDateRange } from "../src/roundAttendanceExport.js";

const sessions = [
  { id: "late", meeting_date: "2026-09-26" },
  { id: "early", meeting_date: "2026-09-05" },
  { id: "middle", meeting_date: "2026-09-12" },
];

test("MM & Grand Round PDF date range is inclusive and ordered by meeting date", () => {
  assert.deepEqual(
    roundSessionsInDateRange(sessions, "2026-09-12", "2026-09-26").map((session) => session.id),
    ["middle", "late"],
  );
  assert.deepEqual(
    roundSessionsInDateRange(sessions, "2026-09-05", "2026-09-05").map((session) => session.id),
    ["early"],
  );
});

test("MM & Grand Round filters combine one Resident and PGY while excluding Staff from a PGY", () => {
  const attendance = [
    { user_id: "r1", role_at_check_in: "resident", resident_profiles: { pgy: 1 } },
    { user_id: "r2", role_at_check_in: "resident", resident_profiles: { pgy: 2 } },
    { user_id: "s1", role_at_check_in: "staff", resident_profiles: { pgy: 1 } },
  ];
  assert.deepEqual(filterRoundAttendance(attendance, { residentId: "r1", pgy: 1 }).map((row) => row.user_id), ["r1"]);
  assert.deepEqual(filterRoundAttendance(attendance, { pgy: 2 }).map((row) => row.user_id), ["r2"]);
});

test("Admin can download combined or one-PDF-per-date MM & Grand Round reports", async () => {
  const [ui, exporter] = await Promise.all([
    readFile(new URL("../src/features/RoundAttendance.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/roundAttendanceExport.js", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /ดาวน์โหลด PDF รวม/);
  assert.match(ui, /ดาวน์โหลด PDF แยกวัน/);
  assert.match(ui, /type="date"/);
  assert.match(ui, /exportRoundAttendancePdf/);
  assert.match(exporter, /splitByDate/);
  assert.match(exporter, /application\/pdf/);
  assert.match(exporter, /NotoSansThai\.ttf/);
  assert.match(ui, /Timestamp scan QR \(Asia\/Bangkok\)/);
  assert.match(exporter, /Timestamp scan QR \(Asia\/Bangkok\)/);
});

test("combined MM & Grand Round report builds a readable PDF with Thai font and per-date sections", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, "/fonts/NotoSansThai.ttf");
    return new Response(await readFile(new URL("../public/fonts/NotoSansThai.ttf", import.meta.url)));
  };
  try {
    const bytes = await createRoundAttendancePdf(
      [
        { id: "one", meeting_date: "2026-09-05" },
        { id: "two", meeting_date: "2026-09-12" },
      ],
      [
        { session_id: "one", user_id: "r1", role_at_check_in: "resident", checked_in_at: "2026-09-05T02:05:00Z", resident_profiles: { full_name: "นพ. ทดสอบ หนึ่ง", email: "one@example.com", pgy: 1 } },
        { session_id: "two", user_id: "s1", role_at_check_in: "staff", checked_in_at: "2026-09-12T02:10:00Z", resident_profiles: { full_name: "อ. ทดสอบ สอง", email: "two@example.com" } },
      ],
      "ช่วงวันที่ทดสอบ",
    );
    assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF");
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Admin attendance loading paginates session history rather than truncating it at 100 days", async () => {
  const api = await readFile(new URL("../src/residentApi.js", import.meta.url), "utf8");
  const loadBlock = api.slice(api.indexOf("export async function loadRoundAdminData"), api.indexOf("export async function openRound"));
  assert.match(loadBlock, /resident_round_sessions[\s\S]*?\.range\(offset, offset \+ pageSize - 1\)/);
  assert.doesNotMatch(loadBlock, /\.limit\(100\)/);
});

test("QR check-in persists the first server timestamp instead of a browser-supplied value", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260920102939_mm_grand_round_attendance.sql", import.meta.url), "utf8");
  assert.match(migration, /v_now timestamptz := clock_timestamp\(\)/);
  assert.match(migration, /values \(v_session_id, auth\.uid\(\), v_role, v_now\)/);
  assert.match(migration, /on conflict \(session_id, user_id\) do nothing/);
  assert.match(migration, /select a\.checked_in_at into v_checked_at/);
});
