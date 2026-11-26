import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildMySpaceXray, matchesXrayPilotEmail } from "../src/mySpaceXray.js";

test("pilot is opt-in for the configured account only", async () => {
  const email = "pilot@example.test";
  const digest = createHash("sha256").update(email).digest("hex");
  assert.equal(await matchesXrayPilotEmail(" PILOT@example.test ", digest), true);
  assert.equal(await matchesXrayPilotEmail("other@example.test", digest), false);
  assert.equal(await matchesXrayPilotEmail(email, ""), false);
  assert.equal(await matchesXrayPilotEmail(email, digest, {}), false);
});

const row = (part_name, fields) => ({
  resident_id: "my-account", exam_type: "xray_anatomy", exam_id: "e2", revision_id: "r2",
  title: "Pilot X-ray Anatomy", exam_date: "2026-10-01",
  part_name, score: 12, max_score: 20, value_state: "scored", ...fields,
});

test("only the signed-in resident's latest X-ray exam is taken, with no fill from history", () => {
  const result = buildMySpaceXray([
    row("UGI1"), row("Colo"), row("HBP", { exam_id: "e1", exam_date: "2026-09-10" }),
    row("UGI", { resident_id: "another-account", exam_date: "2026-11-01" }),
    row("Vas", { exam_type: "mcq", exam_date: "2026-11-02" }),
    row("Anatomy"),
  ], "my-account");
  assert.equal(result.date, "2026-10-01");
  assert.equal(result.unmapped, 1);
  assert.deepEqual(result.axes.map(({ axis, value }) => [axis, value]), [
    ["Gen", null], ["MIS", null], ["UGI", 60], ["Colo", 60], ["HBP", null], ["B&E", null], ["Vas", null], ["Trauma", null],
  ]);
  assert.equal(buildMySpaceXray([row("UGI")], "another-account"), null);
});

test("multiple mapped parts use their score maxima; zero, absent, pending and invalid remain distinct", () => {
  const result = buildMySpaceXray([
    row("Upper GI 1", { score: 5, max_score: 10 }), row("UGI2", { score: 18, max_score: 20 }),
    row("HPB", { score: 0 }), row("Breast & Endocrine", { value_state: "absent", score: null }),
    row("Vascular surgery"), row("Vas", { value_state: "awaiting", score: null }),
    row("Trauma", { max_score: null }),
  ], "my-account");
  const axes = Object.fromEntries(result.axes.map((axis) => [axis.axis, axis]));
  assert.equal(axes.UGI.value, 2300 / 30);
  assert.equal(axes.HBP.value, 0);
  assert.equal(axes["B&E"].reason, "absent");
  assert.equal(axes.Vas.reason, "awaiting");
  assert.equal(axes.Trauma.reason, "invalid");
});
