# Mobile renovation round 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Staff queue, Staff scoring form and Resident submit page usable on a phone (≤ 900 px) without changing any saved data.

**Architecture:** One new stylesheet `src/mobile-assessment.css` (component tokens + all ≤ 900 px rules) loaded after `resident.css`; small additive JSX in `ResidentAssessmentViews.jsx` and `ResidentPlatform.jsx` (comment toggle, legend toggle, counters, queue cards, order swap); one pure helper `src/ruleMessageFilter.js` for the rule-box de-duplication. Radio inputs, state and submit payload builders are not touched.

**Tech Stack:** React 19, Vite 8, plain CSS with the existing `tokens.css` variables, `node --test` source-guard tests; verification with headless Chrome through `puppeteer-core` kept **outside** the project.

**Spec:** `docs/superpowers/specs/2026-10-12-mobile-assessment-design.md` (read it first; §4.3, §4.7 and §6 were amended by this plan — see "Spec amendments" at the end of that file).

## Global Constraints

- **Saved data is identical:** same `completeAssessmentRequest({requestId, outcome, comment, scores[{criterionId, score, comment}]})` and `requestAssessment({...})` call shapes; radio `name="score-<criterionId>"`, `value`, `onChange` unchanged; no level is ever pre-selected; validation messages unchanged.
- **Never edit:** `CLAUDE.md`, `src/tokens.css`, `src/styles.css`, `src/features/ResidentDashboard.jsx`, `src/residentAnalytics.js`, `src/navGroups.js` (owner: อจ. Chagkrit).
- **No new dependency in `package.json`.** `puppeteer-core` is installed only in the scratchpad.
- **Mobile breakpoint is `max-width: 900px`** (where `.bottom-nav` appears, `resident.css:375`). Above 900 px the pages render as before.
- No raw colour values (`#hex`, `rgb()`) in `src/mobile-assessment.css`; use `tokens.css` variables. Tap targets ≥ 44 px high.
- Thai copy stays plain. Level buttons keep their labels (`L1…L5`, `F/M/E`).
- This folder is **not a git repository**. Where a plan normally commits, this plan takes a checkpoint (re-run the full suite) and the final deliverable is a patch against `main` (Task 7).

## Review Focus

Failure modes the spec implies that no single task's happy-path tests would catch (each is pinned in the task named in brackets):

1. A 330–690-character Thai criterion with no spaces must wrap, never push the card wider than the screen. [Task 2 harness fixture, Task 4 check E2]
2. Forms with 3 options (F/M/E) and with 5 options (L1–L5) both lay out in one row of equal buttons. [Task 4 checks E2/E3 on both templates]
3. Tapping the sign button with nothing chosen: every empty row is marked and the first one is scrolled into view (the error line is below the fold once the button is sticky). [Task 4 check E7]
4. A criterion that already has comment text stays open and keeps its text (no data hidden or lost when the toggle logic runs). [Task 4 test + harness S1]
5. Empty queue (no pending requests) renders its empty state with neither table nor cards. [Task 5 check Q0]

---

## File Structure

| File | Responsibility |
|---|---|
| `src/mobile-assessment.css` (new) | Component tokens; hides mobile-only elements on desktop; all `@media (max-width: 900px)` rules for this round |
| `src/ruleMessageFilter.js` (new) | Pure `visibleRuleWarnings(rules, {hideAlreadyMet})` — unit-testable in Node |
| `src/main.jsx`, `preview/main.jsx` | One CSS import line each |
| `src/features/ResidentAssessmentViews.jsx` | `ScoreLegend`, `ScoreGrid`, `StaffEvaluationForm`, `RuleMessages`, `LevelProgressNotice`, PBA note class |
| `src/features/ResidentPlatform.jsx` | `RequestQueue` cards; Staff page order |
| `tests/mobile-assessment-20261012.test.mjs` (new) | Source guards + `visibleRuleWarnings` behaviour |
| `tests/resident-attempt-rules.test.mjs` | One regex updated (Task 6) |
| `$S/mobile-verify/` (scratchpad, not shipped) | `verify.mjs` harness: builds the real pages with a recording Supabase stub, drives headless Chrome, checks layout and payload identity |

`S` below = `/private/tmp/claude-501/-Users-chagkrit/cfb69624-7272-456c-a7f0-6af41c280386/scratchpad`; `R` = `/Users/chagkrit/Downloads/Logbook-SurgeryCMU-main`.

---

### Task 1: Baseline snapshot and tooling

**Files:** none changed in `R`; creates `$S/baseline/`, `$S/protected.sha256`, `$S/mobile-verify/`.

**Interfaces:** Produces `$S/baseline/{src,preview,tests,docs}` (pristine copy), `$S/protected.sha256` (hashes of untouchable files).

- [ ] **Step 1: Snapshot the pristine tree and hash the protected files**

```bash
S=/private/tmp/claude-501/-Users-chagkrit/cfb69624-7272-456c-a7f0-6af41c280386/scratchpad
R=/Users/chagkrit/Downloads/Logbook-SurgeryCMU-main
mkdir -p $S/baseline && cd $R
cp -R src preview tests docs $S/baseline/
shasum -a 256 CLAUDE.md src/tokens.css src/styles.css src/features/ResidentDashboard.jsx src/residentAnalytics.js src/navGroups.js > $S/protected.sha256
cat $S/protected.sha256
```
Expected: six hash lines.

- [ ] **Step 2: Install project dependencies without creating a lockfile**

```bash
cd $R && npm install --no-package-lock
```
Expected: completes; `node_modules/` appears (do not commit/ship it). If `npm` rewrites `package.json`, run `diff` against the original and restore it.

- [ ] **Step 3: Baseline test and build**

```bash
cd $R && npm test 2>&1 | tail -15 && npx vite build 2>&1 | tail -5
```
Expected: `# pass` ≈ 267–268, `# fail 0`; build succeeds (chunk-size warning is normal). Record the exact pass count — every later checkpoint must show at least this many passing and 0 failing. If baseline already fails, stop and report which tests fail before touching anything.

- [ ] **Step 4: Install the verification browser driver outside the project**

```bash
mkdir -p $S/mobile-verify && cd $S/mobile-verify && npm init -y >/dev/null && npm i puppeteer-core
ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```
Expected: `puppeteer-core` installed; Chrome path exists.

- [ ] **Step 5: Checkpoint** — nothing to commit. Note the baseline pass count in your report.

---

### Task 2: Verification harness, run against the ORIGINAL code

Builds the real `ResidentPlatform` (with a recording stub instead of Supabase), drives it in headless Chrome at 1280 / 390 / 320 px, records the payloads produced by identical clicks, and runs the layout checks. Against the original code the new-feature layout checks must fail (that is the "red" state) and the payload baseline is saved.

**Files:**
- Create: `$S/mobile-verify/verify.mjs`

**Interfaces:**
- Consumes: `R/src/features/ResidentPlatform.jsx` (default export `ResidentPlatform({workspace,onRefresh,onLogout})`), CSS files in `R/src`.
- Produces: `node verify.mjs <ROOT> <OUT> baseline|after` → writes `<OUT>/payloads-<mode>.json`, `<OUT>/checks-<mode>.json`, screenshots `<OUT>/<mode>-<viewport>-<page>.png`; prints a PASS/FAIL table; in `after` mode exits 1 on any FAIL or payload mismatch.

- [ ] **Step 1: Write the harness**

Create `$S/mobile-verify/verify.mjs`:

```js
// Verification harness for the mobile renovation. Not shipped. Usage:
//   node verify.mjs <ROOT> <OUT> baseline|after
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(process.argv[2] || "");
const OUT = path.resolve(process.argv[3] || "");
const MODE = process.argv[4];
if (!process.argv[2] || !process.argv[3] || !["baseline", "after"].includes(MODE)) {
  console.error("usage: node verify.mjs <ROOT> <OUT> baseline|after");
  process.exit(2);
}
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
await mkdir(OUT, { recursive: true });
const { build } = await import(pathToFileURL(path.join(ROOT, "node_modules/vite/dist/node/index.js")).href);

// ---------- harness source ----------
const STUB = `
const calls = (window.__calls = window.__calls || []);
const done = (data) => Promise.resolve({ data, error: null });
const chain = () => new Proxy(function () {}, {
  get: (_, key) => (key === "then" ? (resolve) => resolve({ data: [], error: null }) : chain()),
  apply: () => chain(),
});
export const supabase = new Proxy({
  rpc: (name, args) => { calls.push({ name, args }); return done(name === "submit_resident_assessment_request" ? "req-new" : null); },
  functions: { invoke: (name, opts) => { calls.push({ name: "fn:" + name, args: opts && opts.body }); return done({ ok: true, sent: true }); } },
}, { get: (target, key) => (key in target ? target[key] : chain()) });
`;

function entrySource() {
  const css = ["tokens", "styles", "resident", "residentCorner", "mobile-assessment"]
    .filter((name) => existsSync(path.join(ROOT, "src", `${name}.css`)))
    .map((name) => `import ${JSON.stringify(path.join(ROOT, "src", `${name}.css`))};`)
    .join("\n");
  return `
