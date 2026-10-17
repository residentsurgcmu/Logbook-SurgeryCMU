import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BOTTOM_NAV, NAV_GROUPS, groupNav } from "../src/navGroups.js";

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

test("summary renders six separate cards with units and reports unclassified pending requests", async () => {
  const page = await read("src/features/ResidentMySpace.jsx");
  const counters = page.slice(page.indexOf('<ul className="ms-counters"'), page.indexOf("</ul>", page.indexOf('<ul className="ms-counters"')));
  assert.equal((counters.match(/<li>/g) || []).length, 6);
  for (const [key, label, unit] of [
    ["waitingEpa", "รอประเมิน (EPA)", "ครั้ง"], ["waitingPba", "รอประเมิน (PBA)", "เรื่อง"],
    ["finishedEpaThisYear", "ประเมินเสร็จปีนี้ (EPA)", "ครั้ง"], ["finishedPbaThisYear", "ประเมินเสร็จปีนี้ (PBA)", "เรื่อง"],
  ]) assert.ok(counters.includes(`<li><b>{counters.${key}}</b><span>${label}</span><small>${unit}</small></li>`));
  assert.doesNotMatch(page, /counters\.(waiting|finishedThisYear)\}/);
  assert.match(page, /counters\.waitingUnknown > 0/);
  assert.match(page, /ระบุประเภท EPA\/PBA ไม่ได้ \{counters\.waitingUnknown\} คำขอ/);
  assert.match(page, /attendance\.loading/);
  assert.match(page, /ยังโหลดความคืบหน้า EPA ไม่ได้/);
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

test("navGroups: myspace sits right after home in the first group; nothing else moved; BOTTOM_NAV untouched", () => {
  assert.deepEqual(NAV_GROUPS[0], ["พื้นที่ทำงาน", ["home", "myspace", "cases", "conference", "schedule"]]);
  assert.deepEqual(NAV_GROUPS.slice(1), [
    ["การเรียนรู้และกิจกรรม", ["videos", "attendance", "round-admin"]],
    ["การประเมิน", ["request", "pending", "scan", "dashboard", "qr", "history", "exams"]],
    ["อื่นๆ", ["accounts", "notifications", "export", "admin"]],
  ]);
  assert.deepEqual(BOTTOM_NAV, {
    resident: [["request", "ส่งประเมิน"], ["history", "ผลประเมิน"], ["qr", "QR ของฉัน"], ["cases", "เคส"]],
    staff: [["pending", "รอประเมิน"], ["scan", "สแกน"], ["dashboard", "ภาพรวม"], ["history", "ประวัติ"]],
    admin: [["dashboard", "ภาพรวม"], ["history", "ผลประเมิน"], ["cases", "เคส"], ["admin", "จัดการ"]],
  });
  const groups = groupNav([["home", "หน้าแรก"], ["myspace", "My space"], ["cases", "New admissions"]], "resident");
  assert.deepEqual(groups[0][1].map(([id]) => id), ["home", "myspace", "cases"]);
});

test("the shell adds the My space tab for residents only and renders it only for residents", async () => {
  const shell = await read("src/features/ResidentPlatform.jsx");
  assert.match(shell, /if \(workspace\.user\.role === "resident"\)\s*nav\.push\(\["myspace", "My space"\]\)/);
  assert.match(shell, /myspace: "My space"/);
  assert.match(shell, /tab === "myspace" && workspace\.user\.role === "resident"/);
  assert.match(shell, /import ResidentMySpace from "\.\/ResidentMySpace"/);
  assert.equal((shell.match(/\["myspace", "My space"\]/g) || []).length, 1);
});

test("both entry points load the My space styles", async () => {
  assert.match(await read("src/main.jsx"), /import "\.\/mySpace\.css";/);
  assert.match(await read("preview/main.jsx"), /import '\.\.\/src\/mySpace\.css';/);
});
