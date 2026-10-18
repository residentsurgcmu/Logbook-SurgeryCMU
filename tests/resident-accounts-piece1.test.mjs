// RC-02a-1 accounts piece 1 (spec v4): structure checks that run with npm test.
// Behaviour is tested on PostgreSQL by tests/resident-accounts-behavior.sql and tests/resident-accounts-concurrency.sh.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261018090000_accounts_piece1_edit_deactivate.sql";
const fnBody = (sql, name) => {
  const start = sql.indexOf(`FUNCTION ${name}(`) >= 0 ? sql.indexOf(`FUNCTION ${name}(`) : sql.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  const open = sql.indexOf("$", start);
  const tag = sql.slice(open, sql.indexOf("$", open + 1) + 1);
  const close = sql.indexOf(tag, open + tag.length);
  return sql.slice(start, close);
};
const outsideBodies = (sql) => sql.replace(/\$(function)?\$[\s\S]*?\$(function)?\$/g, "");

test("migration: audit table has no foreign keys and no client access", async () => {
  const sql = await read(MIGRATION);
  const table = sql.slice(sql.indexOf("create table if not exists public.resident_account_events"), sql.indexOf("create index if not exists resident_account_events_target_idx"));
  assert.doesNotMatch(table, /references/i);
  assert.match(table, /request_id uuid not null unique/);
  assert.match(table, /reason text check \(reason is null or char_length\(reason\) <= 300\)/);
  assert.match(sql, /alter table public\.resident_account_events enable row level security;/);
  assert.match(sql, /revoke all on table public\.resident_account_events from public, anon, authenticated;/);
});

test("migration: one account-active rule (role.active AND profile.active) used by the existing checks", async () => {
  const sql = await read(MIGRATION);
  assert.match(fnBody(sql, "private.resident_account_active"), /r\.active and p\.active/);
  assert.match(fnBody(sql, "private.resident_role_is"), /r\.role = expected_role and r\.active and p\.active/);
  assert.match(fnBody(sql, "private.resident_can_evaluate"), /resident_account_active\(\)\) and exists/);
  for (const name of ["public.list_registered_resident_staff", "public.list_resident_counterpart_staff"]) {
    assert.match(fnBody(sql, name), /if not \(select private\.resident_account_active\(\)\) then/, name);
  }
  assert.match(fnBody(sql, "public.resolve_resident_assessment_qr"), /if not \(select private\.resident_role_is\('staff'\)\) then/);
});

test("migration: lock order — account rows before request rows on every path (spec 2.2 item 3)", async () => {
  const sql = await read(MIGRATION);
  const submit = fnBody(sql, "public.submit_resident_assessment_request");
  const lock = submit.indexOf("for share");
  assert.ok(lock > 0 && lock < submit.indexOf("Selected Staff must match an active registered Staff account"), "submit locks both accounts before checking the Staff");
  assert.match(submit, /lock_role\.user_id in \(\(select auth\.uid\(\)\), p_staff_id\)\s+order by lock_role\.user_id\s+for share/);
  const complete = fnBody(sql, "public.complete_resident_assessment_request");
  assert.ok(complete.indexOf("for share") < complete.indexOf("for update"), "evaluate: account rows, then the request row");
  assert.match(complete, /lock_role\.user_id in \(\(select auth\.uid\(\)\), v_request\.resident_id\)/);
  const cancel = fnBody(sql, "public.cancel_resident_assessment_request");
  assert.ok(cancel.indexOf("for share") < cancel.indexOf("for update"), "cancel: actor row, then the request row");
  assert.match(cancel, /v_request\.resident_id = \(select auth\.uid\(\)\) and \(select private\.resident_account_active\(\)\)/);
  const setActive = fnBody(sql, "public.admin_set_account_active");
  const order = ["pg_advisory_xact_lock(hashtextextended('resident_accounts', 0))", "private.resident_account_lock(v_actor, p_user_id)", "resident_role_is('admin')", "for update"].map((s) => setActive.indexOf(s));
  assert.ok(order.every((n) => n > 0) && order.every((n, i) => i === 0 || n > order[i - 1]), "deactivate: global lock, account rows, actor check, request rows");
  assert.match(setActive, /PREVIEW_CHANGED/);
  assert.match(setActive, /LAST_ADMIN/);
  assert.match(setActive, /SELF_ACTION_FORBIDDEN/);
  assert.doesNotMatch(setActive, /auth\.admin|ban/i, "no Auth step in piece 1 (D-022)");
});

