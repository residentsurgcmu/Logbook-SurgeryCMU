import assert from "node:assert/strict";
import test from "node:test";
import { cornerSummary } from "../src/residentCorner.js";
import { groupNav } from "../src/navGroups.js";

const requests = [
  { id: "a", resident_id: "r1", staff_id: "s1", status: "pending" },
  { id: "b", resident_id: "r2", staff_id: "s2", status: "pending" },
  { id: "c", resident_id: "r1", staff_id: "s1", status: "cancelled" },
];
const assessments = [{ resident_id: "r1", evaluator_id: "s1" }, { resident_id: "r2", evaluator_id: "s2" }];
const notifications = [{ recipient_id: "r1", read_at: null }, { recipient_id: "r1", read_at: "2026-10-01" }, { recipient_id: "s1", read_at: null }];

test("home summaries show the signed-in person's pending work and own inbox", () => {
  for (const user of [{ id: "r1", role: "resident" }, { id: "s1", role: "staff" }]) {
    const summary = cornerSummary({ user, requests, assessments, notifications });
    assert.deepEqual(summary.pending.map((row) => row.id), ["a"]);
    assert.equal(summary.completed, 1);
    assert.equal(summary.unread, 1);
  }
  const admin = cornerSummary({ user: { id: "admin", role: "admin" }, requests, assessments, notifications });
  assert.equal(admin.pending.length, 2);
  assert.equal(admin.completed, 2);
  assert.equal(admin.unread, 0);
});

test("empty workspaces have honest zero counts", () => {
  assert.deepEqual(cornerSummary({ user: { id: "r", role: "resident" } }), { pending: [], completed: 0, unread: 0 });
});

test("role grouping never adds unauthorized destinations or drops legacy tabs", () => {
  const nav = [["home", "Home"], ["cases", "Cases"], ["pending", "Pending"], ["attendance", "Attendance"], ["future", "Future"]];
  for (const role of ["resident", "staff", "admin"]) {
    const result = groupNav(nav, role).flatMap(([, items]) => items);
    assert.deepEqual(result.map(([id]) => id).sort(), nav.map(([id]) => id).sort());
    assert.equal(result.filter(([id]) => id === "home").length, 1);
  }
});
