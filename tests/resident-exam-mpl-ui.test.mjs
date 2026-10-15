import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("MplInputs renders one labelled input per PGY 1-4", async () => {
  const src = await read("../src/features/ExamMplFields.jsx");
  assert.match(src, /export function MplInputs\(/);
  assert.match(src, /PGY_LEVELS\.map\(\(pgy\)/);
  assert.match(src, /aria-label=\{`MPL PGY \$\{pgy\}/);
});

test("the standards page validates before saving and reports the part name", async () => {
  const src = await read("../src/features/ExamStandards.jsx");
  assert.match(src, /fullScoreError\(row\.maxScore\)/);
  assert.match(src, /mplError\(row\.mpl\[pgy\], row\.maxScore\)/);
  assert.match(src, /saveExamStandards\(/);
  assert.match(src, /เกณฑ์ MPL ตามชั้นปี/);
  assert.match(src, /examType: "mcq", partName: "MCQ"/);
});

test("the create form pre-fills from the standards and creates an MPL exam", async () => {
  const src = await read("../src/features/ResidentExams.jsx");
  assert.match(src, /import \{ MplInputs \} from "\.\/ExamMplFields"/);
  assert.match(src, /import ExamStandards from "\.\/ExamStandards"/);
  assert.match(src, /function NewExamForm\(\{ residents, standards, onCreated \}\)/);
  assert.match(src, /createResidentExamMpl\(\{/);
  assert.doesNotMatch(src, /createResidentExam\(\{/);
  assert.match(src, /if \(participantsFilled\.current \|\| !residentIds\.length\) return;/);
  assert.match(src, /fullScoreError\(part\.maxScore\)/);
  assert.match(src, /mplError\(part\.mpl\[pgy\], part\.maxScore\)/);
});

test("the Admin view has a switch between exams and the MPL standards", async () => {
  const src = await read("../src/features/ResidentExams.jsx");
  assert.match(src, /listExamStandards\(\)/);
  assert.match(src, /<ExamStandards standards=\{standards\} onSaved=\{setStandards\} \/>/);
  assert.match(src, /เกณฑ์ MPL/);
});
