import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/20261015100000_exam_mpl_schema.sql", import.meta.url), "utf8");

test("migration A adds the standards, snapshot and audit columns without dropping anything", () => {
  assert.doesNotMatch(sql, /drop table|drop column|truncate/i);
  assert.match(sql, /create table public\.resident_exam_standards/);
  assert.match(sql, /create table public\.resident_exam_standard_mpl/);
  assert.match(sql, /create table public\.resident_exam_mpl/);
  assert.match(sql, /create unique index resident_exam_standards_type_name_unique\s+on public\.resident_exam_standards\(exam_type, lower\(part_name\)\)/);
  assert.match(sql, /pgy smallint not null check \(pgy between 1 and 4\)/);
  assert.match(sql, /add column if not exists scoring_mode text not null default 'manual'\s+check \(scoring_mode in \('manual', 'mpl'\)\)/);
  assert.match(sql, /add column if not exists max_score numeric\(10,2\)/);
  assert.match(sql, /add column if not exists pgy_at_exam smallint/);
  assert.match(sql, /alter column outcome drop not null/);
  assert.match(sql, /add column if not exists outcome_source text not null default 'manual'\s+check \(outcome_source in \('computed', 'manual'\)\)/);
});

test("snapshot keeps one MPL per event, part and PGY (MCQ has a null part)", () => {
  assert.match(sql, /create unique index resident_exam_mpl_part_unique\s+on public\.resident_exam_mpl\(event_id, part_id, pgy\) where part_id is not null/);
  assert.match(sql, /create unique index resident_exam_mpl_mcq_unique\s+on public\.resident_exam_mpl\(event_id, pgy\) where part_id is null/);
});

test("existing participants are backfilled with their current PGY (1-4 only)", () => {
  assert.match(sql, /update public\.resident_exam_participants participant\s+set pgy_at_exam = profile\.pgy/);
  assert.match(sql, /profile\.pgy between 1 and 4/);
});

test("RLS: standards for Admin/Staff only, snapshot only for published events through the existing helpers", () => {
  for (const table of ["resident_exam_standards", "resident_exam_standard_mpl", "resident_exam_mpl"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /grant select on public\.resident_exam_standards, public\.resident_exam_standard_mpl, public\.resident_exam_mpl to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*resident_exam_(standards|standard_mpl|mpl)/i);
  const policy = sql.slice(sql.indexOf("create policy resident_exam_mpl_visible"), sql.indexOf("create or replace function private.resident_exam_parse_number"));
  assert.match(policy, /private\.resident_exam_is_published\(event_id\)/);
  assert.match(policy, /private\.resident_is_exam_participant\(event_id\)/);
  assert.doesNotMatch(policy, /from public\.resident_exam_/);
});

test("trigger refuses a non-computed outcome on an MPL exam, so the legacy save RPC cannot bypass the rule", () => {
  assert.match(sql, /create trigger resident_exam_results_mode_guard\s+before insert or update on public\.resident_exam_results/);
  assert.match(sql, /e\.scoring_mode = 'mpl'\s*\)\s*and new\.outcome_source <> 'computed'/);
});

test("save_resident_exam_standards is Admin only, replaces the table, and checks 0 <= MPL <= full score", () => {
  const fn = sql.slice(sql.indexOf("create or replace function public.save_resident_exam_standards"));
  assert.match(fn, /private\.resident_role_is\('admin'\)/);
  assert.match(fn, /delete from public\.resident_exam_standards where true/);
  assert.match(fn, /private\.resident_exam_parse_number\(v_text, v_max, 'MPL'\)/);
  assert.match(fn, /Only one MCQ standard is allowed/);
  assert.match(fn, /revoke all on function public\.save_resident_exam_standards\(jsonb\) from public, anon/);
  assert.match(fn, /grant execute on function public\.save_resident_exam_standards\(jsonb\) to authenticated/);
  assert.match(sql, /\^\[0-9\]\{1,8\}\(\\\.\[0-9\]\{1,2\}\)\?\$/);
});
