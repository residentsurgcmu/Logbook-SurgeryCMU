import assert from "node:assert/strict";
import test from "node:test";
import { admissionWeek, archiveRange, caseMatchesSearch, groupAdmissionWeeks } from "../src/admissionHistory.js";

test("conference admission windows join Saturday to Friday without gaps across years", () => {
  const previous = { from: "2026-12-26", to: "2027-01-01" };
  const current = { from: "2027-01-02", to: "2027-01-08" };
  assert.deepEqual(admissionWeek("2027-01-01"), previous);
  assert.deepEqual(admissionWeek("2027-01-02"), current);
  assert.deepEqual(admissionWeek("2027-01-03"), current);
  assert.deepEqual(archiveRange(current.from, 4), { from: "2026-12-05", to: previous.to });
  assert.deepEqual(archiveRange(current.from, 0), { from: "2020-01-01", to: previous.to });
});

test("history groups Friday and Saturday into different weeks and searches past cases by owner", () => {
  const friday = { admit_date: "2027-01-01", case_code: "ADM-00123", diagnosis: "Appendicitis" };
  const saturday = { admit_date: "2027-01-02" };
  assert.deepEqual(groupAdmissionWeeks([friday, saturday]).map(group => group.rows), [[saturday], [friday]]);
  assert.equal(caseMatchesSearch(friday, "00123", ""), true);
  assert.equal(caseMatchesSearch(friday, "appendicitis", ""), true);
  assert.equal(caseMatchesSearch(friday, "ทดสอบ", "ผู้ทดสอบ"), true);
});
