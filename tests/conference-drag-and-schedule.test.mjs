import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { moveToIndex, moveId } from "../src/conferenceAgenda.js";
import { embedAddressProblem, embedHost, embedErrorMessage, EMBED_LINKS } from "../src/embedLinkRules.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("moveToIndex puts a case at an exact position, clamps, and ignores unknown ids", () => {
  const ids = ["a", "b", "c", "d", "e"];
  assert.deepEqual(moveToIndex(ids, "a", 3), ["b", "c", "d", "a", "e"]);
  assert.deepEqual(moveToIndex(ids, "e", 0), ["e", "a", "b", "c", "d"]);
  assert.deepEqual(moveToIndex(ids, "c", 2), ids);
  assert.deepEqual(moveToIndex(ids, "b", 99), ["a", "c", "d", "e", "b"]);
  assert.deepEqual(moveToIndex(ids, "b", -5), ["b", "a", "c", "d", "e"]);
  assert.deepEqual(moveToIndex(ids, "zzz", 1), ids);
  assert.deepEqual(ids, ["a", "b", "c", "d", "e"], "input is never mutated");
  // dragging by one place equals the arrow button
  assert.deepEqual(moveToIndex(ids, "c", 1), moveId(ids, "c", -1));
  assert.deepEqual(moveToIndex(ids, "c", 3), moveId(ids, "c", 1));
});

test("outside-page addresses follow the database rule (https only, no spaces, no @, at most 500 characters)", () => {
  for (const ok of ["https://example.org", "https://example.org/dashboard", "https://rota.example.org:8443/admin/all?x=1&y=2#top", "https://a-b.example.org/x", "https://example.org:1/x", "https://example.org:80/x", "https://example.org:65535/x", "https://example.org:10000/", "https://example.org:5000"]) assert.equal(embedAddressProblem(ok), "", ok);
  for (const bad of ["https://example.org:0/x", "https://example.org:65536/x", "https://example.org:99999/", "https://example.org:00080/x", "https://example.org:123456/x", "https://example.org:/x", "https://example.org:80a/x", "", "   ", "http://example.org", "https://user:pass@example.org", "https://exa mple.org", "javascript:alert(1)", "https://", "//example.org", "ftp://example.org", "https://example.org/a b", "https://example.org/@x", `https://example.org/${"a".repeat(600)}`]) assert.notEqual(embedAddressProblem(bad), "", bad);
  assert.equal(embedHost("https://rota.example.org:8443/x"), "rota.example.org");
  assert.equal(embedHost("not a url"), "");
  assert.deepEqual(EMBED_LINKS.map((item) => item.key), ["or_schedule", "rota"]);
  assert.match(embedErrorMessage(new Error("Admin account required")), /Admin/);
});

test("the code repository never contains the outside addresses (it is public); they live in the database", async () => {
  const walk = async (dir) => (await Promise.all((await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })).map(async (entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  }))).flat();
  const files = [...(await walk("src")), ...(await walk("supabase/migrations"))];
  for (const file of files) {
    const text = await read(file);
    assert.doesNotMatch(text, /vercel\.app/, `${file} must not hold an outside page address`);
    assert.doesNotMatch(text, /or-dashboard|surgical-rota/, file);
  }
});

