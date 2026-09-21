import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("MM & Grand Round schedule is controlled by Admin on any meeting day", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260921033316_allow_admin_scheduled_round_any_day.sql", import.meta.url), "utf8");
  const ui = await readFile(new URL("../src/features/RoundAttendance.jsx", import.meta.url), "utf8");

  assert.match(migration, /drop constraint if exists resident_round_friday/i);
  assert.match(migration, /time '11:00:00'/);
  assert.doesNotMatch(migration, /extract\s*\(\s*isodow/i);
  assert.match(migration, /resident\.surgerycmu@gmail\.com/);
  assert.match(migration, /'admin'::public\.resident_system_role/);
  assert.match(migration, /on conflict \(user_id\) do update[\s\S]*role = excluded\.role, active = true/i);
  assert.match(ui, /Admin กำหนดวันประชุมและกดเปิดรับด้วยตนเอง/);
  assert.doesNotMatch(ui, /เช็กชื่อวันศุกร์/);
});
