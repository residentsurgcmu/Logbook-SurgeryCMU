import assert from "node:assert/strict";
import test from "node:test";
import { residentTemplates } from "../src/generated/residentTemplates.js";

test("catalog is sourced as eight EPA and twenty-one PBA forms", () => {
  assert.equal(residentTemplates.filter((item) => item.type === "EPA").length, 8);
  assert.equal(residentTemplates.filter((item) => item.type === "PBA").length, 21);
  assert.equal(residentTemplates.length, 29);
});

test("EPA OPD is explicitly displayed as EPA 8", () => {
  const opd = residentTemplates.find((item) => item.code === "EPA-8");
  assert.equal(opd.sourceFile, "EPA/EPA_OPD.pdf");
  assert.deepEqual(opd.scoreOptions, ["L1", "L2", "L3", "L4", "L5"]);
});

test("all source templates have ordered criteria and source hashes", () => {
  for (const template of residentTemplates) {
    assert.match(template.sourceHash, /^[a-f0-9]{64}$/);
    assert.ok(template.criteria.length > 0);
    assert.deepEqual(template.criteria.map((criterion) => criterion.sortOrder), Array.from({ length: template.criteria.length }, (_, index) => index + 1));
    assert.deepEqual(template.criteria.map((criterion) => criterion.code), Array.from({ length: template.criteria.length }, (_, index) => `C${index + 1}`));
    assert.ok(template.scoreOptions.every((score) => ["L1", "L2", "L3", "L4", "L5", "F", "M", "E"].includes(score)));
  }
});

test("PBA assessment options preserve the source F/M/E scale", () => {
  for (const template of residentTemplates.filter((item) => item.type === "PBA")) assert.deepEqual(template.scoreOptions, ["F", "M", "E"]);
});

test("EPA 1–6 and EPA 8 preserve L1–L5; basic laparoscopy preserves F/M/E", () => {
  for (const code of ["EPA-1", "EPA-2", "EPA-3", "EPA-4", "EPA-5", "EPA-6", "EPA-8"]) {
    assert.deepEqual(residentTemplates.find((item) => item.code === code).scoreOptions, ["L1", "L2", "L3", "L4", "L5"]);
  }
  assert.deepEqual(residentTemplates.find((item) => item.code === "EPA-7").scoreOptions, ["F", "M", "E"]);
});
