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
