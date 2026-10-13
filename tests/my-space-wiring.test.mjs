import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const functionBody = (source, name) => {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} is missing`);
  const next = source.indexOf("\nexport ", start + 10);
  return source.slice(start, next === -1 ? undefined : next);
};

test("loadOwnRoundAttendance keeps its 20-row limit; the new reader pages through every row since the year start", async () => {
  const api = await read("src/residentApi.js");
  const old = functionBody(api, "loadOwnRoundAttendance");
  assert.match(old, /\.limit\(20\)/);
  const since = functionBody(api, "loadOwnRoundAttendanceSince");
  assert.match(since, /fetchAllRows\(/);
  assert.match(since, /resident_round_attendance/);
  assert.match(since, /checked_in_at/);
  assert.match(since, /\.gte\("checked_in_at",/);
  assert.match(since, /T00:00:00\+07:00/);
  assert.match(since, /\.order\("session_id"/); // deterministic order so offset paging is stable
  assert.doesNotMatch(since, /\.limit\(/);
});