test("migration: deactivation cancels like the existing cancel and keeps assignments (D-009, D-021)", async () => {
  const sql = await read(MIGRATION);
  const setActive = fnBody(sql, "public.admin_set_account_active");
  assert.match(setActive, /update public\.resident_assessment_requests set status = 'cancelled' where id = any \(v_pending\)/);
  assert.match(setActive, /notification_type in \('assessment_requested', 'assessment_reminder'\)/);
  assert.doesNotMatch(setActive, /resident_evaluator_assignments\s+set/);
  assert.match(setActive, /'kept_assignment_count'/);
});

test("migration: edit touches only the fields sent (G0 B-R01: no automatic PGY clearing); PGY needs a reason", async () => {
  const sql = await read(MIGRATION);
  const edit = fnBody(sql, "public.admin_update_account");
  assert.match(edit, /v_key not in \('full_name', 'pgy', 'unit_name', 'admin_tag'\)/);
  assert.match(edit, /ACCOUNT_CONFLICT/);
  assert.match(edit, /resident_account_reason\(p_reason, v_role\.role = 'resident' and v_changes \? 'pgy'\)/);
  assert.doesNotMatch(edit, /v_new_pgy := null/, "a non-Resident's PGY is never cleared as a side effect");
  assert.match(edit, /pgy = case when v_changes \? 'pgy' then v_new_pgy else pgy end/);
  assert.match(edit, /full_name = case when v_changes \? 'full_name' then v_new_name else full_name end/);
  assert.match(edit, /update public\.resident_staff_directory\s+set full_name = v_new_name, unit_name = v_new_unit/);
});

test("migration: closes direct writes on the two account tables and changes no data", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /drop policy if exists resident_profiles_admin_write on public\.resident_profiles;/);
  assert.match(sql, /drop policy if exists resident_roles_admin_write on public\.resident_user_roles;/);
  assert.match(sql, /revoke all on table public\.resident_profiles from public, anon, authenticated;/);
  assert.match(sql, /revoke all on table public\.resident_user_roles from public, anon, authenticated;/);
  assert.match(sql, /grant select on table public\.resident_profiles to authenticated;/);
  assert.match(sql, /grant select on table public\.resident_user_roles to authenticated;/);
  assert.doesNotMatch(sql, /resident_evaluator_assignments from/, "assignment privileges are not part of piece 1");
  const top = outsideBodies(sql);
  const writes = top.match(/^\s*(insert into|update|delete from)\s+public\.\w+/gim) || [];
  assert.deepEqual(writes.map((w) => w.trim()), ["insert into public.resident_maintenance_pause"], "the only data written is the pause switch");
  assert.doesNotMatch(top, /add constraint|unique \(email\)/i, "email constraints already exist on production; none added");
});

test("migration: nothing about exams, PGY promotion or attendance rows (D-014, D-018, D-020)", async () => {
  const sql = (await read(MIGRATION)).replace(/--.*$/gm, ""); // the header comment names what is NOT touched
  assert.doesNotMatch(sql, /resident_exam_|pgy_at_exam|\bmpl\b/i);
  assert.doesNotMatch(sql, /resident_round_attendance/);
  assert.doesNotMatch(sql, /promot/i);
});

