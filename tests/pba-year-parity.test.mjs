import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildMySpace } from "../src/mySpace.js";
import { buildAdminProgressWorkbook } from "../src/adminProgressExcel.js";

const templates = ["PBA-01", "PBA-02", "PBA-03"].map((code) => ({
  id: `t-${code}`, template_code: code, template_type: "PBA", title: `แบบสมมติ ${code}`,
}));
const residents = ["repeat", "linked-july", "linked-june", "direct", "excluded", "mixed"].map((id, i) => ({
  id, name: `Resident สมมติ ${i + 1}`, pgy: i % 4 + 1,
}));
function fixture() {
  const assessments = [];
  const requests = [];
  const direct = (resident, code, date) => {
    const row = { id: `a-${assessments.length}`, resident_id: resident, template_id: `t-${code}`, assessment_date: date };
    assessments.push(row);
    return row;
  };
  const linked = (resident, code, date, submitted) => {
    const row = direct(resident, code, date);
    requests.push({ id: `q-${requests.length}`, resident_id: resident, template_id: row.template_id,
      status: "completed", assessment_id: row.id, submitted_at: submitted });
  };
  direct("repeat", "PBA-01", "2026-08-01");
  linked("repeat", "PBA-01", "2026-09-01", "2026-09-02T03:00:00Z");
  // Same June activity, opposite sides of the Bangkok academic-year boundary for submission.
  linked("linked-july", "PBA-01", "2026-06-28", "2026-06-30T17:00:00Z");
  linked("linked-june", "PBA-01", "2026-07-02", "2026-06-30T16:59:59Z");
  direct("direct", "PBA-02", "2026-07-01");
  direct("direct", "PBA-03", "2026-06-30");
  linked("excluded", "PBA-01", "2026-08-01", "2025-08-01T03:00:00Z");
  direct("excluded", "PBA-02", "2025-08-01");
  direct("excluded", "PBA-03", "2027-07-01");
  for (const status of ["pending", "cancelled"]) {
    requests.push({ id: `q-${requests.length}`, resident_id: "excluded", template_id: "t-PBA-03",
      status, assessment_id: null, submitted_at: "2026-08-01T03:00:00Z" });
  }
  direct("mixed", "PBA-01", "2026-08-01");
  direct("mixed", "PBA-01", "2026-09-01");
  linked("mixed", "PBA-02", "2026-06-28", "2026-07-02T03:00:00Z");
  direct("mixed", "PBA-03", "2026-10-01");
  return { assessments, requests };
}

// SQL-RESULT MOCK ONLY: model the migration's reqc + hist aggregates independently
// from buildMySpace. No SQL/database is executed by this test.
function mockSqlRows({ requests, assessments }, year) {
  const from = Date.parse(`${year}-07-01T00:00:00+07:00`);
  const until = Date.parse(`${year + 1}-07-01T00:00:00+07:00`);
  return residents.flatMap((resident) => templates.map((template) => {
    const qs = requests.filter((q) => q.resident_id === resident.id && q.template_id === template.id);
    const results = assessments.filter((a) => a.resident_id === resident.id && a.template_id === template.id);
    const reqc = qs.filter((q) => q.status === "completed" && Date.parse(q.submitted_at) >= from && Date.parse(q.submitted_at) < until).length;
    const hist = results.filter((a) => !requests.some((q) => q.assessment_id === a.id)
      && a.assessment_date >= `${year}-07-01` && a.assessment_date < `${year + 1}-07-01`).length;
    return { resident_id: resident.id, resident_name: resident.name, resident_pgy: resident.pgy,
      template_id: template.id, template_code: template.template_code, template_type: "PBA",
      done: results.length > 0, completed_this_year: reqc + hist, has_pending: qs.some((q) => q.status === "pending") };
  }));
}

for (const [year, expected] of [
  [2025, [0, 0, 1, 1, 2, 0]],
  [2026, [1, 1, 0, 1, 0, 3]],
]) {
  test(`PBA yearly parity for EVERY Resident, academic year ${year}: same fixture, mocked SQL output`, async () => {
    const data = fixture();
    const sqlRows = mockSqlRows(data, year);
    const now = new Date(`${year}-10-17T05:00:00Z`);
    const workbook = buildAdminProgressWorkbook(ExcelJS, { rows: sqlRows, generatedAt: now });
    // Compare the actual serialized Excel cells, not just an intermediate accumulator.
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = restored.getWorksheet("PBA");
    assert.equal(sheet.rowCount, residents.length + 1);
    residents.forEach((resident, i) => {
      const space = buildMySpace({ ...data, user: resident, templates, now });
      const row = sheet.getRow(i + 2);
      assert.equal(row.getCell(1).value, resident.name);
      assert.equal(space.plan.pbaThisYear, expected[i], `${resident.id}: expected distinct topics`);
      assert.equal(row.getCell(4).value, expected[i], `${resident.id}: Excel yearly cell`);
      assert.equal(space.plan.pbaThisYear, row.getCell(4).value, `${resident.id}: parity`);
      assert.equal(space.counters.finishedPbaThisYear, space.plan.pbaThisYear, `${resident.id}: summary parity`);
    });
    if (year === 2026) {
      assert.equal(sqlRows.find((r) => r.resident_id === "repeat" && r.template_code === "PBA-01").completed_this_year, 2);
      const excluded = buildMySpace({ ...data, user: residents[4], templates, now });
      assert.equal(excluded.counters.waitingPba, 1); // cancelled is excluded; pending is visible but not done
    }
  });
}
