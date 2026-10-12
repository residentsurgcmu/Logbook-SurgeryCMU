import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { visibleRuleWarnings } from "../src/ruleMessageFilter.js";

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
  assert.doesNotMatch(form, /assessment-progress|const answered/, "the bar has no counter of its own (one aria-live counter, in ScoreGrid)");
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

test("no leftover plan markers in the stylesheet", async () => {
  assert.doesNotMatch(await read("src/mobile-assessment.css"), /@@next-rules@@/);
});

test("final review: save errors are announced and scrolled into view; one aria-live counter; sync focus; a11y names", async () => {
  const src = await views();
  const form = between(src, "export function StaffEvaluationForm", "export function ResidentRequestHistory");
  assert.match(form, /<p className="form-error" role="alert">\{error\}<\/p>/);
  const catchBlock = form.slice(form.indexOf("} catch (nextError)"), form.indexOf("} finally"));
  assert.match(catchBlock, /setError\(nextError\.message \|\| "บันทึกผลประเมินไม่สำเร็จ"\)/);
  assert.match(catchBlock, /requestAnimationFrame\(\(\) => document\.querySelector\("form\.assessment-form \.form-error"\)\?\.scrollIntoView\(\{ block: "center" \}\)\)/);
  assert.equal((form.match(/aria-live/g) || []).length, 0, "Staff form itself has no aria-live; the ScoreGrid counter is the only one");
  const grid = between(src, "export function ScoreGrid", "export function OutcomeSelect");
  assert.equal((grid.match(/aria-live/g) || []).length, 1);
  assert.match(src, /import \{ flushSync \} from "react-dom";/);
  assert.match(grid, /flushSync\(\(\) => setOpenComments\(\(current\) => \(\{ \.\.\.current, \[id\]: true \}\)\)\);\s+document\.getElementById\(`comment-\$\{id\}`\)\?\.focus\(\);/);
  assert.doesNotMatch(grid, /requestAnimationFrame/);
  assert.match(grid, /aria-label=\{`เพิ่มข้อเสนอแนะ \$\{criterion\.criterion_code\}`\}/);
  const legend = between(src, "export function ScoreLegend", "export function ScoreGrid");
  assert.match(legend, /useId\(\)/);
  assert.match(legend, /aria-controls=\{legendId\}/);
  assert.match(legend, /id=\{legendId\} aria-label="ความหมายของระดับคะแนน"/);
});

test("final review CSS: side-by-side bar buttons, no bar counter, scroll padding, no radio margin, base missing-label margin", async () => {
  const css = await read("src/mobile-assessment.css");
  assert.doesNotMatch(css, /assessment-progress/);
  assert.match(css, /--action-bar-height:\s*\d+px/);
  assert.match(css, /\.assessment-actions \{[^}]*grid-template-columns: minmax\(0, 2fr\) minmax\(0, 1fr\)/);
  assert.match(css, /html:has\(\.assessment-actions\) \{ scroll-padding-bottom: calc\(var\(--action-bar-bottom\) \+ var\(--action-bar-height\)\); \}/);
  assert.match(css, /\.criterion-row \.score-radio \{ margin: 0; \}/);
  const base = css.slice(0, css.indexOf("@media (max-width: 900px)"));
  assert.match(base, /\.criterion-missing \{ margin-left: 8px; \}/);
});
