import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("CME QR remains private, Admin-controlled, and separate from attendance tokens", async () => {
  const [migration, api, roundUi] = await Promise.all([
    read("../supabase/migrations/20260923081402_resident_cme_historical_assessments_and_exams.sql"),
    read("../src/residentApi.js"),
    read("../src/features/RoundAttendance.jsx"),
  ]);
  assert.match(migration, /'resident-round-cme-qr'/);
  assert.match(migration, /public\s*=\s*false/);
  assert.match(migration, /array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(migration, /create table public\.resident_round_cme_qr/);
  assert.match(migration, /session_id uuid primary key references public\.resident_round_sessions/);
  assert.match(migration, /create or replace function public\.set_resident_round_cme_qr/);
  assert.match(migration, /Open today''s meeting session before adding a CME QR/);
  assert.match(migration, /revoke all on function public\.set_resident_round_cme_qr\(uuid, text\) from public, anon/);
  assert.match(api, /const CME_QR_BUCKET = "resident-round-cme-qr"/);
  assert.match(api, /createSignedUrl\(storagePath, 10 \* 60\)/);
  assert.match(roundUi, /QR CME สำหรับฉายในห้องประชุม/);
  assert.match(roundUi, /ระบบนี้ไม่เก็บข้อมูลการสแกน CME/);
});

test("historical EPA/PBA import validates a selected Staff evaluator and records the importing Admin", async () => {
  const [migration, api, platform] = await Promise.all([
    read("../supabase/migrations/20260923081402_resident_cme_historical_assessments_and_exams.sql"),
    read("../src/residentApi.js"),
    read("../src/features/ResidentPlatform.jsx"),
  ]);
  assert.match(migration, /add column if not exists recorded_by uuid/);
  assert.match(migration, /add column if not exists recorded_at timestamptz/);
  assert.match(migration, /create or replace function public\.admin_record_historical_resident_assessment/);
  assert.match(migration, /Selected evaluator must be an active registered Staff account/);
  assert.match(migration, /Every active criterion requires one score/);
  assert.match(migration, /recorded_by, recorded_at/);
  assert.match(migration, /revoke all on function public\.admin_record_historical_resident_assessment[\s\S]*from public, anon/);
  assert.match(api, /admin_record_historical_resident_assessment/);
  assert.match(platform, /บันทึก EPA\/PBA ย้อนหลัง/);
  assert.match(platform, /Staff ผู้ประเมินเดิม/);
});

test("exam records are Draft-first and only publish once every participant result is complete", async () => {
  const [migration, api, exams, platform] = await Promise.all([
    read("../supabase/migrations/20260923081402_resident_cme_historical_assessments_and_exams.sql"),
    read("../src/residentApi.js"),
    read("../src/features/ResidentExams.jsx"),
    read("../src/features/ResidentPlatform.jsx"),
  ]);
  assert.match(migration, /create table public\.resident_exam_events/);
  assert.match(migration, /exam_type in \('xray_anatomy', 'mcq'\)/);
  assert.match(migration, /status text not null default 'draft'/);
  assert.match(migration, /create table public\.resident_exam_participants/);
  assert.match(migration, /create table public\.resident_exam_parts/);
  assert.match(migration, /create table public\.resident_exam_results/);
  assert.match(migration, /create policy resident_exam_results_visible/);
  assert.match(migration, /event\.status = 'published'/);
  assert.match(migration, /Complete every scheduled Resident result before publishing/);
  assert.match(migration, /create or replace function public\.list_resident_exam_records/);
  assert.match(migration, /revoke all on function public\.list_resident_exam_records\(\) from public, anon/);
  assert.match(api, /create_resident_exam_event/);
  assert.match(api, /save_resident_exam_results/);
  assert.match(api, /set_resident_exam_publication/);
  assert.match(exams, /X-ray & Anatomy/);
  assert.match(exams, /เผยแพร่ผลสอบ/);
  assert.match(platform, /\["exams",/);
});
