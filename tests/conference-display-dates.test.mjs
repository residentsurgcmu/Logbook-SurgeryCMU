import assert from "node:assert/strict";
import test from "node:test";
import { includesConferenceDay, pickConferenceDay } from "../src/conferenceDisplayDates.js";

const empty = { start: "", end: "" };

test("no filter shows the full agenda; a single selection includes exactly that admission day", () => {
  assert.equal(includesConferenceDay(empty, "2026-11-18"), true);
  const one = pickConferenceDay(empty, "2026-11-26");
  assert.equal(includesConferenceDay(one, "2026-11-26"), true);
  for (const day of ["", "2026-11-25", "2026-11-27"]) assert.equal(includesConferenceDay(one, day), false);
});

test("reversed selections across months form one inclusive range; a third click starts over", () => {
  const one = pickConferenceDay(empty, "2026-12-02");
  const range = pickConferenceDay(one, "2026-11-29");
  assert.deepEqual(range, { start: "2026-11-29", end: "2026-12-02" });
  for (const day of ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]) assert.equal(includesConferenceDay(range, day), true);
  for (const day of ["2026-11-28", "2026-12-03"]) assert.equal(includesConferenceDay(range, day), false);
  assert.deepEqual(pickConferenceDay(range, "2026-12-07"), { start: "2026-12-07", end: "" });
});