test("migration: new RPCs are Admin-only from the browser; the provision RPC is service-role only", async () => {
  const sql = await read(MIGRATION);
  for (const sig of ["admin_list_accounts()", "admin_preview_account_action(uuid, text)", "admin_update_account(uuid, timestamptz, uuid, jsonb, text)",
    "admin_set_account_active(uuid, boolean, timestamptz, uuid, text, jsonb)", "admin_list_account_events(uuid)"]) {
    assert.ok(sql.includes(`revoke all on function public.${sig} from public, anon;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated;`), sig);
  }
  assert.ok(sql.includes("revoke all on function public.admin_provision_account_internal(uuid, uuid, text, text, text, smallint, text) from public, anon, authenticated;"));
  assert.ok(sql.includes("grant execute on function public.admin_provision_account_internal(uuid, uuid, text, text, text, smallint, text) to service_role;"));
  for (const name of ["admin_list_accounts", "admin_preview_account_action", "admin_list_account_events"]) {
    assert.match(fnBody(sql, `public.${name}`), /resident_role_is\('admin'\)/, name);
  }
  assert.match(fnBody(sql, "public.admin_provision_account_internal"), /resident_account_is_active_admin\(p_actor_id\)/);
});

test("Edge resident-admin: caller needs both flags; never upserts; existing account => 409 ACCOUNT_EXISTS before any e-mail", async () => {
  const fn = await read("supabase/functions/resident-admin/index.ts");
  assert.match(fn, /!callerRole\?\.active \|\| !callerProfile\?\.active \|\| callerRole\.role !== "admin"/);
  assert.doesNotMatch(fn, /\.upsert\(/);
  assert.doesNotMatch(fn, /from\("resident_(profiles|user_roles)"\)\.(insert|update)/);
  assert.match(fn, /json\(\{ error: "ACCOUNT_EXISTS", code: "ACCOUNT_EXISTS", userId: userId \|\| null \}, 409\)/);
  const provision = fn.slice(fn.indexOf('if (action !== "provision_account")'));
  assert.ok(provision.indexOf("if (profileId) return accountExists(profileId);") < provision.indexOf("inviteOrLinkUser("));
  const invite = fn.slice(fn.indexOf('if (action === "invite_staff") {'), fn.indexOf('if (action !== "provision_account")'));
  assert.ok(invite.indexOf("if (profileId) return accountExists(profileId);") < invite.indexOf("inviteOrLinkUser("));
  assert.match(fn, /action === "delete_assessment"/, "existing delete path kept");
});

test("Edge notifier: a deactivated account cannot trigger e-mail", async () => {
  const fn = await read("supabase/functions/resident-assessment-notifier/index.ts");
  const i = fn.indexOf('payload.action !== "deliver_initial"');
  const block = fn.slice(i);
  assert.ok(block.indexOf("!callerRole?.active || !callerProfile?.active") < block.indexOf('deliver(admin, payload.requestId, "initial")'));
});

test("add-account page shows ACCOUNT_EXISTS in Thai", async () => {
  const api = await read("src/residentApi.js");
  assert.match(api, /export const ACCOUNT_EXISTS_MESSAGE =\s+"อีเมลนี้มีบัญชีในระบบอยู่แล้ว ระบบจึงไม่ได้เปลี่ยนแปลงบัญชีเดิม";/);
  assert.match(api, /if \(payload\.code === "ACCOUNT_EXISTS"\) return new Error\(ACCOUNT_EXISTS_MESSAGE\);/);
});

test("database test scripts refuse to run on a database with real data", async () => {
  const behaviour = await read("tests/resident-accounts-behavior.sql");
  const concurrency = await read("tests/resident-accounts-concurrency.sh");
  assert.match(behaviour, /Refusing to run: this database already has Resident data/);
  assert.match(behaviour, /\nrollback;\s*$/);
  assert.match(concurrency, /Refusing to run: this database already has Resident data/);
  assert.doesNotMatch(behaviour + concurrency, /@(gmail|cmu|hotmail|outlook)\./i, "no real e-mail addresses");
});

test("release safety (G0 B-R02): the migration pauses every account write until the owner resumes", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /set lock_timeout = '15s';/);
  for (const t of ["resident_profiles", "resident_user_roles", "resident_staff_directory"]) {
    assert.match(sql, new RegExp(`create trigger ${t}_pause_guard before insert or update or delete on public\\.${t}`), t);
  }
  assert.match(sql, /before truncate on public\.resident_profiles/);
  assert.match(sql, /values \('accounts', true,/, "starts paused inside the migration transaction");
  assert.ok(sql.indexOf("values ('accounts', true,") < sql.indexOf("drop policy if exists resident_profiles_admin_write"), "pause is on before the privileges change");
  const pauseOn = await read("supabase/manual/rc02a1_pause_on.sql");
  assert.match(pauseOn, /lock table public\.resident_profiles, public\.resident_user_roles, public\.resident_staff_directory in share mode;/, "waits for running writes");
  const rollback = await read("supabase/manual/rc02a1_rollback.sql");
  assert.match(rollback, /Pause account writes first/);
  assert.doesNotMatch(rollback, /drop (table|trigger|function) if exists [\w.]*pause/i, "rollback keeps the pause on");
  const post = await read("supabase/manual/rc02a1_postdeploy_check.sql");
  assert.doesNotMatch(post, /= 5 from public\.resident_user_roles|1\/5\/1/, "no fixed account numbers");
  assert.match(post, /snapshot = private\.resident_account_counts\(\)/);
  assert.match(post, /has_column_privilege\(r\.rolname, a\.attrelid, a\.attnum, p\)/);
});