test("the schedule page reads addresses from the database; only Admin can change them", async () => {
  const shell = await read("src/features/ResidentPlatform.jsx");
  assert.match(shell, /import ResidentSchedule from "\.\/ResidentSchedule"/);
  assert.match(shell, /tab === "schedule" \? \(\s*<ResidentSchedule user=\{workspace\.user\}/);
  const ui = await read("src/features/ResidentSchedule.jsx");
  assert.match(ui, /isAdmin && \(?\s*<button[\s\S]*?ตั้งค่าที่อยู่/);
  assert.match(ui, /isAdmin && editing && links/);
  assert.match(ui, /target="_blank" rel="noopener noreferrer"/);
  assert.match(ui, /ยังไม่เปิดใช้งาน/);
  const api = await read("src/residentEmbedLinks.js");
  assert.match(api, /rpc\("set_resident_embed_link"/);
  assert.match(api, /rpc\("clear_resident_embed_link"/);
  assert.doesNotMatch(api, /from\("resident_embed_links"\)\s*\.(insert|update|delete|upsert)/);
});

test("the embed-link migration is additive and locked down: Admin-only writes, members read, nothing anonymous, no addresses inside", async () => {
  const sql = await read("supabase/migrations/20261004120000_resident_embed_links.sql");
  assert.match(sql, /create table if not exists public\.resident_embed_links/);
  assert.match(sql, /link_key in \('or_schedule', 'rota'\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.resident_embed_links from public, anon, authenticated/);
  assert.match(sql, /grant select on table public\.resident_embed_links to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*resident_embed_links/i);
  for (const fn of ["set_resident_embed_link", "clear_resident_embed_link"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`));
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`));
  }
  assert.equal((sql.match(/private\.resident_role_is\('admin'\)/g) || []).length, 2);
  assert.match(sql, /security definer set search_path = ''/);
  assert.doesNotMatch(sql, /drop (table|column)|truncate|delete from public\.resident_(admission|case|conference)/i);
});

test("agenda boxes: drag handle (pointer events, touch-safe), arrow buttons and keyboard as fallbacks, Escape cancels a drag", async () => {
  const ui = await read("src/features/ResidentConference.jsx");
  const css = await read("src/resident.css");
  assert.match(ui, /onPointerDown=\{\(event\) => startDrag\(event, item\.row\.id, position\)\}/);
  assert.match(ui, /onPointerMove=\{moveDrag\}/);
  assert.match(ui, /onPointerUp=\{\(event\) => endDrag\(event, true\)\}/);
  assert.match(ui, /onPointerCancel=\{\(event\) => endDrag\(event, false\)\}/);
  assert.match(ui, /setPointerCapture/);
  assert.match(ui, /moveToIndex\(listedIds, state\.id, over\)/);
  assert.match(ui, /event\.key === "ArrowUp"[\s\S]*event\.key === "ArrowDown"/);
  assert.match(ui, /aria-label=\{`เลื่อน \$\{item\.row\.case_code\} ขึ้น`\}/);
  assert.match(ui, /event\.key === "Escape" && dragRef\.current/);
  assert.match(css, /\.conf-handle \{[^}]*touch-action:none/);
  // the drag only changes the draft; saving still goes through the one save button
  assert.match(ui, /order: listedIds,/);
});

test("arrange dialog: while a save is running nothing can be changed and the dialog cannot be closed", async () => {
  const ui = await read("src/features/ResidentConference.jsx");
  const editor = ui.slice(ui.indexOf("function AgendaEditor"));
  assert.match(editor, /<CaseModal title="จัดรายการประชุม" onClose=\{\(\) => \{ if \(!busy\) onClose\(\); \}\}>/);
  assert.match(editor, /<fieldset className="conf-fieldset" disabled=\{busy\}>/);
  for (const guard of [/const takeOff = \(row\) => \{\s*if \(busy\) return;/, /const putOn = \(row\) => \{\s*if \(busy\) return;/, /const step = \(id, direction\) => \{ if \(!busy\)/, /function startDrag\(event, id, index\) \{\s*if \(busy \|\|/, /function handleKey\(event, id\) \{\s*if \(busy\) return;/]) assert.match(editor, guard);
  assert.match(editor, /กำลังบันทึก… กรุณารอสักครู่ ระหว่างนี้แก้ไขหรือปิดหน้าต่างไม่ได้/);
});

test("the outside-page frame is sandboxed: it can run and sign in, but cannot navigate or take over our page", async () => {
  const ui = await read("src/features/ResidentSchedule.jsx");
  const sandbox = (ui.match(/sandbox="([^"]+)"/) || [])[1] || "";
  assert.ok(sandbox, "iframe has a sandbox attribute");
  for (const allowed of ["allow-scripts", "allow-same-origin", "allow-forms", "allow-popups"]) assert.ok(sandbox.split(" ").includes(allowed), allowed);
  assert.ok(!sandbox.includes("allow-top-navigation"), "must not allow the page to navigate our window");
  assert.ok(!sandbox.includes("allow-top-navigation-by-user-activation") || false);
});

test("the create-with-type migration is additive and locked down", async () => {
  const sql = await read("supabase/migrations/20261004130000_resident_case_create_with_type.sql");
  assert.match(sql, /create or replace function public\.create_resident_admission_case_with_type\(/);
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /p_treatment_type is null or p_treatment_type not in \('conservative', 'operative'\)/);
  assert.match(sql, /revoke all on function public\.create_resident_admission_case_with_type\([^)]*\) from public, anon/);
  assert.match(sql, /grant execute on function public\.create_resident_admission_case_with_type\([^)]*\) to authenticated/);
  assert.doesNotMatch(sql, /drop (function|table|column)|alter table|truncate|delete from/i);
});

test("the original embed-links migration keeps its first rule; the port rule arrives as a NEW upgrade file (not an edit of one that may already be applied)", async () => {
  const first = await read("supabase/migrations/20261004120000_resident_embed_links.sql");
  assert.match(first, /\[0-9\]\{1,5\}/);
  assert.doesNotMatch(first, /6553\[0-5\]/);
  const upgrade = await read("supabase/migrations/20261004140000_resident_embed_links_port_rule.sql");
  assert.equal((upgrade.match(/6553\[0-5\]/g) || []).length, 2, "table rule and Admin function");
  assert.match(upgrade, /drop constraint if exists resident_embed_links_url_check/);
  assert.match(upgrade, /create or replace function public\.set_resident_embed_link\(/);
  assert.match(upgrade, /Run 20261004120000_resident_embed_links\.sql first/);
  assert.match(upgrade, /revoke all on function public\.set_resident_embed_link\(text, text, text\) from public, anon/);
  assert.doesNotMatch(upgrade, /drop (table|column|function)|truncate|delete from|update public\./i);
  assert.doesNotMatch(upgrade, /\[0-9\]\{1,5\}/);
});

test("the update-with-type migration is additive and locked down, and goes through the normal update + Type functions", async () => {
  const sql = await read("supabase/migrations/20261004150000_resident_case_update_with_type.sql");
  assert.match(sql, /create or replace function public\.update_resident_admission_case_with_type\(/);
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /v_updated := public\.update_resident_admission_case\(/);
  assert.match(sql, /return public\.set_resident_case_treatment_type\(p_case_id, p_treatment_type, v_updated\)/);
  assert.match(sql, /p_treatment_type is not null and p_treatment_type not in \('conservative', 'operative'\)/);
  assert.match(sql, /revoke all on function public\.update_resident_admission_case_with_type\([^)]*\) from public, anon/);
  assert.match(sql, /grant execute on function public\.update_resident_admission_case_with_type\([^)]*\) to authenticated/);
  assert.doesNotMatch(sql, /drop (function|table|column)|alter table|truncate|delete from/i);
});

test("the require-Type lock is a separate LAST migration: it only revokes the original create function, checks first, and changes no data", async () => {
  const sql = await read("supabase/migrations/20261004160000_resident_case_require_type_on_create.sql");
  assert.match(sql, /RUN THIS LAST/);
  assert.match(sql, /Run 20261004130000_resident_case_create_with_type\.sql first/);
  assert.match(sql, /p\.proname = 'create_resident_admission_case'/);
  assert.match(sql, /revoke all on function %s from public, anon, authenticated/);
  assert.doesNotMatch(sql, /drop |truncate|delete from|update public\.|insert into|alter table/i);
  assert.doesNotMatch(sql, /create_resident_admission_case_with_type\([^)]*\) from/);   // the new function is never revoked
});
