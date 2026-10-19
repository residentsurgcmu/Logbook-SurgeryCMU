import assert from "node:assert/strict";
import test from "node:test";
import { assessmentDisplayName, assessmentTopic } from "../src/mySpacePresentation.js";
import { residentTemplates } from "../src/generated/residentTemplates.js";

test("procedure names come from the source templates, including Amputation, AVF and MRM", () => {
  assert.equal(assessmentDisplayName("PBA-01"), "Amputation");
  assert.equal(assessmentDisplayName("PBA-03"), "AVF");
  assert.equal(assessmentDisplayName("PBA-14"), "Modified radical mastectomy (MRM)");
  for (const template of residentTemplates) {
    assert.notEqual(assessmentDisplayName(template.code), "ยังไม่มีชื่อแบบประเมิน");
    assert.ok(assessmentDisplayName(template.code).length > 2);
  }
});

test("a runtime template title takes precedence; only the redundant code prefix is removed", () => {
  assert.equal(assessmentDisplayName("PBA-03", "PBA Updated AVF title"), "Updated AVF title");
  assert.equal(assessmentDisplayName("PBA-03", "PBA 3 Updated AVF title"), "Updated AVF title");
  assert.equal(assessmentDisplayName("EPA-4", "EPA 4 Hepato-biliary and pancreatic diseases"), "Hepato-biliary and pancreatic diseases");
  assert.equal(assessmentDisplayName("PBA-03", "PBA-03"), "AVF");
  assert.equal(assessmentDisplayName("UNKNOWN", ""), "ยังไม่มีชื่อแบบประเมิน");
});

test("topic icons consistently group corresponding EPA and PBA without changing templates", () => {
  assert.deepEqual(assessmentTopic("EPA-5"), assessmentTopic("PBA-14"));
  assert.deepEqual(assessmentTopic("EPA-6"), assessmentTopic("PBA-03"));
  assert.deepEqual(assessmentTopic("EPA-4"), assessmentTopic("PBA-12"));
  assert.deepEqual(assessmentTopic("EPA-7-L1-L2"), assessmentTopic("EPA-7-L3"));
  assert.equal(assessmentTopic("UNKNOWN").icon, "general");
});