test("Edge resident-admin checks the pause before any invitation e-mail", async () => {
  const fn = await read("supabase/functions/resident-admin/index.ts");
  const invite = fn.slice(fn.indexOf('if (action === "invite_staff") {'), fn.indexOf('if (action !== "provision_account")'));
  assert.ok(invite.indexOf("if (await isPaused()) return accountsPaused();") < invite.indexOf("inviteOrLinkUser("));
  const provision = fn.slice(fn.indexOf('if (action !== "provision_account")'));
  assert.ok(provision.indexOf("if (await isPaused()) return accountsPaused();") < provision.indexOf("inviteOrLinkUser("));
  assert.match(fn, /json\(\{ error: PAUSED_MESSAGE, code: "ACCOUNTS_PAUSED" \}, 503\)/);
  const api = await read("src/residentApi.js");
  assert.match(api, /if \(payload\.code === "ACCOUNTS_PAUSED"\) return new Error\(ACCOUNTS_PAUSED_MESSAGE\);/);
});

test("v3 (Option A): client roles can never write the account tables directly, paused or not", async () => {
  const sql = await read(MIGRATION);
  const guard = fnBody(sql, "private.resident_refuse_account_write_when_paused");
  assert.match(guard, /security invoker/, "runs as the caller so it can see service_role");
  assert.doesNotMatch(guard, /security definer/);
  assert.match(guard, /current_user in \('anon', 'authenticated', 'authenticator', 'service_role'\)/);
  assert.ok(guard.indexOf("ACCOUNTS_PAUSED") < guard.indexOf("ACCOUNT_WRITE_REFUSED"), "pause message first (release probe), then the permanent guard");
  assert.match(sql, /block_client_direct_writes boolean not null default true/);
  assert.match(fnBody(sql, "public.resident_account_direct_writes_blocked"), /coalesce\(\(select block_client_direct_writes from public\.resident_maintenance_pause where scope = 'accounts'\), true\)/);
  assert.ok(sql.includes("grant execute on function public.resident_account_direct_writes_blocked() to authenticated, service_role;"));
  const rollback = await read("supabase/manual/rc02a1_rollback.sql");
  assert.match(rollback, /update public\.resident_maintenance_pause set block_client_direct_writes = false/, "rollback lets the restored old Edge work");
  const post = await read("supabase/manual/rc02a1_postdeploy_check.sql");
  assert.match(post, /'A4 direct writes by client roles/);
  const fn = await read("supabase/functions/resident-admin/index.ts");
  assert.doesNotMatch(fn, /from\("resident_(profiles|user_roles|staff_directory)"\)\s*\.(insert|update|upsert|delete)\(/, "new Edge never writes the account tables directly");
});
