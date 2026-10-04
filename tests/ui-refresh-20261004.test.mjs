import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BOTTOM_NAV, bottomNav } from "../src/navGroups.js";
import { STALE_PENDING_DAYS, TARGET_ASSESSMENTS_PER_FORM, buildDashboard, pendingAgeDays } from "../src/residentAnalytics.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const DAY = 86400000;
const NOW = Date.parse("2026-10-04T05:00:00Z");

test("Noto Sans Thai is actually loaded and every stylesheet uses the shared font token", async () => {
  const tokens = await read("src/tokens.css");
  assert.match(tokens, /@font-face \{[^}]*"Noto Sans Thai"[^}]*\/fonts\/NotoSansThai\.ttf[^}]*font-display: swap/);
  const main = await read("src/main.jsx");
  assert.ok(main.indexOf("./tokens.css") < main.indexOf("./styles.css"), "tokens load before the sheets that use them");
  for (const file of ["src/styles.css", "src/resident.css"]) {
    assert.match(await read(file), /font-family:\s*var\(--font-sans\)/, file);
  }
  assert.match(await read("index.html"), /rel="preload" href="\/fonts\/NotoSansThai\.ttf"/);
});

test("one brand focus ring, no purple, no heavy halo and no blur on controls", async () => {
  const css = (await read("src/resident.css")) + (await read("src/styles.css"));
  assert.doesNotMatch(css, /5336d9|83, 54, 217/i);
  assert.doesNotMatch(css, /outline-offset: 4px !important/);
  assert.match(css, /:where\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible \{\s*outline: 3px solid var\(--focus\);/);
  const withBlur = [...(await read("src/resident.css")).matchAll(/([^{}]+)\{[^}]*backdrop-filter:[^}]*\}/g)].map((m) => m[1].trim());
  assert.deepEqual(withBlur, [".app-topbar"]);
});

test("legacy colour names alias the tokens instead of repeating hex values", async () => {
  const styles = await read("src/styles.css");
  assert.match(styles, /--wine: var\(--brand\)/);
  assert.match(await read("src/resident.css"), /--resident-green:var\(--brand\)/);
});

test("phone bottom bar: at most four shortcuts per role, all real tabs, plus the menu", () => {
  const nav = [["request", "x"], ["history", "x"], ["qr", "x"], ["cases", "x"], ["notifications", "x"]];
  assert.deepEqual(bottomNav("resident", nav).map(([id]) => id), ["request", "history", "qr", "cases"]);
  assert.deepEqual(bottomNav("resident", [["request", "x"]]).map(([id]) => id), ["request"]);
  assert.deepEqual(bottomNav("nobody", nav), []);
  for (const [role, items] of Object.entries(BOTTOM_NAV)) assert.ok(items.length <= 4, `${role} + menu stays within five slots`);
});

