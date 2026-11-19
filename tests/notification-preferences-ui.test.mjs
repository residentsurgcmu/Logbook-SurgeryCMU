// RC-NOTIF-V1 settings UI: structure checks (behaviour is proven by the SQL/Edge suites; browser widths/keyboard = C0/REL).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("settings use own-account RPCs only (no user id sent) and show server-confirmed values", async () => {
  const api = await read("src/residentApi.js");
  assert.match(api, /supabase\.rpc\("rc_notif_get_my_preferences"\)/);
  assert.match(api, /supabase\.rpc\("rc_notif_save_my_preferences", \{\s*p_expected_version: expectedVersion,\s*p_preferences: changes,\s*\}\)/);
  assert.doesNotMatch(api.slice(api.indexOf("export async function saveMyNotificationPreferences"), api.indexOf("export async function markNotificationRead")), /p_user_id/);
  const ui = await read("src/features/NotificationPreferences.jsx");
  assert.match(ui, /const live = \(gen, forUser, data\) => generation\.current === gen && \(!data \|\| data\.user_id === forUser\);/, "responses of an older generation (logout, A→B→A) or another account are ignored");
  assert.match(ui, /generation\.current \+= 1;/);
  assert.match(ui, /if \(!live\(gen, forUser, data\)\) return;\s+setServer\(data\); setDraft\(data\); setNotice\("บันทึกแล้ว"\)/, "no success message from an older generation");
  assert.match(ui, /RC_NOTIF_VERSION_CONFLICT"\) await load\(gen, forUser, editing\)/, "on conflict the latest version is loaded and the edits are kept");
  assert.match(ui, /setDraft\(keepDraft \? \{ \.\.\.data, \.\.\.keepDraft \} : data\)/);
  assert.match(ui, /เปิดกลับแล้วจะไม่ส่งย้อนหลัง/);
  assert.match(ui, /อีเมลที่ระบบเริ่มส่งไปแล้วอาจยังมาถึง/);
  assert.match(ui, /<fieldset key=\{group\.title\} disabled=\{busy\}>/);
  assert.match(ui, /type="checkbox"/);
  assert.doesNotMatch(ui, /completed_email/, "no e-mail for completed assessments");
  const platform = await read("src/features/ResidentPlatform.jsx");
  assert.match(platform, /<NotificationPreferences user=\{workspace\.user\} \/>/);
});
