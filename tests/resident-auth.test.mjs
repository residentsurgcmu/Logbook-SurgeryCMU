import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hasPasswordRecoveryLink, isPasswordSetupRoute, normalizeResidentEmail, passwordResetRedirect, residentRoles, shouldLoadResidentWorkspace } from "../src/residentAuth.js";

test("Resident authentication exposes exactly Resident, Staff, and Admin roles", () => {
  assert.deepEqual(residentRoles, ["resident", "staff", "admin"]);
});

test("password reset targets the dedicated SPA route and recognizes invite/recovery links", () => {
  assert.equal(passwordResetRedirect("https://resident-surgery-logbook.vercel.app"), "https://resident-surgery-logbook.vercel.app/reset-password");
  assert.equal(hasPasswordRecoveryLink({ search: "?type=invite", hash: "" }), true);
  assert.equal(hasPasswordRecoveryLink({ search: "", hash: "#access_token=token&type=recovery" }), true);
  assert.equal(hasPasswordRecoveryLink({ search: "", hash: "" }), false);
  assert.equal(isPasswordSetupRoute({ pathname: "/reset-password", search: "", hash: "" }), true);
  assert.equal(shouldLoadResidentWorkspace({ pathname: "/reset-password", search: "", hash: "" }), false);
  assert.equal(shouldLoadResidentWorkspace({ pathname: "/", search: "", hash: "" }), true);
});

test("RLS helpers are executable only while evaluating authenticated policies", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260909093203_fix_resident_rls_helper_permissions.sql", import.meta.url), "utf8");
  assert.match(sql, /grant execute on function private\.resident_role_is\(public\.resident_system_role\) to authenticated/);
  assert.match(sql, /grant execute on function private\.resident_can_evaluate\(uuid\) to authenticated/);
  assert.match(sql, /revoke all on function private\.resident_role_is\(public\.resident_system_role\) from public, anon/);
  assert.match(sql, /revoke all on function private\.resident_can_evaluate\(uuid\) from public, anon/);
  assert.match(sql, /has_function_privilege\('authenticated'/);
  assert.match(sql, /has_function_privilege\('anon'/);
  assert.match(sql, /has_function_privilege\('public'/);
});

test("recovery UI obtains only an Auth session before rendering password setup", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /if \(setupRoute\) getResidentSession\(\)\.then\(startPasswordSetup\)/);
  assert.match(app, /event === "PASSWORD_RECOVERY"[\s\S]*?startPasswordSetup\(session\); return;/);
  assert.doesNotMatch(app, /if \(setupRoute\) refresh\(\)/);
  assert.match(app, /PasswordSetupUnavailable/);
});

test("email normalization is stable before login, invite, and recovery calls", () => {
  assert.equal(normalizeResidentEmail("  Faculty@CMU.AC.TH "), "faculty@cmu.ac.th");
});

test("migration keeps legacy evaluator accounts as Staff and imports the workbook directory", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260908090000_add_resident_staff_directory_and_password_reset.sql", import.meta.url), "utf8");
  assert.match(sql, /rename value 'evaluator' to 'staff'/);
  assert.match(sql, /create table if not exists public\.resident_staff_directory/);
  assert.equal((sql.match(/^  \('/gm) || []).length, 35);
  assert.match(sql, /resident_staff_directory_admin_select/);
  assert.match(sql, /revoke all on table public\.resident_staff_directory from anon, authenticated/);
});

test("Staff invitations are server-authorized and constrained to the imported directory", async () => {
  const functionSource = await readFile(new URL("../supabase/functions/resident-admin/index.ts", import.meta.url), "utf8");
  assert.match(functionSource, /callerRole\.role !== "admin"/);
  assert.match(functionSource, /action === "invite_staff"/);
  assert.match(functionSource, /resident_staff_directory/);
  assert.match(functionSource, /redirectTo: resetPasswordUrl\(\)/);
  assert.match(functionSource, /\["resident", "admin"\]\.includes\(role\)/);
});