test("the shell renders badges from counts, a bottom bar, and one shared navigate function", async () => {
  const shell = await read("src/features/ResidentPlatform.jsx");
  assert.match(shell, /<nav className="bottom-nav" aria-label="เมนูด่วน">/);
  assert.match(shell, /function NavBadge\(\{ count \}\)/);
  assert.doesNotMatch(shell, /รอประเมิน \(\$\{/, "counts are badges, not part of the label");
  assert.match(shell, /onClick=\{\(\) => goTo\(id\)\}/);
  assert.match(shell, /onClick=\{\(\) => setMenuOpen\(true\)\}/);
  const css = await read("src/resident.css");
  assert.match(css, /\.bottom-nav \{ display:none; \}/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(await read("index.html"), /viewport-fit=cover/);
});

const template = (id, type) => ({ id, template_type: type, template_code: `${type}-${id}` });
const withType = (assessment, type) => ({ ...assessment, resident_template_definitions: { template_type: type, template_code: assessment.template_id } });

test("coverage counts distinct assessed forms, not repeat assessments of one form", () => {
  const workspace = {
    profiles: [], staffDirectory: [], requests: [],
    templates: [template("e1", "EPA"), template("e2", "EPA"), template("e3", "EPA"), template("p1", "PBA")],
    assessments: [withType({ id: "a", template_id: "e1" }, "EPA"), withType({ id: "b", template_id: "e1" }, "EPA")],
  };
  const [epa, pba] = buildDashboard(workspace, NOW).typeTotals;
  assert.equal(epa.completed, 2);
  assert.equal(epa.covered, 1);
  assert.equal(epa.coveragePercent, 33);
  assert.equal(pba.covered, 0);
  assert.equal(pba.coveragePercent, 0);
});

test("completion rate is a share of requests and is 0, not NaN, with no requests", () => {
  const empty = buildDashboard({ profiles: [], staffDirectory: [], requests: [], templates: [], assessments: [] }, NOW);
  assert.deepEqual(empty.typeTotals.map((t) => [t.completionPercent, t.coveragePercent]), [[0, 0], [0, 0]]);
  const one = buildDashboard({
    profiles: [], staffDirectory: [], templates: [template("e1", "EPA")],
    requests: [{ id: "r", status: "pending", submitted_at: new Date(NOW).toISOString(), resident_template_definitions: { template_type: "EPA" } }],
    assessments: [withType({ id: "a", template_id: "e1" }, "EPA")],
  }, NOW);
  assert.equal(one.typeTotals[0].completionPercent, 50);
});

test("the pending queue is oldest first and flags requests waiting a week or more", () => {
  assert.equal(pendingAgeDays(new Date(NOW - 2.5 * DAY).toISOString(), NOW), 2);
  assert.equal(pendingAgeDays(new Date(NOW + DAY).toISOString(), NOW), 0, "a future date is never negative");
  assert.equal(pendingAgeDays(null, NOW), 0);
  const at = (days) => new Date(NOW - days * DAY).toISOString();
  const dashboard = buildDashboard({
    profiles: [], staffDirectory: [], templates: [], assessments: [],
    requests: [
      { id: "new", status: "pending", submitted_at: at(1) },
      { id: "old", status: "pending", submitted_at: at(STALE_PENDING_DAYS) },
      { id: "mid", status: "pending", submitted_at: at(3) },
      { id: "done", status: "completed", submitted_at: at(30) },
    ],
  }, NOW);
  assert.deepEqual(dashboard.pendingQueue.map((item) => item.request.id), ["old", "mid", "new"]);
  assert.deepEqual(dashboard.stalePending.map((item) => item.request.id), ["old"]);
});

test("the home page is role specific and the old misleading percentage is relabelled", async () => {
  const page = await read("src/features/ResidentDashboard.jsx");
  assert.match(page, /function HomeHero/);
  assert.match(page, /onOpenRequest\(request\)/);
  assert.match(page, /role="progressbar"/);
  assert.match(page, /TARGET_ASSESSMENTS_PER_FORM/);
  assert.match(page, /ประเมินเสร็จ ÷ \(ประเมินเสร็จ \+ ยังรอ\)/);
});

test("target progress: 2 assessments per form, extra assessments of one form never hide a gap", () => {
  assert.equal(TARGET_ASSESSMENTS_PER_FORM, 2);
  const a = (id, tid) => withType({ id, template_id: tid }, "EPA");
  const workspace = {
    profiles: [], staffDirectory: [], requests: [],
    templates: [template("e1", "EPA"), template("e2", "EPA"), template("e3", "EPA")],
    assessments: [a("1", "e1"), a("2", "e1"), a("3", "e1"), a("4", "e2")],
  };
  const epa = buildDashboard(workspace, NOW).typeTotals[0];
  assert.equal(epa.targetMet, 1, "only e1 reached 2");
  assert.equal(epa.targetDone, 3, "e1 counts 2 (not 3) + e2 counts 1");
  assert.equal(epa.targetTotal, 6);
  assert.equal(epa.targetPercent, 50);
  const none = buildDashboard({ profiles: [], staffDirectory: [], requests: [], templates: [], assessments: [] }, NOW).typeTotals[0];
  assert.deepEqual([none.targetTotal, none.targetPercent], [0, 0]);
});
