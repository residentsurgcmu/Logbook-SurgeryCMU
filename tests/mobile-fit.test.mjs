import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/resident.css", import.meta.url), "utf8");

test("the phone bottom bar spreads its buttons over the full width whatever their count", () => {
  const rule = [...css.matchAll(/\.bottom-nav \{[^}]*\}/g)].map((match) => match[0]).find((text) => text.includes("position:fixed")) ?? "";
  assert.match(css, /@media \(max-width:900px\)/);
  assert.match(rule, /grid-auto-flow:\s*column/);
  assert.match(rule, /grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(rule, /repeat\(5/);
});

test("single-column phone grids use minmax(0, 1fr) so wide content cannot push the page past the screen", async () => {
  for (const file of ["resident.css", "residentCorner.css", "mobile-assessment.css", "mySpace.css", "seatMap.css", "features/AdminAttemptPages.css"]) {
    const text = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    const bare = text.match(/grid-template-columns:\s*1fr\s*(?=[;}!])/g) || [];
    assert.deepEqual(bare, [], `${file} still has a bare 1fr single column`);
  }
});