import React from "react";
import { createRoot } from "react-dom/client";
import ResidentPlatform from ${JSON.stringify(path.join(ROOT, "src/features/ResidentPlatform.jsx"))};
${css}

const repeat = (text, n) => Array.from({ length: n }, () => text).join("");
const mk = (prefix, texts) => texts.map((text, i) => ({ id: prefix + (i + 1), criterion_code: "C" + (i + 1), criterion_text: text, sort_order: i + 1 }));
const short = "ประเมินประวัติและตรวจร่างกายอย่างเป็นระบบ";
const epa = {
  id: "t-epa", template_code: "EPA 1", template_type: "EPA", title: "การประเมินก่อนผ่าตัด",
  score_options: ["L1", "L2", "L3", "L4", "L5"],
  score_legend: [["L1", "ต้องแสดงให้ดู"], ["L2", "ทำร่วมกับผู้สอน"], ["L3", "ทำโดยมีผู้สอนใกล้ชิด"], ["L4", "ทำเองโดยผู้สอนพร้อมช่วย"], ["L5", "ทำเองได้เต็มที่"]],
  outcome_options: ["Excellence", "Pass", "Borderline", "Fail"],
  max_attempts: 3, max_attempts_per_year: 1, requires_self_assessment: false, recommended_pgy: [],
  criteria: mk("e", [short, repeat("ตรวจและวางแผนการรักษาอย่างครบถ้วนตามแนวทาง", 7), short, short, short, short]),
};
const pba = {
  id: "t-pba", template_code: "PBA-1", template_type: "PBA", title: "ผ่าตัดไส้ติ่ง",
  score_options: ["F", "M", "E"],
  score_legend: [["F", "Fail"], ["M", "Met"], ["E", "Excellent"]],
  outcome_options: ["Pass", "Borderline", "Fail"],
  max_attempts: null, max_attempts_per_year: null, requires_self_assessment: true, recommended_pgy: [3],
  criteria: mk("p", [short, short, repeat("เตรียมผู้ป่วยและทีมก่อนผ่าตัดอย่างปลอดภัยและสื่อสารกับญาติ", 11), short, short, short, short, short]),
};
const staff = { id: "s1", role: "staff", name: "Staff ตัวอย่าง", pgy: null };
const resident = { id: "r1", role: "resident", name: "Resident ตัวอย่าง A", pgy: 3 };
const profiles = [resident, { id: "r2", name: "Resident ตัวอย่าง B", pgy: 2 }];
const request = (id, template, over) => ({
  id, resident_id: "r1", staff_id: "s1", template_id: template.id, status: "pending", attempt_number: 1,
  submitted_at: "2026-10-10T03:00:00Z", assessment_date: "2026-10-09",
  procedure_or_activity: "กิจกรรมสมมติ " + id,
  resident_template_definitions: { template_code: template.template_code, title: template.title },
  resident_self_assessment_scores: [], previous_staff_name: null, ...over,
});
const q = new URLSearchParams(location.search);
const role = q.get("role") || "staff";
const empty = q.has("empty");
const requests = empty || role === "resident" ? [] : [
  request("q1", epa, {}),
  request("q2", pba, {
    self_submitted_at: "2026-10-10T02:00:00Z", self_overall_outcome: "Pass", self_comment: "ประเมินตนเอง",
    resident_self_assessment_scores: pba.criteria.map((c) => ({ criterion_id: c.id, score: "M", comment: "" })),
  }),
];
const workspace = {
  user: role === "staff" ? staff : resident, profiles, allProfiles: profiles, requests, assessments: [], notifications: [],
  templates: [epa, pba], assignments: [], examRecords: [], staffDirectory: [],
  registeredStaff: [{ user_id: "s1", full_name: "Staff ตัวอย่าง", unit_name: "Upper GI", unavailable_until: null }],
  epaProgress: [],
};
createRoot(document.getElementById("root")).render(
  <ResidentPlatform workspace={workspace} onRefresh={async () => {}} onLogout={() => {}} />,
);
`;
}

async function buildHarness() {
  await writeFile(path.join(OUT, "stub-supabase.js"), STUB);
  await writeFile(path.join(OUT, "entry.jsx"), entrySource());
  const result = await build({
    root: ROOT, configFile: false, envDir: false, publicDir: false, logLevel: "error",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [
      { name: "harness-supabase", enforce: "pre", resolveId(id) { if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(OUT, "stub-supabase.js"); } },
      { name: "root-resolve", enforce: "pre", async resolveId(id, importer, options) {
        if (!importer || importer.startsWith(ROOT) || id.startsWith(".") || path.isAbsolute(id)) return null;
        return this.resolve(id, path.join(ROOT, "index.html"), { ...options, skipSelf: true });
      } },
    ],
    build: { write: false, lib: { entry: path.join(OUT, "entry.jsx"), name: "Harness", formats: ["iife"] }, rollupOptions: { output: { inlineDynamicImports: true } }, assetsInlineLimit: Infinity, minify: false },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
  const code = outputs.filter((o) => o.type === "chunk").map((o) => o.code).join("\n");
  let css = outputs.filter((o) => o.type === "asset" && o.fileName.endsWith(".css")).map((o) => o.source).join("\n");
  const font = "data:font/ttf;base64," + (await readFile(path.join(ROOT, "public/fonts/NotoSansThai.ttf"))).toString("base64");
  css = css.replaceAll("/fonts/NotoSansThai.ttf", font);
  const html = `<!doctype html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="root"></div><script>${code.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  await writeFile(path.join(OUT, "harness.html"), html);
}

// ---------- browser helpers ----------
const VIEWPORTS = [
  { name: "desktop-1280", w: 1280, h: 900, mobile: false },
  { name: "phone-390", w: 390, h: 844, mobile: true },
  { name: "phone-320", w: 320, h: 640, mobile: true },
];
const checks = [];
const record = (vp, name, pass, detail = "") => checks.push({ vp, name, pass: Boolean(pass), detail: String(detail) });

