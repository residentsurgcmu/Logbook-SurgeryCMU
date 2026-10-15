import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the score grid sends scores only and recomputes the badge from the MPL snapshot", async () => {
  const src = await read("../src/features/ExamScoreEditor.jsx");
  assert.match(src, /export default function ExamScoreEditor\(\{ event, onRefresh, scoreError \}\)/);
  assert.match(src, /saveResidentExamScores\(event\.id, records\)/);
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
  assert.match(src, /selected\.scoringMode === "mpl" \? <ExamScoreEditor event=\{selected\} onRefresh=\{onRefresh\} scoreError=\{examScoreError\} \/> : <ExamEditor event=\{selected\} onRefresh=\{onRefresh\} \/>/);
});

test("typed scores survive a background reload: the reset effect depends on the exam id and status, not on the results Map", async () => {
  const src = await read("../src/features/ExamScoreEditor.jsx");
  const start = src.indexOf("const initial = {};");
  const effect = src.slice(start, src.indexOf("}, [", start) + 40);
  assert.match(effect, /\}, \[event\.id, event\.status\]\);/);
  assert.doesNotMatch(effect, /event\.results\]/);
});
