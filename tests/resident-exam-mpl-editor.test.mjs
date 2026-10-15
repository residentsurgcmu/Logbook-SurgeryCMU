import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the score grid sends scores only and recomputes the badge from the MPL snapshot", async () => {
  const src = await read("../src/features/ExamScoreEditor.jsx");
  assert.match(src, /export default function ExamScoreEditor\(\{ event, onRefresh, onDeleted, scoreError \}\)/);
  assert.match(src, /saveResidentExamScores\(event\.id, records, mplDirty \? stateToMplRows\(mplState\) : null\)/);
  assert.doesNotMatch(src, /outcome:\s*value/);
  assert.match(src, /examOutcome\(score, mplFor\(mplState, part\.id, participant\.pgy\)\)/);
  assert.match(src, /outcomeLabel\(outcome, "computed"\)/);
  assert.match(src, /listExamMpl\(event\.id\)/);
});

test("MPL edits are saved before the scores, and only while the exam is a draft", async () => {
  const src = await read("../src/features/ExamScoreEditor.jsx");
  assert.ok(src.indexOf("await updateExamMpl(") < src.indexOf("await saveResidentExamScores("), "MPL first so the server recomputes then re-saves");
  assert.match(src, /const disabled = event\.status !== "draft" \|\| Boolean\(busy\)/);
  assert.match(src, /mplError\(mplState\[mplMapKey\(/);
});

test("publishing warns (but does not block) when cells have no MPL and requires every score", async () => {
  const src = await read("../src/features/ExamScoreEditor.jsx");
  assert.match(src, /missingMplCount\(/);
  assert.match(src, /window\.confirm\(`มี \$\{missing\} ช่องที่ยังไม่ตั้งเกณฑ์ MPL/);
  assert.match(src, /กรุณากรอกคะแนนให้ครบทุก Resident ก่อนเผยแพร่/);
  assert.match(src, /setResidentExamPublication\(event\.id, true\)/);
});

test("the exam page chooses the editor by scoring mode and keeps the legacy editor for manual exams", async () => {
  const src = await read("../src/features/ResidentExams.jsx");
  assert.match(src, /import ExamScoreEditor from "\.\/ExamScoreEditor"/);
  assert.match(src, /selected\.scoringMode === "mpl" \? <ExamScoreEditor key=\{selected\.id\} event=\{selected\} onRefresh=\{onRefresh\} onDeleted=\{afterDelete\} scoreError=\{examScoreError\} \/> : <ExamEditor key=\{selected\.id\} event=\{selected\} onRefresh=\{onRefresh\} onDeleted=\{afterDelete\} \/>/);
});

test("typed scores survive a background reload: the reset effect depends on the exam id and status, not on the results Map", async () => {
  const src = await read("../src/features/ExamScoreEditor.jsx");
  const start = src.indexOf("const initial = {};");
  const effect = src.slice(start, src.indexOf("}, [", start) + 40);
  assert.match(effect, /\}, \[event\.id, event\.status\]\);/);
  assert.doesNotMatch(effect, /event\.results\]/);
});

test("the editor is remounted per exam so MPL state and the dirty flag never carry over", async () => {
  const src = await read("../src/features/ResidentExams.jsx");
  assert.match(src, /<ExamScoreEditor key=\{selected\.id\} event=\{selected\}/);
});

test("the MPL rows travel with the scores in one call (one transaction), not in two", async () => {
  const [editor, api] = await Promise.all([read("../src/features/ExamScoreEditor.jsx"), read("../src/residentApi.js")]);
  assert.doesNotMatch(editor, /await updateExamMpl\(/);
  assert.match(editor, /saveResidentExamScores\(event\.id, records, mplDirty \? stateToMplRows\(mplState\) : null\)/);
  assert.match(api, /export async function saveResidentExamScores\(eventId, results, mplRows = null\)/);
  assert.match(api, /p_mpl: mplRows,/);
});

test("the browser score check has the same 8-digit limit as the server", async () => {
  const src = await read("../src/features/ResidentExams.jsx");
  const body = src.slice(src.indexOf("export function examScoreError"), src.indexOf("const today = () =>"));
  const examScoreError = new Function(`${body.replace("export function", "function")}; return examScoreError;`)();
  assert.equal(examScoreError("12345678.5", null), "");
  assert.notEqual(examScoreError("123456789", null), "");
});

test("the create form keeps typed values: standards prefill only an untouched section and switching type loses nothing", async () => {
  const src = await read("../src/features/ResidentExams.jsx");
  assert.match(src, /const editedParts = useRef\(false\)/);
  assert.match(src, /const editedMcq = useRef\(false\)/);
  const start = src.indexOf("// Copy the central standards");
  const effect = src.slice(start, src.indexOf("]);", src.indexOf("}, [", start)) + 3);
  assert.match(effect, /if \(!editedParts\.current\)/);
  assert.match(effect, /if \(!editedMcq\.current\)/);
  assert.match(effect, /\}, \[standards\]\);/);
});

test("the grids stay usable on narrow and mid-width screens", async () => {
  const css = await read("../src/resident.css");
  assert.match(css, /@media \(max-width:1100px\) \{[^}]*\.exam-standard-row,\.exam-part-row-mpl \{ grid-template-columns:minmax\(0,1fr\); \}/);
  assert.match(css, /\.exam-editor-table th:first-child,\.exam-editor-table td:first-child \{ position:sticky; left:0;/);
});
