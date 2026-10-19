// Vite :5178, synthetic workspace/RPC data, no external requests. Run with RC04_CHROME when needed.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const fixtures = JSON.parse(await readFile(new URL("../docs/rc04/RC04_backend_fixtures_v2.json", import.meta.url)));
const at = (n) => structuredClone(fixtures.cases.find((c) => c.n === n).response);
const browser = await chromium.launch({ headless: true, ...(process.env.RC04_CHROME ? { executablePath: process.env.RC04_CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] } : {}) });
let assertions = 0;
const ok = (condition, label) => { assert.ok(condition, label); assertions++; };
try {
  const context = await browser.newContext(); const page = await context.newPage(), errors = []; let ownReadCalls = 0, attendanceError = false;
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.pathname.endsWith("/resident_round_attendance")) return route.fulfill({ status: attendanceError ? 500 : 200, contentType: "application/json", body: JSON.stringify(attendanceError ? { message: "Synthetic attendance failure" } : [{ session_id: "fixture-meeting", checked_in_at: "2026-10-16T04:03:00Z" }]) });
    if (url.pathname.endsWith("/rc04_open_read_set")) { ownReadCalls++; ok(route.request().postDataJSON().p_scope === "own", "My Space requests own scope only"); return route.fulfill({ contentType: "application/json", body: JSON.stringify(at(28)) }); }
    if (url.pathname.endsWith("/rc04_read_page")) { const data = at(29); data.manifest_id = route.request().postDataJSON().p_manifest_id; data.rows = data.rows.filter((r) => r.resident_id === data.rows[0].resident_id); data.row_count = data.rows.length; return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) }); }
    return route.abort();
  });
  async function open(width) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto("http://127.0.0.1:5178/tests/my-space-browser.html");
    if (width <= 900) await page.getByRole("button", { name: "เปิดเมนู", exact: true }).click();
    await page.getByRole("button", { name: "My space", exact: true }).click(); await page.getByRole("tab", { name: "ภาพรวม", exact: true }).waitFor(); await page.waitForTimeout(250);
  }
  async function fits(label) { ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no document overflow: " + label); ok(await page.locator(".ms-page").evaluate((e) => e.scrollWidth <= e.clientWidth + 1), "no My Space overflow: " + label); }
  for (const width of [320, 390, 430, 768, 1024, 1440, 1920]) {
    await open(width); ok(await page.getByRole("heading", { name: "My space", exact: true }).count() === 1, "one heading"); await fits(width + " overview");
    for (const tab of ["EPA / PBA", "ผลสอบ", "การประชุม"]) { await page.getByRole("tab", { name: tab, exact: true }).click(); await fits(width + " " + tab); }
    await page.evaluate(() => window.setMySpaceScenario("long")); await page.getByRole("tab", { name: "EPA / PBA", exact: true }).click(); await fits(width + " long labels");
    console.log("PASS responsive", width);
  }
  await open(1440); ok((await page.locator(".ms-page").boundingBox()).width > 900, "desktop uses available content width rather than 720px");
  ok(await page.locator(".ms-progress-meta").count() === 2, "two groups keep distinct EPA/PBA metrics");
  await page.getByRole("tab", { name: "EPA / PBA", exact: true }).click();
  ok(await page.getByText("Amputation", { exact: true }).isVisible(), "PBA-01 source name visible"); ok(await page.getByText("AVF", { exact: true }).isVisible(), "PBA-03 source name visible");
  await page.getByRole("button", { name: "ดูครบ 21 แบบตามสถานะที่เลือก →", exact: true }).click();
  ok(await page.getByText("Modified radical mastectomy (MRM)", { exact: true }).isVisible(), "PBA-14 source name visible");
  ok(await page.locator(".ms-form-row").count() === 29, "eight EPA level rows and 21 PBA options retained"); ok(await page.locator(".ms-form-row svg[aria-hidden=true]").count() === 29, "topic SVG icons are decorative beside full text");
  await page.getByRole("button", { name: "รอประเมิน", exact: true }).click(); ok(await page.locator(".ms-form-row").count() === 3, "waiting filter has EPA4, EPA7-L3 and AVF");
  await page.locator(".ms-form-row summary").first().click(); ok(await page.locator(".ms-form-row[open]").count() === 1, "detail expands");
  await page.getByRole("tab", { name: "ผลสอบ", exact: true }).click(); ok(ownReadCalls === 0, "no exam request until explicit reveal");
  await page.getByRole("button", { name: "เปิดคะแนนสอบ", exact: true }).click(); await page.locator(".ms-exam-cell").first().waitFor();
  ok(await page.locator(".ms-exam-cell").count() === 2, "personal result cards render own two cells"); ok((await page.locator(".ms-exam-cell").first().innerText()).includes("0 /"), "zero preserved");
  ok((await page.locator(".ms-exam-overall").innerText()).includes("ยังไม่ครบ"), "incomplete preserved"); ok((await page.locator(".ms-exam-overall").innerText()).includes(at(29).rows[0].part_name), "failed part name preserved");
  await page.setViewportSize({ width: 390, height: 844 }); await fits("personal scores 390");
  await page.getByRole("combobox", { name: "ปีการศึกษา", exact: true }).selectOption({ index: 1 }); ok(await page.locator(".ms-exam-cell").count() === 0, "year change hides scores");
  await page.getByRole("tab", { name: "ภาพรวม", exact: true }).click(); await page.getByRole("tab", { name: "ผลสอบ", exact: true }).click(); ok(await page.locator(".ms-exam-cell").count() === 0, "tab re-entry starts hidden");
  await page.evaluate(() => window.setMySpaceScenario("empty")); await page.getByRole("tab", { name: "ภาพรวม", exact: true }).click(); ok(await page.getByText("ตอนนี้ไม่มีแบบที่รอ Staff ประเมิน", { exact: true }).isVisible(), "empty state readable");
  attendanceError = true; await open(390); await page.getByRole("alert").waitFor(); ok(await page.getByRole("heading", { name: "ความก้าวหน้าของฉัน", exact: true }).isVisible(), "attendance failure keeps progress visible");
  attendanceError = false; await open(1440); await page.screenshot({ path: "../myspace-live-desktop.png", fullPage: true });
  await open(390); await page.screenshot({ path: "../myspace-live-phone.png", fullPage: true });
  await page.getByRole("tab", { name: "EPA / PBA", exact: true }).click(); await page.screenshot({ path: "../myspace-live-pba.png", fullPage: true });
  ok(errors.length === 0, "no browser page errors: " + errors.join("; "));
  console.log("MY SPACE BROWSER PASS", assertions, "assertions; synthetic HTTP only");
} finally { await browser.close(); }
