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

test("the page renders the seven sections with the exact Thai headings and labels", async () => {
  const page = await read("src/features/ResidentMySpace.jsx");
  for (const text of ["รอประเมิน", "ประเมินเสร็จปีนี้", "EPA ถึงเกณฑ์", "PBA เสร็จแล้ว", "รอการประเมิน", "กิจกรรมล่าสุด", "เช็กลิสต์ก่อนสอบบอร์ด", "เป้าปีการศึกษานี้", "การเข้าร่วมประชุมของฉัน", "ข้อมูลประกอบ ไม่ใช่คะแนน", "นับต่อปีการศึกษา (เริ่ม 1 ก.ค.)"])
    assert.ok(page.includes(text), `missing: ${text}`);
});

test("forbidden wording and combined totals are absent from the page, module and styles", async () => {
  const files = await Promise.all(["src/features/ResidentMySpace.jsx", "src/mySpace.js", "src/mySpace.css"].map(read));
  for (const source of files) {
    assert.doesNotMatch(source, /ผู้อำนวยการหลักสูตร/);
    assert.doesNotMatch(source, /ต่อชั้นปี/);
    assert.doesNotMatch(source, /\/24/);
    assert.doesNotMatch(source, /EPA\s*\+\s*PBA/);
    assert.doesNotMatch(source, /เช็กชื่อ/); // spelling is "เช็คชื่อ"
    assert.doesNotMatch(source, /coming soon|เร็วๆ นี้/i);
  }
  const page = files[0];
  assert.match(page, /STUCK_TEXT/); // the Admin sentence comes from the module constant
});

test("the page never reads tables directly and uses only the one new API function", async () => {
  const page = await read("src/features/ResidentMySpace.jsx");
  assert.doesNotMatch(page, /supabase/);
  assert.match(page, /loadOwnRoundAttendanceSince/);
});

test("attendance failure is isolated: the page has its own attendance error state and the counters render regardless", async () => {
  const page = await read("src/features/ResidentMySpace.jsx");
  assert.match(page, /attendance\.error/);
  assert.match(page, /role="alert"/);
});

test("mobile rules: 44px targets, no horizontal page scroll, wrapped long titles", async () => {
  const css = await read("src/mySpace.css");
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.doesNotMatch(css, /overflow-x:\s*scroll/);
});
