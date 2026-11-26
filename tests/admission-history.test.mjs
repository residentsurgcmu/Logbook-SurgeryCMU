import assert from "node:assert/strict";
import test from "node:test";
import { conferenceWeekForCase, conferenceWindow } from "../src/residentCases.js";
import { bangkokIsoDate } from "../src/roundSchedule.js";
import { admissionWeek, archiveRange, caseMatchesSearch, groupAdmissionWeeks } from "../src/admissionHistory.js";

test("admission windows join Friday to Thursday, with a Friday midnight rollover in Bangkok", () => {
  const previous = { from: "2026-12-25", to: "2026-12-31" };
  const current = { from: "2027-01-01", to: "2027-01-07" };
  assert.deepEqual(admissionWeek(bangkokIsoDate(new Date("2026-12-31T16:59:59Z"))), previous);
  assert.deepEqual(admissionWeek(bangkokIsoDate(new Date("2026-12-31T17:00:00Z"))), current);
  assert.deepEqual(admissionWeek("2027-01-07"), current);
  assert.deepEqual(conferenceWindow(conferenceWeekForCase("2027-01-01").start), current);
  assert.deepEqual(conferenceWindow(conferenceWeekForCase("2026-12-31").start), previous);
  assert.deepEqual(archiveRange(current.from, 4), { from: "2026-12-04", to: previous.to });
  assert.deepEqual(archiveRange(current.from, 0), { from: "2020-01-01", to: previous.to });
});

test("history groups Thursday and Friday into different weeks and searches past cases by owner", () => {
  const thursday = { admit_date: "2026-12-31", case_code: "ADM-00123", diagnosis: "Appendicitis" };
  const friday = { admit_date: "2027-01-01" };
  assert.deepEqual(groupAdmissionWeeks([thursday, friday]).map(group => group.rows), [[friday], [thursday]]);
  assert.equal(caseMatchesSearch(thursday, "00123", ""), true);
  assert.equal(caseMatchesSearch(thursday, "appendicitis", ""), true);
  assert.equal(caseMatchesSearch(thursday, "ทดสอบ", "ผู้ทดสอบ"), true);
});
