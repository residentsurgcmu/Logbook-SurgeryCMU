import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = await readFile(new URL("../src/features/ResidentExams.jsx", import.meta.url), "utf8");

test("the published table shows score / full score, MPL and a badge for MPL exams, and the legacy cell for manual exams", () => {
  assert.match(src, /function MplCell\(\{ result, mpl, max \}\)/);
  assert.match(src, /ยังไม่ตั้งเกณฑ์/);
  assert.match(src, /MPL \$\{mpl\}/);
  assert.match(src, /event\.scoringMode === "mpl"/);
  assert.match(src, /outcomeLabel\(result\.outcome, result\.outcomeSource\)/);
  assert.match(src, /outcomeLabel\(\s*event\.results\.get\(resultKey\(participant\.id, part\.id\)\)\?\.outcome,?\s*\)/);
});

test("Staff get a pass / not pass filter next to the PGY and Resident filters", () => {
  assert.match(src, /const \[outcomeFilter, setOutcomeFilter\] = useState\(""\)/);
  assert.match(src, /ผล<select value=\{outcomeFilter\}/);
  assert.match(src, /<option value="pass">ผ่านทุก part<\/option>/);
  assert.match(src, /<option value="fail">ไม่ผ่านอย่างน้อย 1 part<\/option>/);
  assert.match(src, /participantOutcome\(event, participant\) === outcomeFilter/);
});

test("the Resident view is not given the Staff filters", () => {
  assert.match(src, /user\.role === "staff" && <section className="resident-panel exam-filters">/);
});
