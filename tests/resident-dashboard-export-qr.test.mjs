import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDashboard, filterExportRecords } from "../src/residentAnalytics.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const records = [
  { id: "a", residentId: "r1", templateId: "e1", templateType: "EPA", assessmentDate: "2026-09-01" },
  { id: "b", residentId: "r1", templateId: "p1", templateType: "PBA", assessmentDate: "2026-09-02" },
  { id: "c", residentId: "r2", templateId: "e1", templateType: "EPA", assessmentDate: "2026-09-03" },
];

test("Admin export supports the five requested scopes", () => {
  assert.deepEqual(filterExportRecords(records, { scope: "resident-one", residentId: "r1" }).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(filterExportRecords(records, { scope: "template-one", templateId: "e1" }).map((item) => item.id), ["a", "c"]);
  assert.equal(filterExportRecords(records, { scope: "resident-all" }).length, 3);
  assert.deepEqual(filterExportRecords(records, { scope: "epa-all" }).map((item) => item.id), ["a", "c"]);
  assert.deepEqual(filterExportRecords(records, { scope: "pba-all" }).map((item) => item.id), ["b"]);
});

test("Admin export applies an inclusive activity-date range", () => {
  assert.deepEqual(filterExportRecords(records, { scope: "resident-all", dateFrom: "2026-09-02", dateTo: "2026-09-03" }).map((item) => item.id), ["b", "c"]);
});

test("dashboard derives live counts without synthetic placeholder data", () => {
  const workspace = { profiles: [{ id: "r1", name: "Resident One", pgy: 1 }], staffDirectory: [{ active: true, auth_user_id: "s1" }], templates: [{ template_type: "EPA" }, { template_type: "PBA" }], assessments: [{ id: "a", resident_id: "r1", signed_at: "2026-09-03T01:00:00Z", resident_template_definitions: { template_type: "EPA", template_code: "EPA-1" } }], requests: [{ id: "q", resident_id: "r1", status: "pending", submitted_at: "2026-09-04T01:00:00Z", resident_template_definitions: { template_type: "PBA", template_code: "PBA-1" } }] };
  const dashboard = buildDashboard(workspace);
  assert.equal(dashboard.residents.length, 1);
  assert.equal(dashboard.activeStaff, 1);
  assert.equal(dashboard.pending.length, 1);
  assert.equal(dashboard.completed, 1);
});

test("QR resolution is Staff-only and exports exclude clinical context and patient identifiers", async () => {
  const migration = await read("supabase/migrations/20260909133642_add_resident_qr_resolution.sql");
  const exportSource = await read("src/residentExport.js");
  assert.match(migration, /role\.role = 'staff'/);
  assert.match(migration, /request\.staff_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /revoke all .* from public, anon/i);
  assert.doesNotMatch(exportSource, /clinical_context|patient_name|\bhn\b/i);
});
