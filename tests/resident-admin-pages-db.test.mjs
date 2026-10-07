import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/20261008090000_admin_attempt_pages.sql", import.meta.url), "utf8");
const behaviour = await readFile(new URL("./resident-attempt-rules-behavior.sql", import.meta.url), "utf8");

test("Admin pages migration: additive, one named capability, both functions gated and closed to logged-out visitors", () => {
  assert.match(sql, /add column if not exists admin_tag text/);
  assert.match(sql, /char_length\(btrim\(admin_tag\)\) between 1 and 40/);
  assert.match(sql, /function private\.resident_can_view_cohort_progress\(\)[\s\S]*resident_role_is\('admin'\)/);
  for (const statement of [
    "revoke all on function private.resident_can_view_cohort_progress() from public, anon;",
    "revoke all on function public.admin_list_attempt_grants(uuid) from public, anon;",
    "revoke all on function public.admin_list_epa_pba_progress() from public, anon;",
  ])
    assert.ok(sql.includes(statement), statement);
  assert.equal((sql.match(/Active Admin account required/g) || []).length, 2, "both data functions check the capability");
  // The only DROP allowed is re-creating this release's own export function (its output gained columns after the first practice run).
  const withoutOwnDrop = sql.replace("drop function if exists public.admin_list_epa_pba_progress();", "").replace(/--[^\n]*/g, "");
  assert.doesNotMatch(withoutOwnDrop, /\b(drop|truncate|delete\s+from|alter\s+table\s+public\.resident_assessment)/i, "nothing existing is dropped or deleted");
  assert.doesNotMatch(sql, /create or replace function public\.(submit_resident_assessment_request|get_my_epa_progress|list_registered_resident_staff)/, "functions of release pieces 1-2 are not touched");
});

test("Admin pages export: no criterion scores and no assessor names are returned", () => {
  const exportFn = sql.slice(sql.indexOf("function public.admin_list_epa_pba_progress()"));
  assert.doesNotMatch(exportFn.split("revoke all")[0].split("returns table")[1].split("language")[0], /score|staff|evaluator|assessor|email|phone/i);
});

test("Admin pages behaviour tests exist: cross-check with each Resident's own numbers, real roles, the label", () => {
  for (const label of ["R1 ", "R7 ", "S3 ", "S4 ", "S6 ", "T1 ", "T4 "]) assert.ok(behaviour.includes(`'${label}`), label);
});
