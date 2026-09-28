import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { roundSessionStatus, shiftIsoDate, validateRoundMeetingDate } from "../src/roundSchedule.js";

const now = new Date("2026-09-28T03:49:00Z"); // 10:49 Bangkok

test("meeting date validation rejects Buddhist-era years", () => {
  assert.match(validateRoundMeetingDate("2569-09-28", now), /พ\.ศ\.[\s\S]*2026/);
  assert.equal(validateRoundMeetingDate("2026-09-28", now), "");
  assert.equal(validateRoundMeetingDate("2027-06-01", now), "");
  assert.match(validateRoundMeetingDate("2028-01-01", now), /ภายใน 1 ปี/);
  assert.match(validateRoundMeetingDate("2024-01-01", now), /ภายใน 1 ปี/);
  assert.match(validateRoundMeetingDate("", now), /เลือกวันที่/);
  assert.equal(shiftIsoDate("2026-09-28", 366), "2027-09-29");
});

test("session status follows the scan window", () => {
  const session = { starts_at: "2026-09-28T10:00:00+07:00", ends_at: "2026-09-28T12:00:00+07:00" };
  assert.equal(roundSessionStatus(session, now.getTime()), "live");
  assert.equal(roundSessionStatus(session, new Date("2026-09-28T02:00:00Z").getTime()), "upcoming");
  assert.equal(roundSessionStatus(session, new Date("2026-09-28T06:00:00Z").getTime()), "ended");
});

test("server rejects out-of-range meeting dates and repairs B.E. rows", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260928040000_validate_round_meeting_date.sql", import.meta.url), "utf8");
  assert.match(sql, /interval '543 years'/);
  assert.match(sql, /before insert or update of meeting_date on public\.resident_round_sessions/i);
  assert.match(sql, /v_today \+ 366/);
});

test("admin UI validates dates and separates ended sessions", async () => {
  const ui = await readFile(new URL("../src/features/RoundAttendance.jsx", import.meta.url), "utf8");
  assert.match(ui, /validateRoundMeetingDate/);
  assert.match(ui, /ใช้ปี ค\.ศ\./);
  assert.match(ui, /ยังไม่ถึงเวลา/);
  assert.match(ui, /กำลังเปิดรับสแกน/);
  assert.match(ui, /รอบที่หมดเวลาแล้ว/);
});