async function openPage(browser, vp, query) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(OUT, "harness.html")}${query}`);
  await page.waitForSelector(".resident-app");
  page.__errors = errors;
  return page;
}
const navTo = (page, vp, mobileLabel, desktopLabel) =>
  page.evaluate((mobile, a, b) => {
    const scope = mobile ? ".bottom-nav" : ".app-sidebar";
    const btn = [...document.querySelectorAll(`${scope} button`)].find((el) => el.textContent.includes(mobile ? a : b));
    if (!btn) throw new Error("nav button not found: " + (mobile ? a : b));
    btn.click();
  }, vp.mobile, mobileLabel, desktopLabel);
const clickText = (page, selector, text) =>
  page.evaluate((sel, t) => {
    const visible = (el) => el.offsetParent !== null;
    const btn = [...document.querySelectorAll(sel)].find((el) => visible(el) && el.textContent.includes(t));
    if (!btn) throw new Error(`no visible ${sel} containing "${t}"`);
    btn.click();
  }, selector, text);
const setScore = (page, name, value) =>
  page.evaluate((n, v) => { document.querySelector(`input[name="${n}"][value="${v}"]`).click(); }, name, value);
const setValue = (page, selector, value) =>
  page.evaluate((sel, v) => {
    const el = document.querySelector(sel);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector, value);
async function addComment(page, code, text) {
  const selector = `input[aria-label="ข้อเสนอแนะ ${code}"]`;
  const opened = await page.evaluate((sel) => {
    const input = document.querySelector(sel);
    const toggle = input.closest(".criterion-row").querySelector(".criterion-comment-toggle");
    if (toggle && toggle.offsetParent !== null) { toggle.click(); return "toggled"; }
    return "visible-already";
  }, selector);
  await new Promise((r) => setTimeout(r, 50));
  const shown = await page.evaluate((sel) => document.querySelector(sel).offsetParent !== null, selector);
  await setValue(page, selector, text);
  return { opened, shown };
}
const calls = (page) => page.evaluate(() => window.__calls || []);
const waitCall = (page, name) => page.waitForFunction((n) => (window.__calls || []).some((c) => c.name === n), { timeout: 5000 }, name);

// ---------- scenarios ----------
const payloads = {};

async function scenarioStaffEvaluation(browser, vp, templateKey) {
  const page = await openPage(browser, vp, "?role=staff");
  await navTo(page, vp, "รอประเมิน", "รายการรอ Staff ประเมิน");
  await page.waitForSelector(".resident-panel");
  const isEpa = templateKey === "epa";
  if (isEpa) {
    // queue-page layout checks (only once per viewport)
    await queueChecks(page, vp);
    await page.screenshot({ path: path.join(OUT, `${MODE}-${vp.name}-queue.png`) });
  }
  await clickText(page, "button", "เปิดประเมิน"); // first visible one = q1 (EPA); second request handled below
  if (!isEpa) {
    await page.evaluate(() => document.querySelector("form.assessment-form button.secondary-button").click());
    await page.waitForSelector(".resident-panel");
    await page.evaluate(() => {
      const visible = (el) => el.offsetParent !== null;
      const buttons = [...document.querySelectorAll("button")].filter((el) => visible(el) && el.textContent.includes("เปิดประเมิน"));
      buttons[1].click();
    });
  }
  await page.waitForSelector("form.assessment-form");
  if (isEpa) await formChecks(page, vp);
  const ids = await page.evaluate(() => [...document.querySelectorAll(".criterion-row")].map((row) => row.querySelector("input[type=radio]").name));
  const plan = isEpa ? ["L5", "L4", "L4", "L5", "L4", "L3"] : ["E", "M", "M", "E", "M", "E", "M", "M"];
  const comments = {};
  for (let i = 0; i < ids.length; i++) await setScore(page, ids[i], plan[i]);
  const c2 = await addComment(page, "C2", "ข้อเสนอแนะข้อ 2");
  const c6 = await addComment(page, "C6", "ข้อเสนอแนะข้อ 6");
  record(vp.name, `comment inputs reachable (${templateKey})`, c2.shown && c6.shown, JSON.stringify({ c2, c6 }));
  await page.select("form.assessment-form select", isEpa ? "Pass" : "Pass");
  await setValue(page, "form.assessment-form textarea", "ความเห็นรวม");
  if (isEpa) await page.screenshot({ path: path.join(OUT, `${MODE}-${vp.name}-form.png`), fullPage: true });
  await page.evaluate(() => document.querySelector("form.assessment-form button.primary-button").click());
  await waitCall(page, "complete_resident_assessment_request");
  const all = await calls(page);
  payloads[`${templateKey}-staff-${vp.name}`] = all;
  record(vp.name, `no page errors (${templateKey})`, page.__errors.length === 0, page.__errors.join(" | "));
  await page.close();
}

async function scenarioResidentRequest(browser, vp) {
  const page = await openPage(browser, vp, "?role=resident");
  await navTo(page, vp, "ส่งประเมิน", "ส่งแบบประเมิน");
  await page.waitForSelector("form.assessment-form");
  await page.select("form.assessment-form select", "t-pba"); // template select is the first select
  await page.evaluate(() => { document.querySelectorAll("form.assessment-form select")[1].value = ""; });
  await page.select("form.assessment-form .resident-form-grid label:nth-of-type(2) select", "s1");
  await setValue(page, 'form.assessment-form input[type="date"]', "2026-10-09");
  await setValue(page, "form.assessment-form input[maxlength='240']", "กิจกรรมสมมติ");
  await page.waitForSelector(".criterion-row");
  const legend = await page.evaluate(() => {
    const el = document.querySelector(".score-legend");
    return el ? getComputedStyle(el).display : "missing";
  });
  if (vp.mobile) record(vp.name, "resident legend collapsed by default", legend === "none", `display=${legend}`);
  else record(vp.name, "resident legend open on desktop", legend !== "none" && legend !== "missing", `display=${legend}`);
  if (vp.mobile) {
    record(vp.name, "resident page: no page horizontal scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.evaluate(() => document.querySelector(".score-legend-toggle")?.click());
    const open = await page.evaluate(() => getComputedStyle(document.querySelector(".score-legend")).display !== "none");
    record(vp.name, "resident legend toggle opens it", open);
  }
  await page.screenshot({ path: path.join(OUT, `${MODE}-${vp.name}-resident.png`), fullPage: true });
  const ids = await page.evaluate(() => [...document.querySelectorAll(".criterion-row")].map((row) => row.querySelector("input[type=radio]").name));
  const plan = ["M", "M", "E", "M", "F", "M", "E", "M"];
  for (let i = 0; i < ids.length; i++) await setScore(page, ids[i], plan[i]);
  await addComment(page, "C1", "ประเมินตนเองข้อ 1");
  await page.evaluate(() => {
    const selects = [...document.querySelectorAll("form.assessment-form select")];
    selects[selects.length - 1].value = "Pass";
  });
  await page.select(`form.assessment-form .self-assessment-section select`, "Pass");
  await setValue(page, ".self-assessment-section textarea", "ความเห็นของ Resident");
  await page.evaluate(() => document.querySelector("form.assessment-form button.primary-button").click());
  await waitCall(page, "submit_resident_assessment_request");
  payloads[`pba-resident-${vp.name}`] = await calls(page);
  record(vp.name, "no page errors (resident)", page.__errors.length === 0, page.__errors.join(" | "));
  await page.close();
}

async function scenarioEmptyQueue(browser, vp) {
  const page = await openPage(browser, vp, "?role=staff&empty=1");
  await navTo(page, vp, "รอประเมิน", "รายการรอ Staff ประเมิน");
  await page.waitForSelector(".resident-panel");
  const state = await page.evaluate(() => ({
    empty: document.body.textContent.includes("ไม่มีแบบประเมินรอดำเนินการ"),
    table: Boolean(document.querySelector(".queue-table, .resident-table-wrap table")),
    cards: Boolean(document.querySelector(".queue-cards")),
  }));
  record(vp.name, "Q0 empty queue shows empty state, no table/cards", state.empty && !state.table && !state.cards, JSON.stringify(state));
  await page.close();
}

async function queueChecks(page, vp) {
  const m = await page.evaluate(() => {
    const visible = (el) => el && el.offsetParent !== null;
    const vis = (sel) => [...document.querySelectorAll(sel)].filter(visible);
    const open = vis("button").find((el) => el.textContent.includes("เปิดประเมิน"));
    const r = open ? open.getBoundingClientRect() : null;
    const queue = document.querySelector(".queue-cards, .queue-table, .resident-table-wrap");
    const avail = document.querySelector(".staff-availability");
    const date = avail && avail.querySelector('input[type="date"]');
    const save = avail && [...avail.querySelectorAll("button")].find((el) => el.textContent.includes("บันทึก"));
    const rect = (el) => (el ? el.getBoundingClientRect() : null);
    return {
      pageScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
      open: r && { left: r.left, right: r.right, height: r.height },
      innerWidth: window.innerWidth,
      queueTop: queue ? queue.getBoundingClientRect().top + scrollY : null,
      availTop: avail ? avail.getBoundingClientRect().top + scrollY : null,
      date: rect(date) && { right: rect(date).right, bottom: rect(date).bottom, top: rect(date).top },
      save: rect(save) && { top: rect(save).top },
      availRight: avail ? avail.getBoundingClientRect().right : null,
      tableVisible: vis(".queue-table").length > 0 || (!document.querySelector(".queue-table") && vis(".resident-table-wrap").length > 0),
      cardsVisible: vis(".queue-cards").length > 0,
    };
  });
  if (vp.mobile) {
    record(vp.name, "Q1 queue page: no horizontal scroll", m.pageScroll);
    record(vp.name, "Q2 open-assessment button fully on screen, ≥44px high", m.open && m.open.left >= 0 && m.open.right <= m.innerWidth + 1 && m.open.height >= 44, JSON.stringify(m.open));
    record(vp.name, "Q3 queue comes before the availability card", m.queueTop != null && m.availTop != null && m.queueTop < m.availTop, `${m.queueTop} < ${m.availTop}`);
    record(vp.name, "Q4 date field inside the card and above the save button", m.date && m.save && m.date.right <= m.availRight + 1 && m.date.bottom <= m.save.top + 1, JSON.stringify({ d: m.date, s: m.save }));
    record(vp.name, "Q5 cards shown, table hidden", m.cardsVisible && !m.tableVisible);
  } else {
    record(vp.name, "D1 desktop: table shown, cards hidden", m.tableVisible && !m.cardsVisible);
  }
}

async function formChecks(page, vp) {
  const m = await page.evaluate(() => {
    const visible = (el) => el && el.offsetParent !== null;
    const rect = (el) => el.getBoundingClientRect();
    const rows = [...document.querySelectorAll(".criterion-row")];
    const list = document.querySelector(".criterion-list");
    const nav = document.querySelector(".bottom-nav");
    const bar = document.querySelector(".assessment-actions");
    const rowInfo = rows.map((row) => {
      const text = row.querySelector("div:first-child p");
      const spans = [...row.querySelectorAll(".score-radio span")];
      const tr = rect(text);
      return {
        textRight: tr.right, textBottom: tr.bottom, rowHeight: rect(row).height,
        spans: spans.map((s) => { const r = rect(s); return { left: r.left, right: r.right, top: r.top, w: r.width, h: r.height }; }),
      };
    });
    return {
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      pageScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
      listScroll: list.scrollWidth <= list.clientWidth + 1,
      rowInfo,
      cols: getComputedStyle(rows[0]).gridTemplateColumns.split(" ").length,
      head: visible(document.querySelector(".criterion-head")),
      toggle: Boolean(document.querySelector(".criterion-comment-toggle")) && visible(document.querySelector(".criterion-comment-toggle")),
      legendDisplay: getComputedStyle(document.querySelector(".score-legend")).display,
      progress: visible(document.querySelector(".assessment-progress")),
      barPosition: bar ? getComputedStyle(bar).position : "none",
      hasNav: Boolean(nav) && visible(nav),
    };
  });
  if (vp.mobile) {
    record(vp.name, "E1 form: no horizontal scroll (page and list)", m.pageScroll && m.listScroll);
    const inView = m.rowInfo.every((r) => r.textRight <= m.innerWidth + 1 && r.spans.every((s) => s.left >= 0 && s.right <= m.innerWidth + 1));
    record(vp.name, "E2 every criterion text and level button inside the screen width", inView);
    record(vp.name, "E2b text sits above its buttons and each card fits one screen", m.rowInfo.every((r) => r.textBottom <= r.spans[0].top + 1 && r.rowHeight <= m.innerHeight * 0.8));
    record(vp.name, "E3 level buttons ≥44px high and ≥40px wide", m.rowInfo.every((r) => r.spans.every((s) => s.h >= 44 && s.w >= 40)), JSON.stringify(m.rowInfo[0].spans[0]));
    record(vp.name, "E5 legend collapsed by default", m.legendDisplay === "none", m.legendDisplay);
    // E4: sticky bar never under the bottom nav, at several scroll positions
    const overlaps = [];
    for (const frac of [0, 0.5, 1]) {
      await page.evaluate((f) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), frac);
      const o = await page.evaluate(() => {
        const bar = document.querySelector(".assessment-actions");
        const nav = document.querySelector(".bottom-nav");
        if (!bar || !nav) return { missing: true };
        const b = bar.getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        return { bottom: b.bottom, navTop: n.top, onScreen: b.top < innerHeight && b.bottom > 0 };
      });
      overlaps.push(o);
    }
    record(vp.name, "E4 action bar sits above the bottom nav at every scroll position", overlaps.every((o) => !o.missing && o.bottom <= o.navTop + 1), JSON.stringify(overlaps));
    // E5b: legend toggle
    await page.evaluate(() => document.querySelector(".score-legend-toggle")?.click());
    record(vp.name, "E5b legend toggle opens it", await page.evaluate(() => getComputedStyle(document.querySelector(".score-legend")).display !== "none"));
    // E7: failed submit marks every empty row and scrolls to the first
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.select("form.assessment-form select", "Pass"); // outcome is `required`: without it the browser blocks submit before our handler runs
    await page.evaluate(() => document.querySelector("form.assessment-form button.primary-button").click());
    await new Promise((r) => setTimeout(r, 200));
    const e7 = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".criterion-row")];
      const marked = rows.filter((row) => row.dataset.unanswered === "true");
      const first = marked[0] && marked[0].getBoundingClientRect();
      return { total: rows.length, marked: marked.length, firstTop: first && first.top, innerHeight: innerHeight };
    });
    record(vp.name, "E7 failed submit marks every empty row and scrolls to the first", e7.marked === e7.total && e7.firstTop != null && e7.firstTop >= -1 && e7.firstTop < e7.innerHeight, JSON.stringify(e7));
    await page.evaluate(() => window.scrollTo(0, 0));
  } else {
    record(vp.name, "D2 desktop: 7-column matrix (5 levels + text + comment), header shown", m.cols === 7 && m.head, `cols=${m.cols} head=${m.head}`);
    record(vp.name, "D3 desktop: no comment toggle, legend open, no mobile counter, action bar not sticky", !m.toggle && m.legendDisplay !== "none" && !m.progress && m.barPosition !== "sticky", JSON.stringify({ toggle: m.toggle, legend: m.legendDisplay, progress: m.progress, bar: m.barPosition }));
  }
}

// ---------- run ----------
await buildHarness();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
try {
  for (const vp of VIEWPORTS) {
    await scenarioStaffEvaluation(browser, vp, "epa");
    await scenarioStaffEvaluation(browser, vp, "pba");
    await scenarioResidentRequest(browser, vp);
    await scenarioEmptyQueue(browser, vp);
  }
} finally {
  await browser.close();
}

// ---------- payload identity ----------
const canon = (all) => JSON.stringify(all);
await writeFile(path.join(OUT, `payloads-${MODE}.json`), JSON.stringify(payloads, null, 2));
let baseline = null;
if (MODE === "after") baseline = JSON.parse(await readFile(path.join(OUT, "payloads-baseline.json"), "utf8"));
for (const key of Object.keys(payloads)) {
  const [kind, who, vpName] = key.split("-").length === 4 ? [key.split("-")[0], key.split("-")[1], key.split("-").slice(2).join("-")] : [key, "", ""];
  const ref = (baseline || payloads)[`${kind}-${who}-desktop-1280`];
  record(vpName, `P payload ${kind}/${who} equals the ORIGINAL code at 1280px`, ref && canon(payloads[key]) === canon(ref), "");
}

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  [${c.vp}] ${c.name}${c.pass ? "" : "  -> " + c.detail}`);
await writeFile(path.join(OUT, `checks-${MODE}.json`), JSON.stringify(checks, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks pass (${MODE})`);
process.exit(MODE === "after" && failed.length ? 1 : 0);
```

- [ ] **Step 2: Run against the ORIGINAL code**

```bash
cd $S/mobile-verify && node verify.mjs $R $S/verify-out baseline 2>&1 | tail -60
```
Expected: the build and browser run complete. Payload checks `P …` PASS (the original code gives the same payload at all widths). Layout checks Q1–Q5, E1–E5, E7, D1–D3 for mobile widths FAIL (horizontal scroll, no cards, no toggle…) — **this is the required red state**. If the harness itself errors (selector not found, fixture shape, a console error from an un-stubbed module), fix the **harness** (fixture or selector), not product code, and re-run until the only failures are genuine layout failures. Known knobs: nav labels (check `navLabels` around `ResidentPlatform.jsx:825–845` for the exact Thai text of `pending` and `request`), the template `<select>` order in the request form (`select` #1 = template, #2 = Staff), and any extra workspace field the platform reads on mount (add it to the fixture).

- [ ] **Step 3: Confirm the baseline payloads exist**

```bash
node -e 'const p=require(process.argv[1]);for(const[k,v]of Object.entries(p))console.log(k, v.map(c=>c.name).join(","))' $S/verify-out/payloads-baseline.json
```
Expected: nine keys (`epa-staff-*`, `pba-staff-*`, `pba-resident-*` × three viewports). `epa-staff-*` contain `complete_resident_assessment_request`; `pba-resident-*` contain `submit_resident_assessment_request` then `fn:resident-assessment-notifier`.

- [ ] **Step 4: Checkpoint** — nothing in `R` changed. Report the count of baseline FAILs by id.

---

### Task 3: CSS foundation, wiring, source guards

**Files:**
- Create: `src/mobile-assessment.css`
- Modify: `src/main.jsx`, `preview/main.jsx`
- Create: `tests/mobile-assessment-20261012.test.mjs`

**Interfaces:**
- Produces: CSS custom properties `--touch-min`, `--space-card`, `--score-btn-h`, `--score-btn-gap`, `--card-pad`, `--action-bar-bottom`; a marker comment `/* @@next-rules@@ */` inside the media block that later tasks replace.

- [ ] **Step 1: Write the failing tests**

Create `tests/mobile-assessment-20261012.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("mobile-assessment.css is loaded after resident.css in the app and in the preview", async () => {
  for (const file of ["src/main.jsx", "preview/main.jsx"]) {
    const source = await read(file);
    const resident = source.indexOf("resident.css");
    const mobile = source.indexOf("mobile-assessment.css");
    assert.ok(resident > -1 && mobile > resident, `${file} imports mobile-assessment.css after resident.css`);
  }
});

test("mobile-assessment.css only reads tokens: no raw colours, bar offset by the bottom nav, tokens.css names never redefined", async () => {
  const css = await read("src/mobile-assessment.css");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.match(css, /--action-bar-bottom:\s*calc\(var\(--bottom-nav-height\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /--touch-min:\s*44px/);
  assert.doesNotMatch(css, /--(brand|brand-dark|brand-soft|accent|canvas|surface|line|line-strong|text|text-muted|warning|danger|success|focus)\s*:/);
  assert.match(css, /@media \(max-width: 900px\)/);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd $R && node --test tests/mobile-assessment-20261012.test.mjs`
Expected: FAIL (file/imports missing).

- [ ] **Step 3: Create the stylesheet skeleton**

Create `src/mobile-assessment.css`:

```css
/* Mobile renovation round 1 (2026-10-12): Staff queue + assessment form.
   Reads tokens.css and never redefines it.
   Spec: docs/superpowers/specs/2026-10-12-mobile-assessment-design.md
   Phone layout starts where the bottom nav starts (900px, see resident.css). */

:root {
  /* semantic */
  --touch-min: 44px;
  --space-card: 14px;
  /* component */
  --score-btn-h: var(--touch-min);
  --score-btn-gap: 4px;
  --card-pad: var(--space-card);
  --action-bar-bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom));
}

/* Mobile-only elements: hidden on desktop, shown inside the media block below. */
.criterion-comment-toggle,
.score-legend-toggle,
.criterion-progress,
.assessment-progress,
.queue-cards {
  display: none;
}

@media (max-width: 900px) {
  /* @@next-rules@@ */
}
```

- [ ] **Step 4: Wire the imports**

In `src/main.jsx` add after `import "./resident.css";`:
```js
import "./mobile-assessment.css";
```
In `preview/main.jsx` add after `import '../src/resident.css';`:
```js
import '../src/mobile-assessment.css';
```
(`./residentCorner.css` stays after it; order only needs to be after `resident.css`.)

- [ ] **Step 5: Run tests + checkpoint**

Run: `cd $R && node --test tests/mobile-assessment-20261012.test.mjs && npm test 2>&1 | tail -8`
Expected: new tests PASS; whole suite = baseline count + 2, 0 failures.

---

### Task 4: Scoring form cards, legend fold, counters, sticky action bar (problems 3 and part of 4)

**Files:**
- Modify: `src/features/ResidentAssessmentViews.jsx` (`ScoreLegend`, `ScoreGrid`, `StaffEvaluationForm`)
- Modify: `src/mobile-assessment.css` (replace the marker, keep a new marker)
- Test: `tests/mobile-assessment-20261012.test.mjs`

**Interfaces:**
- `ScoreGrid` props: existing `{template, scores, onScore, comments, onComment, selfScores}` plus optional `showMissing = false`.
- DOM contract used by CSS and the harness: `.criterion-row[data-comment-open="true|false"]`, `.criterion-row[data-unanswered="true"]`, `button.criterion-comment-toggle`, `p.criterion-progress`, `.score-legend-fold[data-open="true|false"] > button.score-legend-toggle + .score-legend`, `.button-row.assessment-actions > span.assessment-progress`.

- [ ] **Step 1: Add failing source-guard tests** (append to the test file)

```js
const views = () => read("src/features/ResidentAssessmentViews.jsx");
const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to));

test("ScoreGrid keeps the radio wiring, renders full criterion text and never pre-selects a level", async () => {
  const grid = between(await views(), "export function ScoreGrid", "export function OutcomeSelect");
  assert.match(
    grid,
    /type="radio"\s+name=\{`score-\$\{criterion\.id\}`\}\s+value=\{score\}\s+checked=\{scores\[criterion\.id\] === score\}\s+onChange=\{\(\) => onScore\(criterion\.id, score\)\}/,
  );
  assert.match(grid, /<p>\{criterion\.criterion_text\}<\/p>/);
  assert.doesNotMatch(grid, /defaultChecked|\.slice\(|substring|line-clamp/);
  assert.match(grid, /maxLength="1000"/);
  assert.match(grid, /aria-label=\{`ข้อเสนอแนะ \$\{criterion\.criterion_code\}`\}/);
});

test("ScoreGrid: comment folds only when empty, rows expose open/unanswered state, counter counts real scores", async () => {
  const grid = between(await views(), "export function ScoreGrid", "export function OutcomeSelect");
  assert.match(grid, /showMissing = false/);
  assert.match(grid, /data-comment-open=\{commentOpen \? "true" : "false"\}/);
  assert.match(grid, /const commentOpen = Boolean\(openComments\[criterion\.id\] \|\| comments\[criterion\.id\]\)/);
  assert.match(grid, /data-unanswered=\{missing \? "true" : undefined\}/);
  assert.match(grid, /\{!commentOpen && \(/);
  assert.match(grid, /className="criterion-progress"/);
  assert.match(grid, /ให้คะแนนแล้ว \{answered\}\/\{template\.criteria\.length\}/);
});

test("ScoreLegend is collapsible by state (CSS decides where) and keeps its content", async () => {
  const legend = between(await views(), "export function ScoreLegend", "export function ScoreGrid");
  assert.match(legend, /className="score-legend-fold" data-open=\{open \? "true" : "false"\}/);
  assert.match(legend, /className="score-legend-toggle"/);
  assert.match(legend, /aria-expanded=\{open\}/);
  assert.match(legend, /template\?\.score_legend/);
  assert.doesNotMatch(legend, /matchMedia/);
});

test("the Staff submit payload and validation message are unchanged; the action bar and counter exist", async () => {
  const form = between(await views(), "export function StaffEvaluationForm", "export function ResidentRequestHistory");
  assert.match(
    form,
    /completeAssessmentRequest\(\{\s+requestId: request\.id,\s+outcome,\s+comment,\s+scores: template\.criteria\.map\(\(criterion\) => \(\{\s+criterionId: criterion\.id,\s+score: scores\[criterion\.id\],\s+comment: comments\[criterion\.id\] \|\| "",\s+\}\)\),\s+\}\)/,
  );
  assert.match(form, /กรุณาเลือกระดับทุกข้อก่อนลงนาม/);
  assert.match(form, /className="button-row assessment-actions"/);
  assert.match(form, /className="assessment-progress"/);
  assert.match(form, /showMissing=\{showMissing\}/);
  assert.match(form, /scrollIntoView\(\{ block: "center" \}\)/);
});

test("the Resident submit payload is unchanged", async () => {
  const form = between(await views(), "export function ResidentRequestForm", "export function StaffEvaluationForm");
  assert.match(
    form,
    /selfScores: template\.requires_self_assessment\s+\? template\.criteria\.map\(\(criterion\) => \(\{\s+criterionId: criterion\.id,\s+score: scores\[criterion\.id\],\s+comment: comments\[criterion\.id\] \|\| "",\s+\}\)\)\s+: \[\],/,
  );
  assert.match(form, /กรุณาประเมินตนเองทุกข้อก่อนส่ง Staff/);
});

test("mobile CSS: criterion cards, 44px level buttons, sticky bar below the bottom nav's z-index", async () => {
  const css = await read("src/mobile-assessment.css");
  assert.match(css, /\.criterion-row \{[^}]*grid-template-columns: repeat\(var\(--score-count, 5\), minmax\(0, 1fr\)\)/);
  assert.match(css, /\.criterion-head \{ display: none; \}/);
  assert.match(css, /min-height: var\(--score-btn-h\)/);
  assert.match(css, /\.assessment-actions \{[^}]*position: sticky;[^}]*bottom: var\(--action-bar-bottom\);[^}]*z-index: 30;/);
  const resident = await read("src/resident.css");
  assert.match(resident, /\.bottom-nav \{[^}]*z-index:40/, "bottom nav stays above the bar (30 < 40)");
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd $R && node --test tests/mobile-assessment-20261012.test.mjs`
Expected: the six new tests FAIL; the Task 3 tests still pass.

- [ ] **Step 3: Replace `ScoreLegend` and `ScoreGrid`**

In `src/features/ResidentAssessmentViews.jsx` replace the two functions `ScoreLegend` and `ScoreGrid` (currently lines 45–123, from `export function ScoreLegend` through the closing `}` before `export function OutcomeSelect`) with:

```jsx
export function ScoreLegend({ template }) {
  // Folding is decided by CSS (phone only); on desktop the legend is always shown.
  const [open, setOpen] = useState(false);
  return (
    <div className="score-legend-fold" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="score-legend-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        ความหมายของระดับ {open ? "▲" : "▼"}
      </button>
      <div className="score-legend" aria-label="ความหมายของระดับคะแนน">
        <span>
          <strong>{template?.template_type}</strong> ={" "}
          {template?.template_type === "EPA"
            ? "Entrustable Professional Activities"
            : "Procedure-Based Assessment"}
        </span>
        {(template?.score_legend || []).map(([code, meaning]) => (
          <span key={code}>
            <strong>{code}</strong> = {meaning}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ScoreGrid({
  template,
  scores,
  onScore,
  comments,
  onComment,
  selfScores,
  showMissing = false,
}) {
  // Which comment boxes the user opened on a phone. A box that already holds text stays open.
  const [openComments, setOpenComments] = useState({});
  const selfByCriterion = new Map(
    (selfScores || []).map((row) => [row.criterion_id, row]),
  );
  const answered = template.criteria.filter((criterion) => scores[criterion.id]).length;
  function openComment(id) {
    setOpenComments((current) => ({ ...current, [id]: true }));
    requestAnimationFrame(() => document.getElementById(`comment-${id}`)?.focus());
  }
  return (
    <div
      className="criterion-list"
      style={{ "--score-count": template.score_options.length }}
    >
      <p className="criterion-progress" aria-live="polite">
        ให้คะแนนแล้ว {answered}/{template.criteria.length}
      </p>
      <div className="criterion-head">
        <span>เกณฑ์ประเมิน</span>
        {template.score_options.map((score) => (
          <b key={score}>{score}</b>
        ))}
        <span>ข้อเสนอแนะ</span>
      </div>
      {template.criteria.map((criterion) => {
        const commentOpen = Boolean(openComments[criterion.id] || comments[criterion.id]);
        const missing = showMissing && !scores[criterion.id];
        return (
          <div
            className="criterion-row"
            key={criterion.id}
            data-comment-open={commentOpen ? "true" : "false"}
            data-unanswered={missing ? "true" : undefined}
          >
            <div>
              <small>{criterion.criterion_code}</small>
              {missing && <small className="criterion-missing">ยังไม่ได้เลือกระดับ</small>}
              <p>{criterion.criterion_text}</p>
              {selfByCriterion.has(criterion.id) && (
                <small className="self-score-hint">
                  Resident: {selfByCriterion.get(criterion.id).score}
                  {selfByCriterion.get(criterion.id).comment
                    ? ` · ${selfByCriterion.get(criterion.id).comment}`
                    : ""}
                </small>
              )}
            </div>
            {template.score_options.map((score) => (
              <label className="score-radio" key={score}>
                <input
                  type="radio"
                  name={`score-${criterion.id}`}
                  value={score}
                  checked={scores[criterion.id] === score}
                  onChange={() => onScore(criterion.id, score)}
                />
                <span>{score}</span>
              </label>
            ))}
            {!commentOpen && (
              <button
                type="button"
                className="criterion-comment-toggle"
                onClick={() => openComment(criterion.id)}
              >
                + ข้อเสนอแนะ
              </button>
            )}
            <input
              id={`comment-${criterion.id}`}
              aria-label={`ข้อเสนอแนะ ${criterion.criterion_code}`}
              value={comments[criterion.id] || ""}
              onChange={(event) => onComment(criterion.id, event.target.value)}
              maxLength="1000"
              placeholder="ข้อเสนอแนะ (ถ้ามี)"
            />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Edit `StaffEvaluationForm`**

(a) After `const [error, setError] = useState("");` (the one inside `StaffEvaluationForm`) add:
```jsx
  const [showMissing, setShowMissing] = useState(false);
  const [missingTick, setMissingTick] = useState(0);
```
(b) Replace
```jsx
    if (template.criteria.some((criterion) => !scores[criterion.id]))
      return setError("กรุณาเลือกระดับทุกข้อก่อนลงนาม");
```
with
```jsx
    if (template.criteria.some((criterion) => !scores[criterion.id])) {
      setShowMissing(true);
      setMissingTick((tick) => tick + 1);
      return setError("กรุณาเลือกระดับทุกข้อก่อนลงนาม");
    }
```
(c) Immediately after the `const resident = profiles.find(...)` line and **before** `async function submit`, add (hooks must stay above the early `if (!template) return`):
```jsx
  const answered = template ? template.criteria.filter((criterion) => scores[criterion.id]).length : 0;
  // The error line sits below the fold once the sign button is sticky, so bring the first empty row into view.
  useEffect(() => {
    if (!missingTick) return;
    document.querySelector('.criterion-row[data-unanswered="true"]')?.scrollIntoView({ block: "center" });
  }, [missingTick]);
```
(d) In the `<ScoreGrid …/>` of `StaffEvaluationForm` add the prop `showMissing={showMissing}` after `selfScores={request.resident_self_assessment_scores}`.
(e) Replace the final button row
```jsx
      <div className="button-row">
        <button className="primary-button" disabled={busy}>
```
with
```jsx
      <div className="button-row assessment-actions">
        <span className="assessment-progress" aria-live="polite">
          ให้คะแนนแล้ว {answered}/{template.criteria.length}
        </span>
        <button className="primary-button" disabled={busy}>
```
(the rest of the row — the two buttons — is unchanged).

- [ ] **Step 5: Add the mobile CSS**

In `src/mobile-assessment.css` replace the line `  /* @@next-rules@@ */` with:

```css
  /* --- scoring form: one card per criterion (text first, buttons under it) --- */
  .criterion-list { display: grid; gap: 10px; margin: 16px 0; border: 0; overflow: visible; }
  .criterion-head { display: none; }
  .criterion-progress { display: block; margin: 0; font-weight: 700; color: var(--text-muted); }
  .criterion-row {
    display: grid;
    grid-template-columns: repeat(var(--score-count, 5), minmax(0, 1fr));
    gap: var(--score-btn-gap);
    min-width: 0;
    padding: 12px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .criterion-row > div:first-child { grid-column: 1 / -1; min-width: 0; }
  .criterion-row > div:first-child p { margin: 4px 0 6px; overflow-wrap: anywhere; }
  .criterion-row .score-radio span {
    display: flex; align-items: center; justify-content: center;
    box-sizing: border-box; width: 100%; min-width: 0;
    min-height: var(--score-btn-h); padding: 0 2px;
  }
  .score-radio input:focus-visible + span { outline: 3px solid var(--focus); outline-offset: 2px; }
  .criterion-comment-toggle {
    display: block; grid-column: 1 / -1; min-height: var(--touch-min);
    border: 1px dashed var(--line-strong); border-radius: var(--radius-sm);
    background: transparent; color: var(--brand); font: inherit; font-weight: 700; cursor: pointer;
  }
  .criterion-row > input {
    grid-column: 1 / -1; box-sizing: border-box; width: 100%; min-width: 0;
    min-height: var(--touch-min); font-size: 16px;
  }
  .criterion-row[data-comment-open="false"] > input { display: none; }
  .criterion-row[data-unanswered="true"] { border-left: 3px solid var(--warning); }
  .criterion-missing { margin-left: 8px; color: var(--warning); font-weight: 700; }

  /* --- level legend: folded on phones --- */
  .score-legend-toggle {
    display: block; width: 100%; min-height: var(--touch-min); padding: 0 var(--card-pad);
    border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface);
    color: var(--brand); font: inherit; font-weight: 700; text-align: left; cursor: pointer;
  }
  .score-legend-fold > .score-legend { margin-top: 8px; }
  .score-legend-fold[data-open="false"] > .score-legend { display: none; }

  /* --- sign/save bar: sticky, always above the bottom nav (nav z-index is 40) --- */
  .assessment-actions {
    position: sticky; bottom: var(--action-bar-bottom); z-index: 30;
    display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px;
    margin-top: 14px; padding: 10px 0;
    border-top: 1px solid var(--line); background: var(--surface);
  }
  .assessment-actions .assessment-progress { display: block; font-weight: 700; color: var(--text-muted); }
  .assessment-actions button { width: 100%; min-height: var(--touch-min); }

  /* @@next-rules@@ */
```

- [ ] **Step 6: Run the guards, the suite and the harness**

```bash
cd $R && node --test tests/mobile-assessment-20261012.test.mjs && npm test 2>&1 | tail -8
cd $S/mobile-verify && node verify.mjs $R $S/verify-out after 2>&1 | grep -E "FAIL|checks pass"
```
Expected: unit tests PASS; suite ≥ baseline, 0 fail. Harness: all `E*`, `D2`, `D3`, `P payload …`, resident-legend and comment-reachability checks PASS. Still failing at this point (expected, done in Tasks 5–6): `Q1–Q5`, `D1`, `Q0`. If `E3` fails on width at 320 px, reduce `--score-btn-gap` to `2px` or the row padding to `12px 8px` (these are the only knobs); do not shrink height below 44.

- [ ] **Step 7: Checkpoint** — if the harness reports a payload mismatch, stop and fix before continuing (nothing else matters if saved data changed).

---

### Task 5: Staff queue cards, page order, availability card on iOS (problems 1 and 2)

**Files:**
- Modify: `src/features/ResidentPlatform.jsx` (`RequestQueue`, Staff pending page order)
- Modify: `src/mobile-assessment.css`
- Test: `tests/mobile-assessment-20261012.test.mjs`

**Interfaces:** `RequestQueue({requests, profiles, onSelect})` unchanged signature; DOM: `div.resident-table-wrap.queue-table` (existing table) + `ul.queue-cards > li.queue-card` (new).

- [ ] **Step 1: Add failing tests**

```js
const platform = () => read("src/features/ResidentPlatform.jsx");

test("RequestQueue renders the table and a card list from the same rows, both opening the same request", async () => {
  const src = await platform();
  const queue = between(src, "function RequestQueue", "function Notifications");
  assert.match(queue, /className="resident-table-wrap queue-table"/);
  assert.match(queue, /<ul className="queue-cards">/);
  assert.equal((queue.match(/onClick=\{\(\) => onSelect\(request\)\}/g) || []).length, 2);
  assert.match(queue, /ครั้งที่ \{request\.attempt_number\}/);
});

test("Staff pending page shows the queue before the availability card", async () => {
  const src = await platform();
  const page = between(src, 'tab === "pending" ?', 'tab === "notifications" ?');
  assert.ok(page.indexOf("<RequestQueue") > -1 && page.indexOf("<RequestQueue") < page.indexOf("<StaffAvailabilityCard"));
});

test("mobile CSS: queue cards replace the table; the date field is full width with the native look removed", async () => {
  const css = await read("src/mobile-assessment.css");
  assert.match(css, /\.queue-table \{ display: none; \}/);
  assert.match(css, /\.queue-cards \{[^}]*display: grid;/);
  const date = css.slice(css.indexOf('.staff-availability input[type="date"]'));
  assert.match(date.slice(0, date.indexOf("}")), /width: 100%/);
  assert.match(date.slice(0, date.indexOf("}")), /-webkit-appearance: none;\s*appearance: none;/);
  assert.match(css, /\.staff-availability \.availability-row \{ display: grid;/);
});
```
(`between` is the helper from Task 4. If the slice start `tab === "pending" ?` is not found verbatim, use the exact text from `ResidentPlatform.jsx` line ~982.)

- [ ] **Step 2: Run, see them fail**, then **Step 3: edit `RequestQueue`**

Change `<div className="resident-table-wrap">` (inside `RequestQueue`, line ~86) to:
```jsx
      {/* Phone shows .queue-cards instead of this table; a column added here must be added to the card too. */}
      <div className="resident-table-wrap queue-table">
```
and directly after that `</div>` (the one closing the table wrapper, before `</section>`) insert:
```jsx
      <ul className="queue-cards">
        {pending.map((request) => (
          <li className="queue-card" key={request.id}>
            <small>{readableDateTime(request.submitted_at)}</small>
            <strong>
              {request.resident_template_definitions?.template_code} ·{" "}
              {request.resident_template_definitions?.title}
            </strong>
            <span>
              {names.get(request.resident_id) || "—"} · ครั้งที่ {request.attempt_number}
            </span>
            <span>{request.procedure_or_activity}</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onSelect(request)}
            >
              เปิดประเมิน
            </button>
          </li>
        ))}
      </ul>
```

- [ ] **Step 4: Swap the Staff page order** — in the `tab === "pending"` branch replace
```jsx
            <>
              {workspace.user.role === "staff" && (
                <StaffAvailabilityCard workspace={workspace} onSaved={onRefresh} />
              )}
              <RequestQueue
              requests={workspace.requests}
              profiles={workspace.allProfiles || workspace.profiles}
              onSelect={setSelectedRequest}
            />
            </>
```
with
```jsx
            <>
              <RequestQueue
                requests={workspace.requests}
                profiles={workspace.allProfiles || workspace.profiles}
                onSelect={setSelectedRequest}
              />
              {workspace.user.role === "staff" && (
                <StaffAvailabilityCard workspace={workspace} onSaved={onRefresh} />
              )}
            </>
```

- [ ] **Step 5: CSS** — replace the marker `  /* @@next-rules@@ */` in `src/mobile-assessment.css` with:

```css
  /* --- Staff queue: cards instead of a sideways-scrolling table --- */
  .queue-table { display: none; }
  .queue-cards { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .queue-card {
    display: grid; gap: 4px; padding: var(--card-pad);
    border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface);
    overflow-wrap: anywhere;
  }
  .queue-card small { color: var(--text-muted); }
  .queue-card button { width: 100%; min-height: var(--touch-min); margin-top: 6px; }

  /* --- "การรับประเมินของคุณ" card: stacked, nothing can run under a button (iOS date field) --- */
  .staff-availability .availability-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .staff-availability .availability-row label { min-width: 0; }
  .staff-availability input[type="date"] {
    box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0;
    min-height: var(--touch-min); -webkit-appearance: none; appearance: none;
  }
  .staff-availability .availability-row button { width: 100%; min-height: var(--touch-min); }

  /* @@next-rules@@ */
```

- [ ] **Step 6: Verify**

```bash
cd $R && node --test tests/mobile-assessment-20261012.test.mjs && npm test 2>&1 | tail -8
cd $S/mobile-verify && node verify.mjs $R $S/verify-out after 2>&1 | grep -E "FAIL|checks pass"
```
Expected: `Q0–Q5` and `D1` now PASS; payload checks PASS; only nothing (or the Task 6 items, which have no harness check) remains failing. Existing test `resident-attempt-rules.test.mjs` still passes (Task 6 changes its regex).

- [ ] **Step 7: Checkpoint** — suite green.

---

### Task 6: Resident submit page: fewer rule boxes (problem 4)

**Files:**
- Create: `src/ruleMessageFilter.js`
- Modify: `src/features/ResidentAssessmentViews.jsx` (`RuleMessages`, `LevelProgressNotice`, `ResidentRequestForm` call site + PBA note)
- Modify: `tests/resident-attempt-rules.test.mjs` (one regex, line ~180)
- Modify: `src/mobile-assessment.css`
- Test: `tests/mobile-assessment-20261012.test.mjs`

**Interfaces:**
- Produces: `visibleRuleWarnings(rules: {reasons: object[], warnings: object[]}, options?: {hideAlreadyMet?: boolean}): object[]`.
- Consumes: `evaluateRequestRules()` output (unchanged; warning codes `same-staff-before`, `variety`, `already-met`).

- [ ] **Step 1: Failing tests** (append; also covers Review Focus: no red+yellow together)

```js
import { visibleRuleWarnings } from "../src/ruleMessageFilter.js";

test("visibleRuleWarnings: a blocked form shows no yellow warnings, and 'already met' is left to the green notice", () => {
  const warnings = [{ code: "same-staff-before" }, { code: "variety" }, { code: "already-met" }];
  assert.deepEqual(visibleRuleWarnings({ reasons: [{ code: "limit" }], warnings }), []);
  assert.deepEqual(
    visibleRuleWarnings({ reasons: [], warnings }, { hideAlreadyMet: true }).map((w) => w.code),
    ["same-staff-before", "variety"],
  );
  assert.deepEqual(
    visibleRuleWarnings({ reasons: [], warnings }).map((w) => w.code),
    ["same-staff-before", "variety", "already-met"],
    "without the green notice (EPA-8, PBA) the advice is still shown",
  );
  assert.deepEqual(visibleRuleWarnings({ reasons: [], warnings: [] }), []);
});

test("Resident page wiring: filter used, green notice carries the advice, PBA note is a plain line on phones", async () => {
  const src = await views();
  assert.match(between(src, "function RuleMessages", "// Progress toward the level"), /visibleRuleWarnings\(rules, \{ hideAlreadyMet \}\)/);
  assert.match(src, /ไม่จำเป็นต้องส่งเพิ่ม \(ส่งได้ถ้ายังเหลือครั้งและอยากดูพัฒนาการ\)/);
  const form = between(src, "export function ResidentRequestForm", "export function StaffEvaluationForm");
  assert.equal((form.match(/<RuleMessages rules=\{rules\} hideAlreadyMet=\{Boolean\(levelThreshold\(template\) && progress\?\.met\)\} \/>/g) || []).length, 1);
  assert.match(form, /className="source-note pba-guidance"/);
  const css = await read("src/mobile-assessment.css");
  assert.match(css, /\.pba-guidance \{[^}]*background: none;/);
});
```
Run: expect FAIL (module not found).

- [ ] **Step 2: Create the helper** `src/ruleMessageFilter.js`:

```js
// Which yellow warnings the Resident submit page shows.
// A blocked form shows only the red reasons; "already met" is shown by the green level notice instead of a second box.
export function visibleRuleWarnings(rules, { hideAlreadyMet = false } = {}) {
  if (rules.reasons.length) return [];
  return rules.warnings.filter((item) => !(hideAlreadyMet && item.code === "already-met"));
}
```

- [ ] **Step 3: Edit the views**

(a) Add to the imports at the top of `ResidentAssessmentViews.jsx`, after the `residentAssessmentRules` import block:
```jsx
import { visibleRuleWarnings } from "../ruleMessageFilter";
```
(b) Replace `RuleMessages` with:
```jsx
function RuleMessages({ rules, hideAlreadyMet = false }) {
  const warnings = visibleRuleWarnings(rules, { hideAlreadyMet });
  if (!rules.reasons.length && !warnings.length) return null;
  return (
    <div className="rule-messages" aria-live="polite">
      {rules.reasons.map((item) => (
        <p className="rule-blocked" key={item.code}>
          ✗ {item.text}
        </p>
      ))}
      {warnings.map((item) => (
        <p className="rule-warning" key={item.code}>
          △ {item.text}
        </p>
      ))}
    </div>
  );
}
```
(c) In `LevelProgressNotice` replace the met line
```jsx
        ✓ แบบนี้ถึงเกณฑ์แล้ว (ทุกข้อในใบประเมินใบเดียวได้ {threshold.label} ขึ้นไป)
```
with
```jsx
        ✓ แบบนี้ถึงเกณฑ์แล้ว (ทุกข้อในใบประเมินใบเดียวได้ {threshold.label} ขึ้นไป) · ไม่จำเป็นต้องส่งเพิ่ม (ส่งได้ถ้ายังเหลือครั้งและอยากดูพัฒนาการ)
```
(d) In `ResidentRequestForm` replace `<RuleMessages rules={rules} />` with
```jsx
          <RuleMessages rules={rules} hideAlreadyMet={Boolean(levelThreshold(template) && progress?.met)} />
```
(e) In the PBA note change `<p className="source-note">` (the one before `{(template.recommended_pgy || []).includes(user.pgy)`) to `<p className="source-note pba-guidance">`.

- [ ] **Step 4: Update the one existing guard** — in `tests/resident-attempt-rules.test.mjs` (~line 180) replace
```js
  assert.equal((form.match(/<RuleMessages rules=\{rules\} \/>/g) || []).length, 1);
```
with
```js
  assert.equal((form.match(/<RuleMessages rules=\{rules\} hideAlreadyMet=\{Boolean\(levelThreshold\(template\) && progress\?\.met\)\} \/>/g) || []).length, 1);
```

- [ ] **Step 5: CSS** — replace the marker `  /* @@next-rules@@ */` with:

```css
  /* --- Resident submit page: PBA guidance is a plain muted line, not another box --- */
  .pba-guidance {
    margin: 4px 0; padding: 0; border-left: 0; background: none;
    color: var(--text-muted); font-size: 13px;
  }
```
and **delete the marker line entirely** (no marker may remain). Add this guard to the test file:

```js
test("no leftover plan markers in the stylesheet", async () => {
  assert.doesNotMatch(await read("src/mobile-assessment.css"), /@@next-rules@@/);
});
```

- [ ] **Step 6: Verify everything**

```bash
cd $R && npm test 2>&1 | tail -8 && npx vite build 2>&1 | tail -4
cd $S/mobile-verify && node verify.mjs $R $S/verify-out after 2>&1 | tail -45
```
Expected: suite green (≥ baseline + new tests), build OK, harness `N/N checks pass` with exit code 0.

- [ ] **Step 7: Checkpoint** — all green.

---

### Task 7: Final verification and delivery

**Files:** produces `$S/mobile-round1.patch`; no source changes unless a check fails.

- [ ] **Step 1: Protected files untouched**

```bash
cd $R && shasum -a 256 -c $S/protected.sha256
```
Expected: six `OK`. Any `FAILED` → revert that file from `$S/baseline/` and re-run.

- [ ] **Step 2: Style/token compliance**

```bash
node ~/.claude/skills/design-system/scripts/validate-tokens.cjs --dir $R/src 2>&1 | grep -i "mobile-assessment" || echo "no hard-coded values reported for mobile-assessment.css"
```
Expected: no findings for `mobile-assessment.css`. (Findings in other pre-existing files are not this change's concern.)

- [ ] **Step 3: Preview bundle still builds** (it imports the new CSS)

```bash
cd $R && npm run build:corner-preview -- $S/preview-check/Resident_Corner_Local_Preview.html 2>&1 | tail -3
```
Expected: "Standalone offline preview: … bytes".

- [ ] **Step 4: Full run, fresh output directory**

```bash
cd $S/mobile-verify && rm -rf $S/verify-final && mkdir $S/verify-final && cp $S/verify-out/payloads-baseline.json $S/verify-final/ && node verify.mjs $R $S/verify-final after 2>&1 | tail -50
cd $R && npm test 2>&1 | tail -6 && npx vite build 2>&1 | tail -3
```
Expected: harness exit 0 with every check PASS; `npm test` `# fail 0`; build OK. Paste the PASS/FAIL table and the pass count into the report, stating the environment of each result (Node tests / headless Chrome 390, 320, 1280 on the real components with a Supabase stub). State explicitly that nothing was verified on iOS.

- [ ] **Step 5: Produce the patch against the pristine snapshot**

```bash
cd $S && rm -rf pa && mkdir -p pa/a pa/b
cp -R baseline/src baseline/preview baseline/tests baseline/docs pa/a/
cp -R $R/src $R/preview $R/tests $R/docs pa/b/
(cd pa && diff -ruN a b > $S/mobile-round1.patch; true)
diffstat $S/mobile-round1.patch 2>/dev/null || grep -c '^+++ ' $S/mobile-round1.patch
grep '^+++ ' $S/mobile-round1.patch
```
Expected changed files only: `src/mobile-assessment.css`, `src/ruleMessageFilter.js`, `src/main.jsx`, `preview/main.jsx`, `src/features/ResidentAssessmentViews.jsx`, `src/features/ResidentPlatform.jsx`, `tests/mobile-assessment-20261012.test.mjs`, `tests/resident-attempt-rules.test.mjs`, and the two docs files under `docs/superpowers/`. Apply elsewhere with `patch -p1 < mobile-round1.patch` from the repo root.

- [ ] **Step 6: Report** — files changed, the verification table, screenshot paths (`$S/verify-final/after-*.png`), and the open items: (1) iPhone confirmation of the date field and the sticky bar; (2) do **not** apply `mobilefix/availability-card-mobile-files_v1.zip` on top (same selectors); (3) baseline snapshot of this folder must be confirmed equal to `main` `678a2a8` before merging the patch; (4) a human other than the author should review the patch before merge.

---

## Self-Review (done after writing)

**Spec coverage:** §4.1 tokens → Task 3. §4.2 cards/comment fold/counter/`showMissing` → Task 4. §4.3 legend fold → Task 4 (amended: state + CSS, no `matchMedia`). §4.4 sticky bar → Task 4. §4.5 queue cards + order → Task 5. §4.6 iOS date → Task 5. §4.7 rule boxes → Task 6 (amended: one new helper file). §6 verification (guards, payload identity, layout, build) → Tasks 2–7; payload identity uses a recording Supabase stub with the real components instead of the offline preview shim (the shim cannot reach the forms). §8 acceptance 1–7 → harness checks Q/E/D/P + Task 7 steps.

**Placeholder scan:** none; every code step has full code. Two deliberate "knobs" (CSS gap/padding at 320 px; nav label text) name exactly what to adjust.

**Type consistency:** `showMissing`, `openComments`, `commentOpen`, `answered`, `missingTick`, `visibleRuleWarnings(rules, { hideAlreadyMet })`, DOM attributes (`data-comment-open`, `data-unanswered`, `data-open`) and class names are identical in JSX, CSS, tests and harness.
