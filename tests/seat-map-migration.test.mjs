import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/20261014090000_resident_seat_map.sql", import.meta.url), "utf8");
const TABLES = ["resident_room_layouts", "resident_room_seats", "resident_round_seat_config", "resident_seat_assignments", "resident_seat_holds", "resident_seat_status", "resident_seat_requests", "resident_seat_events"];

test("every new table is created, RLS-enabled and closed to direct access", () => {
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`), `${table} created`);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `${table} RLS`);
  }
  assert.match(sql, /revoke all on table[\s\S]*resident_seat_events[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant select on table public\.resident_room_layouts, public\.resident_room_seats to authenticated/);
});

test("the seat guarantees live in unique indexes, not only in functions", () => {
  assert.match(sql, /create unique index if not exists resident_seat_assignments_one_seat_per_user[\s\S]*\(session_id, user_id\) where released_at is null/);
  assert.match(sql, /create unique index if not exists resident_seat_assignments_one_user_per_seat[\s\S]*\(session_id, seat_code\) where released_at is null/);
  assert.match(sql, /unique \(session_id, user_id\)/);
});

test("the migration is additive: it never redefines an existing round object", () => {
  assert.doesNotMatch(sql, /create (or replace )?function public\.(check_in_resident_round|current_resident_round_qr|open_resident_round|update_resident_round_session|cancel_resident_round_session|close_resident_round)/);
  assert.doesNotMatch(sql, /alter table public\.resident_round_(sessions|attendance|qr_tokens)/);
  assert.doesNotMatch(sql, /drop (table|function) (if exists )?public\.resident_round_/);
});

test("the HN guard rejects Latin and Thai digit runs of six or more", () => {
  assert.match(sql, /\[0-9๐-๙\]\{6,\}/);
  assert.match(sql, /regexp_replace\(p_text, '\[\[:space:\]\.-\]', '', 'g'\)/);
});

test("every public seat function is security definer, closed to anon and open to signed-in users", () => {
  const names = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)];
  assert.ok(names.length >= 6, "at least the six Resident functions exist");
  for (const [, name, args] of names) {
    const types = args.split(",").map((part) => part.trim().split(/\s+/)[1]).filter(Boolean).join(", ");
    const signature = `public\\.${name}\\(${types.replace(/[()]/g, "\\$&")}\\)`;
    const body = sql.slice(sql.indexOf(`create or replace function public.${name}(`));
    assert.match(body.slice(0, body.indexOf("$$;") + 3), /security definer set search_path = public, private, auth/, `${name} search_path`);
    assert.match(sql, new RegExp(`revoke all on function ${signature} from public, anon;`), `${name} revoked`);
    assert.match(sql, new RegExp(`grant execute on function ${signature} to authenticated;`), `${name} granted`);
  }
});

test("holds last 60 seconds and writes are serialised per seat", () => {
  assert.match(sql, /interval '60 seconds'/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_session_id::text \|\| ':' \|\| p_seat_code, 0\)\)/);
});

test("second moderator migration: adds M2 next to M1, renames the layout, and touches nothing else", async () => {
  const follow = await readFile(new URL("../supabase/migrations/20261015090000_resident_seat_map_second_moderator.sql", import.meta.url), "utf8");
  assert.match(follow, /insert into public\.resident_room_seats\(layout_id, seat_code, zone, row_no, col_no\)\s+select l\.id, 'M2', 'M', 1, 2/);
  assert.match(follow, /on conflict \(layout_id, seat_code\) do nothing/, "re-running it is harmless");
  assert.match(follow, /update public\.resident_room_layouts\s+set name = 'ห้องประชุมวันศุกร์ \(38 ที่\)'/);
  assert.doesNotMatch(follow, /create (or replace )?function|drop |delete from|alter table/i, "additive: no function, table or data is dropped or redefined");
});
