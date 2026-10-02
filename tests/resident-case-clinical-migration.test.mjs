import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = () => readFile(new URL("../supabase/migrations/20261003090000_resident_case_clinical_fields.sql", import.meta.url), "utf8");

test("clinical columns are added with range checks and a sane BP pair", async () => {
  const sql = await read();
  assert.match(sql, /add column if not exists present_illness text not null default '' check \(char_length\(present_illness\) <= 2000\)/);
  assert.match(sql, /add column if not exists physical_exam text not null default '' check \(char_length\(physical_exam\) <= 2000\)/);
  for (const [column, range] of [["bp_systolic", "40 and 300"], ["bp_diastolic", "20 and 200"], ["heart_rate", "20 and 250"], ["resp_rate", "4 and 80"], ["spo2", "50 and 100"]]) {
    assert.match(sql, new RegExp(`add column if not exists ${column} smallint check \\(${column} between ${range}\\)`));
  }
  assert.match(sql, /add column if not exists body_temp numeric\(4,1\) check \(body_temp between 30\.0 and 45\.0\)/);
  assert.match(sql, /check \(bp_systolic is null or bp_diastolic is null or bp_diastolic < bp_systolic\)/);
});

test("old RPC signatures are replaced (no overloads) and new parameters are optional", async () => {
  const sql = await read();
  assert.match(sql, /drop function if exists public\.create_resident_admission_case\(date, smallint, text, text, text, text, text, text, uuid\)/);
  assert.match(sql, /drop function if exists public\.update_resident_admission_case\(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid\)/);
  const create = sql.slice(sql.indexOf("create or replace function public.create_resident_admission_case"));
  assert.match(create, /p_present_illness text default ''/);
  assert.match(create, /p_spo2 smallint default null/);
});

test("an old browser tab cannot wipe clinical fields when it edits a case", async () => {
  const sql = await read();
  const update = sql.slice(sql.indexOf("create or replace function public.update_resident_admission_case"), sql.indexOf("create or replace function public.admin_purge_resident_case_media"));
  assert.match(update, /p_set_clinical boolean default false/);
  assert.match(update, /present_illness = case when p_set_clinical then coalesce\(p_present_illness, ''\) else present_illness end/);
  assert.match(update, /spo2 = case when p_set_clinical then p_spo2 else spo2 end/);
  assert.match(update, /CASE_CONFLICT/);
  assert.match(update, /resident_can_edit_case/);
});

test("only an Admin can permanently delete an image and gets its storage path back", async () => {
  const sql = await read();
  const purge = sql.slice(sql.indexOf("create or replace function public.admin_purge_resident_case_media"));
  assert.match(purge, /returns text/);
  assert.match(purge, /private\.resident_role_is\('admin'\)/);
  assert.match(purge, /delete from public\.resident_case_media where id = p_media_id returning storage_path into v_path/);
  assert.match(sql, /revoke all on function public\.admin_purge_resident_case_media\(uuid\) from public, anon/);
  assert.match(sql, /grant execute on function public\.admin_purge_resident_case_media\(uuid\) to authenticated/);
});

test("every new function is security definer, empty search_path, not callable by anon", async () => {
  const sql = await read();
  const definitions = sql.match(/create or replace function public\.[\s\S]*?\n\$\$;/g) || [];
  assert.equal(definitions.length, 3);
  for (const definition of definitions) assert.match(definition, /security definer set search_path = ''/);
  assert.match(sql, /revoke all on function public\.create_resident_admission_case\(date, smallint, text, text, text, text, text, text, uuid, text, text, smallint, smallint, smallint, smallint, numeric, smallint\) from public, anon/);
  assert.match(sql, /revoke all on function public\.update_resident_admission_case\(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid, boolean, text, text, smallint, smallint, smallint, smallint, numeric, smallint\) from public, anon/);
  assert.match(sql, /^[\s\S]*\nbegin;\n[\s\S]*\ncommit;\s*$/);
});
