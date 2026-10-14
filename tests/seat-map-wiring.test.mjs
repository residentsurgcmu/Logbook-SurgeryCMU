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

test("the seat map is wired into the existing check-in and round-admin pages without touching protected files", async () => {
  const round = await read("src/features/RoundAttendance.jsx");
  const platform = await read("src/features/ResidentPlatform.jsx");
  const main = await read("src/main.jsx");
  const preview = await read("preview/main.jsx");
  const nav = await read("src/navGroups.js");
  assert.match(round, /import \{ SeatMapPanel \} from "\.\/SeatMap"/);
  assert.match(round, /import \{ SeatAdminPanel \} from "\.\/SeatMapAdmin"/);
  assert.match(round, /<SeatMapPanel user=\{user\} refreshKey=/);
  assert.match(round, /<SeatAdminPanel[^>]*session=\{session\}/);
  assert.match(round, /adminListSeatConfigs\(\)\.catch\(\(\) => null\)/);
  assert.match(platform, /<RoundCheckIn[\s\S]{0,120}user=\{workspace\.user\}/);
  assert.match(main, /import "\.\/seatMap\.css"/);
  assert.match(preview, /import '\.\.\/src\/seatMap\.css'/);
  assert.doesNotMatch(nav, /seat/i, "no new menu item: the map lives on the existing check-in page");
});

test("the containers poll every 8 s, pause while hidden or while a dialog is open, and never poll the Admin report", async () => {
  const panel = await read("src/features/SeatMap.jsx");
  const admin = await read("src/features/SeatMapAdmin.jsx");
  assert.match(panel, /SEAT_POLL_MS/);
  assert.match(panel, /shouldPoll\(\{ hidden: document\.hidden, dialogOpen, ended \}\)/);
  assert.match(panel, /visibilitychange/);
  assert.doesNotMatch(admin, /setInterval/);
  assert.match(panel, /ENDED_NOTE/);
  assert.match(panel, /listSeatRequests/);
  assert.match(panel, /reviewSeatRequest/);
  assert.doesNotMatch(admin, /eviewSeatRequest/, "Admin only reads requests; Staff decide them (D7)");
});

test("the seat map pieces avoid forbidden wording and never present on-time as a penalty", async () => {
  for (const path of ["src/seatMap.js", "src/features/SeatMapViews.jsx", "src/features/SeatMap.jsx", "src/features/SeatMapAdmin.jsx", "src/seatMap.css"]) {
    const source = await read(path);
    assert.doesNotMatch(source, /ผู้อำนวยการหลักสูตร|เช็กชื่อ|ลงโทษอัตโนมัติ|คะแนนลงโทษ/, path);
  }
  const views = await read("src/features/SeatMapViews.jsx");
  assert.match(views, /ข้อมูลประกอบ ไม่ใช่คะแนนหรือเกณฑ์ลงโทษ/);
});

test("refresh() never clears action errors: load failures and action failures have separate state", async () => {
  const panel = await read("src/features/SeatMap.jsx");
  const start = panel.indexOf("const refresh = useCallback(");
  assert.ok(start >= 0, "refresh is defined");
  const end = panel.indexOf("}, []);", start);
  const refreshSource = panel.slice(start, end);
  assert.match(refreshSource, /setLoadError\(/);
  assert.doesNotMatch(refreshSource, /setError\(/, "refresh must never touch the action error");
  assert.match(panel, /const \[loadError, setLoadError\] = useState\(""\)/);
  assert.match(panel, /const \[error, setError\] = useState\(""\)/);
});

test("RoundAdmin lists past sessions with a seat map so the Admin can open last Friday's report", async () => {
  const round = await read("src/features/RoundAttendance.jsx");
  assert.match(round, /ผังที่นั่งของรอบที่ผ่านมา/);
  assert.match(round, /<SeatAdminPanel[^>]*canConfigure=\{false\}/, "past sessions are read-only: no configuration");
  assert.match(round, /item\.meeting_date < todayIso && seatConfigs\[item\.id\]/);
});

test("when the session list cannot be loaded the seat map renders nothing and shows no error", async () => {
  const panel = await read("src/features/SeatMap.jsx");
  assert.match(panel, /if \(sessions === null \|\| !sessions\.length\) return null;/);
  const loadSessions = panel.match(/const loadSessions = useCallback\([\s\S]*?\n  \}, \[\]\);/);
  assert.ok(loadSessions, "loadSessions found");
  assert.match(loadSessions[0], /catch \(nextError\) \{\n\s+if \(mounted\.current\) setSessions\(\[\]\);/);
  assert.doesNotMatch(loadSessions[0], /setLoadError/, "a failed session list is silent");
  assert.match(panel, /setLoadError\(seatErrorMessage\(nextError\)\)/, "refresh() failures still reach the screen");
});

test("Staff decide requests, so Resident-facing text says อาจารย์ and not ผู้ดูแล for who decides", async () => {
  for (const path of ["src/seatMap.js", "src/features/SeatMapViews.jsx", "src/features/SeatMap.jsx"]) {
    const source = await read(path);
    for (const phrase of ["รอผู้ดูแลตรวจสอบ", "ผู้ดูแลอนุมัติ", "ผู้ดูแลจะตรวจสอบ", "ผู้ดูแลไม่อนุมัติ"]) {
      assert.ok(!source.includes(phrase), `${path} must not contain ${phrase}`);
    }
  }
});
