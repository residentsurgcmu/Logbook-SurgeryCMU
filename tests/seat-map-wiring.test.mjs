import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("every RPC the front end calls exists in the migration with the same parameter names", async () => {
  const api = await read("src/seatMapApi.js");
  const sql = await read("supabase/migrations/20261014090000_resident_seat_map.sql");
  const calls = [...api.matchAll(/call\("(\w+)"(?:,\s*\{([^}]*)\})?\)/g)];
  assert.ok(calls.length >= 15, "all 15 RPCs are wrapped");
  for (const [, name, params] of calls) {
    const declaration = sql.match(new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`));
    assert.ok(declaration, `${name} exists in the migration`);
    for (const key of [...(params || "").matchAll(/(p_\w+)/g)].map((match) => match[1])) {
      assert.ok(declaration[1].includes(key), `${name} takes ${key}`);
    }
  }
});

test("the API module only talks to the seat-map functions", async () => {
  const api = await read("src/seatMapApi.js");
  assert.match(api, /import \{ supabase \} from "\.\/supabase"/);
  assert.doesNotMatch(api, /\.from\(/, "no direct table access");
  assert.doesNotMatch(api, /resident_round_attendance|resident_round_sessions/);
});
