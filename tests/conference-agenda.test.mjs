import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { agendaCandidates, buildAgenda, canManageConference, conferenceRangeProblem, includedRows, moveId } from "../src/conferenceAgenda.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const mk = (id, date, extra = {}) => ({ id, case_code: `ADM-${id}`, admit_date: date, deleted_at: null, ...extra });
const cases = [mk("a", "2026-09-28"), mk("b", "2026-09-29"), mk("c", "2026-10-01"), mk("old", "2026-09-10"), mk("gone", "2026-09-30", { deleted_at: "x" })];
const range = { from: "2026-09-26", to: "2026-10-02" };

test("cases admitted in the range join automatically, oldest first; deleted cases never do", () => {
  const agenda = buildAgenda({ cases, ...range });
  assert.deepEqual(agenda.map((x) => x.row.id), ["a", "b", "c"]);
  assert.ok(agenda.every((x) => x.source === "auto" && !x.excluded));
});

test("excluded cases stay visible but flagged, and the export list skips them", () => {
  const agenda = buildAgenda({ cases, ...range, excluded: ["b"] });
  assert.deepEqual(agenda.map((x) => [x.row.id, x.excluded]), [["a", false], ["b", true], ["c", false]]);
  assert.deepEqual(includedRows(agenda).map((r) => r.id), ["a", "c"]);
});

test("an older case can be added; added cases are tagged and no longer offered", () => {
  const agenda = buildAgenda({ cases, ...range, added: ["old"] });
  assert.deepEqual(agenda.map((x) => x.row.id), ["old", "a", "b", "c"]);
  assert.equal(agenda[0].source, "added");
  const candidates = agendaCandidates({ cases, ...range });
  assert.deepEqual(candidates.filter((c) => !c.outside).map((c) => c.row.id), ["a", "b", "c"]);
  assert.deepEqual(candidates.filter((c) => c.outside).map((c) => c.row.id), ["old"]);
});

test("explicit order wins; a case that joins later is appended, not shuffled in", () => {
  let ids = moveId(["old", "a", "b", "c"], "c", -1);
  assert.deepEqual(ids, ["old", "a", "c", "b"]);
  assert.deepEqual(buildAgenda({ cases, ...range, added: ["old"], order: ids }).map((x) => x.row.id), ["old", "a", "c", "b"]);
  const more = [...cases, mk("late", "2026-10-02")];
  assert.deepEqual(buildAgenda({ cases: more, ...range, added: ["old"], order: ids }).map((x) => x.row.id), ["old", "a", "c", "b", "late"]);
  assert.deepEqual(moveId(ids, "old", -1), ids);
  assert.deepEqual(moveId(ids, "b", 1), ids);
});

test("widening the range turns an 'added' case into an automatic one", () => {
  const agenda = buildAgenda({ cases, from: "2026-09-01", to: "2026-10-02", added: ["old"] });
  assert.equal(agenda.find((x) => x.row.id === "old").source, "auto");
});

test("the date range check matches the database (start <= end, at most 63 days)", () => {
  assert.equal(conferenceRangeProblem("2026-09-26", "2026-10-02"), "");
  assert.match(conferenceRangeProblem("2026-10-02", "2026-09-26"), /วันเริ่ม/);
  assert.match(conferenceRangeProblem("2026-01-01", "2026-12-31"), /63 วัน/);
  assert.equal(conferenceRangeProblem("2026-08-01", "2026-10-02"), "");   // exactly 62 days apart
  assert.match(conferenceRangeProblem("", "2026-10-02"), /เลือก/);
});

test("any active role may arrange the agenda for now (the database is the real gate)", () => {
  for (const role of ["resident", "staff", "admin"]) assert.equal(canManageConference({ role }), true);
  assert.equal(canManageConference(null), false);
  assert.equal(canManageConference({ role: "guest" }), false);
});

test("the agenda migration is additive and locked down: RLS on, table read-only for members, nothing anonymous", async () => {
  const sql = await read("supabase/migrations/20261004110000_resident_conference_agenda.sql");
  assert.match(sql, /add column if not exists meeting_date date/);
  assert.match(sql, /create table if not exists public\.resident_conference_sessions/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.resident_conference_sessions from public, anon, authenticated/);
  assert.match(sql, /grant select on table public\.resident_conference_sessions to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*resident_conference_sessions/i);
  for (const fn of ["save_resident_conference_agenda", "reset_resident_conference_agenda", "add_resident_conference_note"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`));
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`));
  }
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /CONFERENCE_CONFLICT/);
  assert.match(sql, /private\.resident_can_manage_conference\(\)/);
  assert.doesNotMatch(sql, /drop (table|column)|truncate|delete from public\.resident_(admission|case)/i);
});

test("the screen saves and reads the agenda through the new functions and never writes the table directly", async () => {
  const ui = await read("src/features/ResidentConference.jsx");
  const api = await read("src/residentCasesApi.js");
  assert.match(ui, /saveConferenceAgenda\(\{/);
  assert.match(ui, /expectedUpdatedAt: session\?\.updated_at \|\| null/);
  assert.match(ui, /resetConferenceAgenda\(meetingDate, session\.updated_at\)/);
  assert.match(ui, /CONFERENCE_CONFLICT/);
  assert.match(api, /rpc\("save_resident_conference_agenda"/);
  assert.match(api, /rpc\("reset_resident_conference_agenda"/);
  assert.match(api, /rpc\("add_resident_conference_note"/);
  assert.doesNotMatch(api, /from\("resident_conference_sessions"\)\s*\.(insert|update|delete|upsert)/);
  // Cancel throws the draft away: the editor works on its own copies of the saved lists
  assert.match(ui, /useState\(session\?\.excluded_case_ids \|\| \[\]\)/);
  // arranging is offered only to users allowed by the shared rule
  assert.match(ui, /canManage && <button[\s\S]*?>จัดรายการประชุม<\/button>/);
});

test("meeting notes: the notes box adds to the meeting when it has one, and lists that meeting first", async () => {
  const parts = await read("src/features/CaseParts.jsx");
  assert.match(parts, /meetingDate \? addConferenceNote\(caseId, meetingDate, body\) : addCaseNote\(caseId, body\)/);
  assert.match(parts, /Number\(b\.meeting_date === meetingDate\) - Number\(a\.meeting_date === meetingDate\)/);
  assert.match(await read("src/residentCasesApi.js"), /select\("id,case_id,author_id,body,created_at,edited_at,meeting_date"\)/);
});
