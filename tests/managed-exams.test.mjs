import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { createRequire } from "node:module";
// JSZip is ExcelJS's declared dependency; used here only to forge bounded ZIP fixtures.
const JSZip = createRequire(createRequire(import.meta.url).resolve("exceljs"))("jszip");
import { buildManagedTemplate, parseManagedTemplate, buildManagedResultsWorkbook, downloadManagedBook } from "../src/managedExamExcel.js";
import { inspectManagedXlsx } from "../src/managedExamZip.js";
import { createManagedExamsApi, managedAttempt, managedCellLabel, groupManagedRows } from "../src/managedExams.js";
const resident = "10000000-0000-4000-8000-000000000001", part = "20000000-0000-4000-8000-000000000001";
const exam = "30000000-0000-4000-8000-000000000001", revision = "40000000-0000-4000-8000-000000000001";
const snapshot = () => ({ template_version: "RC04-TEMPLATE-1", importable: true,
  exam: { exam_id: exam, revision_id: revision, revision_seq: 1, version: 2, state: "working", academic_year: 2569, exam_date: "2026-06-12", exam_type: "xray_anatomy", title: "Fixture exam" },
  roster: [{ resident_id: resident, reference_name: "Fixture Resident", pgy_at_exam: 2 }],
  parts: [{ part_id: part, column_key: "part_1", name: "Fixture unit", sort_order: 1, max_score: 100, mpl: { 2: 60 } }],
  cells: [{ resident_id: resident, part_id: part, value_state: "unknown", score: null, outcome: null }],
});
async function parsed(change = () => {}, source = snapshot()) {
  const book = buildManagedTemplate(ExcelJS, source); change(book);
  return parseManagedTemplate(ExcelJS, await book.xlsx.writeBuffer(), "fixture.xlsx", source);
}
test("blank omits delta; numeric zero is a real score; partial metadata identifies the exact snapshot", async () => {
  assert.equal((await parsed()).cells.length, 0);
  const r = await parsed((b) => b.getWorksheet("คะแนน").getCell("D2").value = 0);
  assert.equal(r.cells[0].score, 0); assert.equal(r.cells[0].state, "scored"); assert.equal(r.reported.revision_id, revision); assert.equal(r.reported.version, 2);
});
for (const [label, state] of [["ขาดสอบ", "absent"], ["ยังไม่สอบ", "awaiting"]]) test(`explicit ${state} keeps no score; score + state is rejected`, async () => {
  const r = await parsed((b) => b.getWorksheet("คะแนน").getCell("E2").value = label); assert.equal(r.cells[0].state, state); assert.ok(!("score" in r.cells[0]));
  await assert.rejects(parsed((b) => { b.getWorksheet("คะแนน").getCell("D2").value = 0; b.getWorksheet("คะแนน").getCell("E2").value = label; }), /ห้ามมีทั้ง/);
});
for (const value of [-1, 101, 59.999, "60", "55ผ่าน", "-", { formula: "1+1", result: 2 }, { text: "60", hyperlink: "https://fixture.invalid" }, true, new Date("2026-01-01")]) test(`unsafe score type/value rejected: ${JSON.stringify(value)}`, async () => {
  await assert.rejects(parsed((b) => b.getWorksheet("คะแนน").getCell("D2").value = value));
});
for (const [sheet, address, value] of [["คะแนน", "A2", "other-id"], ["คะแนน", "B2", "wrong name"], ["คะแนน", "C2", 3], ["คะแนน", "D1", "moved"], ["ส่วนสอบและเกณฑ์", "E2", 99], ["ส่วนสอบและเกณฑ์", "G2", 59], ["ข้อมูลรายการ", "B5", 1], ["ข้อมูลรายการ", "B6", 2570], ["ส่วนสอบและเกณฑ์", "J2", 9]]) test(`tampered snapshot ${sheet}!${address} fails closed`, async () => {
  await assert.rejects(parsed((b) => b.getWorksheet(sheet).getCell(address).value = value));
});
test("missing sheets/headers, duplicate identities and extra cells do not become partial imports", async () => {
  await assert.rejects(parsed((b) => b.removeWorksheet("ข้อมูลรายการ")));
  await assert.rejects(parsed((b) => b.getWorksheet("คะแนน").addRow([resident, "Fixture Resident", 2, 60])));
  await assert.rejects(parsed((b) => b.getWorksheet("คะแนน").getCell("F2").value = 60));
});
test("row order is irrelevant; an omitted resident is explicit partial scope", async () => {
  const s = snapshot(); s.roster.push({ resident_id: resident.replace(/1$/, "2"), reference_name: "Fixture Second", pgy_at_exam: 2 });
  const r = await parsed((b) => { const sh = b.getWorksheet("คะแนน"); const row = sh.getRow(2).values; sh.spliceRows(2, 1); sh.getCell("D2").value = 5; sh.addRow(row); sh.getCell("D3").value = 0; }, s);
  assert.deepEqual(r.cells.map((c) => c.score), [5, 0]);
  const partial = await parsed((b) => b.getWorksheet("คะแนน").spliceRows(2, 1), s); assert.equal(partial.missingResidents, 1);
});
test("file extension/type/size and corrupted archive are rejected before workbook use", async () => {
  await assert.rejects(inspectManagedXlsx(new Uint8Array(30), "file.xlsx"));
  await assert.rejects(inspectManagedXlsx(new Uint8Array(6 * 1024 ** 2), "file.xlsx"));
  await assert.rejects(inspectManagedXlsx(new Uint8Array(30), "file.xlsm"));
  const b = new Uint8Array(await buildManagedTemplate(ExcelJS, snapshot()).xlsx.writeBuffer()); b[45] ^= 1; await assert.rejects(inspectManagedXlsx(b));
});
test("declared expansion bomb rejected without inflating; formulas outside scores also rejected", async () => {
  const bytes = new Uint8Array(await buildManagedTemplate(ExcelJS, snapshot()).xlsx.writeBuffer()), v = new DataView(bytes.buffer);
  for (let i = 0; i + 28 < bytes.length; i++) if (v.getUint32(i, true) === 0x02014b50) { v.setUint32(i + 24, 7 * 1024 ** 2, true); break; }
  await assert.rejects(inspectManagedXlsx(bytes));
  await assert.rejects(parsed((b) => b.getWorksheet("ข้อมูลรายการ").getCell("B10").value = { formula: "1+1", result: 2 }));
});
test("worksheet ranges are bounded before ExcelJS parses them; maximum supported roster and parts round-trip", async () => {
  await assert.rejects(parsed((b) => b.getWorksheet("คะแนน").getCell("D10000").value = 0));
  await assert.rejects(parsed((b) => b.getWorksheet("คะแนน").getCell("ZZ2").value = 0));
  const s = snapshot();
  s.roster = Array.from({ length: 200 }, (_, i) => ({ resident_id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, reference_name: `Fixture ${i}`, pgy_at_exam: 2 }));
  s.parts = Array.from({ length: 50 }, (_, i) => ({ part_id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, column_key: `part_${i + 1}`, name: `Unit ${i + 1}`, sort_order: i + 1, max_score: 100, mpl: { 2: 60 } }));
  s.cells = s.roster.flatMap((r) => s.parts.map((p) => ({ resident_id: r.resident_id, part_id: p.part_id, value_state: "scored", score: 0, outcome: "fail" })));
  const data = await parsed(() => {}, s); assert.equal(data.cells.length, 10000); assert.ok(data.cells.every((c) => c.score === 0));
});
const publishedRow = (rev = revision) => ({ exam_id: exam, revision_id: rev, academic_year: 2569, exam_date: "2026-06-12", title: "Fixture exam", exam_type: "xray_anatomy", resident_id: resident, reference_name: "Fixture Resident", pgy_at_exam: 2, part_id: part, part_name: "Fixture unit", part_sort_order: 1, max_score: 100, mpl: 60, score: null, outcome: null, value_state: "awaiting", overall: { status: "incomplete", failed_part_ids: [part] } });
test("absence and incomplete+failed survive grouping, labels and exported workbook", () => {
  const row = publishedRow(), grouped = groupManagedRows([row]);
  assert.equal(grouped[0].residents[0].cells.size, 1); assert.equal(managedCellLabel(row), "ยังไม่สอบ");
  const sheet = buildManagedResultsWorkbook(ExcelJS, { rows: [row] }).getWorksheet("ผลประกาศ");
  assert.equal(sheet.getCell("J2").value, null); assert.equal(sheet.getCell("N2").value, "ยังไม่สอบ"); assert.equal(sheet.getCell("O2").value, "ยังไม่ครบ · ส่วนที่ไม่ผ่าน: Fixture unit"); assert.equal(sheet.getCell("P2").value, "Fixture unit"); assert.equal(sheet.getCell("Q2").value, part);
});
test("export readback names the failed X-ray beside an awaiting Anatomy without inventing a zero", async () => {
  const failed = { ...publishedRow(), part_name: "X-ray", value_state: "scored", score: 55, outcome: "fail" };
  const awaiting = { ...publishedRow(), part_id: "20000000-0000-4000-8000-000000000002", part_name: "Anatomy", part_sort_order: 2 };
  const book = buildManagedResultsWorkbook(ExcelJS, { rows: [failed, awaiting] });
  const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(await book.xlsx.writeBuffer());
  const s = loaded.getWorksheet("ผลประกาศ");
  assert.equal(s.getCell("J2").value, 55); assert.equal(s.getCell("J3").value, null);
  assert.equal(s.getCell("N3").value, "ยังไม่สอบ");
  for (const row of [2, 3]) {
    assert.equal(s.getCell(`O${row}`).value, "ยังไม่ครบ · ส่วนที่ไม่ผ่าน: X-ray");
    assert.equal(s.getCell(`P${row}`).value, "X-ray"); assert.equal(s.getCell(`Q${row}`).value, part);
  }
});
test("failed part names are scoped to each published revision and all-passed stays clear", () => {
  const a = { ...publishedRow(), part_name: "Old X-ray" };
  const b = { ...publishedRow("another-revision"), part_name: "New X-ray" };
  const c = { ...publishedRow("passed-revision"), part_name: "Passed X-ray", value_state: "scored", score: 75, outcome: "pass", overall: { status: "all_passed", failed_part_ids: [] } };
  const s = buildManagedResultsWorkbook(ExcelJS, { rows: [a, b, c] }).getWorksheet("ผลประกาศ");
  assert.equal(s.getCell("P2").value, "Old X-ray"); assert.equal(s.getCell("P3").value, "New X-ray");
  assert.equal(s.getCell("O4").value, "ผ่านทุกส่วน"); assert.equal(s.getCell("P4").value, "");
});
test("export refuses an unresolved failed part name instead of falling back to an opaque ID", () => {
  const row = { ...publishedRow(), overall: { status: "incomplete", failed_part_ids: ["missing-part"] } };
  assert.throws(() => buildManagedResultsWorkbook(ExcelJS, { rows: [row] }), /ชื่อส่วนที่ไม่ผ่านไม่ครบ/);
});
function readClient(pages) {
  let i = 0; const calls = [];
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); if (name === "rc04_open_read_set") return { data: { manifest_id: "manifest", entries: [{ exam_id: exam, revision_id: revision }] } }; return pages[i++]; } };
}
const page = (rows, done, cursor = null) => ({ data: { manifest_id: "manifest", rows, row_count: rows.length, done, next_cursor: cursor } });
test("reader pins manifest, keeps absence and never returns partial data after expiry", async () => {
  const first = publishedRow(), second = { ...first, part_id: part.replace(/1$/, "2") }, cursor = { manifest_id: "manifest", i: 0, r: resident, s: 1, p: part };
  const client = readClient([page([first], false, cursor), page([second], true)]);
  assert.equal((await createManagedExamsApi(client).read("own")).rows.length, 2); assert.deepEqual(client.calls[2].args.p_cursor, cursor);
  const expired = readClient([page([first], false, cursor), { error: { code: "P0001", message: "RC04_READ_SET_EXPIRED: test" } }]);
  await assert.rejects(createManagedExamsApi(expired).read("own"), /หมดอายุ/);
});
test("reader rejects mixed revisions, duplicates and missing response shapes", async () => {
  await assert.rejects(createManagedExamsApi(readClient([page([publishedRow("different")], true)])).read("staff"));
  await assert.rejects(createManagedExamsApi(readClient([page([publishedRow(), publishedRow()], true)])).read("staff"));
  await assert.rejects(createManagedExamsApi(readClient([{ data: {} }])).read("staff"));
  await assert.rejects(createManagedExamsApi(readClient([page([{ ...publishedRow(), value_state: "unknown" }], true)])).read("staff"));
});
test("uncertain mutation blocks a different write until the original receipt is resolved", async () => {
  const api = createManagedExamsApi({ rpc: async () => ({ error: { message: "network failed" } }) });
  const a = managedAttempt(null, "create_managed_exam", { p_payload: { title: "A" } }, () => "id-a");
  const b = managedAttempt(null, "create_managed_exam", { p_payload: { title: "B" } }, () => "id-b");
  await assert.rejects(api.mutate(a.operation, a));
  await assert.rejects(api.mutate(b.operation, b), (e) => e.recoveryAttempt.requestId === "id-a");
  api.setActor("another-user");
  await assert.rejects(api.mutate(b.operation, b), (e) => !e.recoveryAttempt);
});
test("incomplete admin snapshots fail before the UI can treat missing validation as ready", async () => {
  const api = createManagedExamsApi({ rpc: async () => ({ data: snapshot() }) });
  await assert.rejects(api.get(exam, revision), /ไม่ครบ/);
});
test("a late response from a prior account is not returned to a different actor", async () => {
  let finish;
  const api = createManagedExamsApi({ rpc: () => new Promise((resolve) => { finish = resolve; }) });
  api.setActor("actor-a");
  const a = managedAttempt(null, "create_managed_exam", { p_payload: { title: "Fixture" } }, () => "request-a");
  const pending = api.mutate(a.operation, a);
  api.setActor("actor-b"); finish({ data: { exam_id: exam, revision_id: revision, version: 1 } });
  await assert.rejects(pending, (e) => e.code === "RC04_FORBIDDEN");
});
test("read results are discarded after actor change, including A → B → A", async () => {
  for (const backToA of [false, true]) {
    let finish;
    const api = createManagedExamsApi({ rpc: async (name) => name === "rc04_open_read_set" ? { data: { manifest_id: "manifest", entries: [{ exam_id: exam, revision_id: revision }] } } : new Promise((resolve) => { finish = resolve; }) });
    api.setActor("A"); const reading = api.read("staff");
    while (!finish) await new Promise((resolve) => setImmediate(resolve));
    api.setActor("B"); if (backToA) api.setActor("A");
    finish(page([publishedRow()], true));
    await assert.rejects(reading, (e) => e.name === "AbortError");
  }
});
test("aborted reads return no old data even after a complete last page arrives", async () => {
  let finish; const control = new AbortController();
  const client = readClient([]); client.rpc = async (name) => name === "rc04_open_read_set" ? { data: { manifest_id: "manifest", entries: [{ exam_id: exam, revision_id: revision }] } } : new Promise((resolve) => { finish = resolve; });
  const reading = createManagedExamsApi(client).read("staff", { signal: control.signal });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  control.abort(); finish(page([publishedRow()], true));
  await assert.rejects(reading, (e) => e.name === "AbortError");
});
test("download checks cancellation again after asynchronous workbook serialization", async () => {
  let finish; const control = new AbortController();
  const result = downloadManagedBook({ xlsx: { writeBuffer: () => new Promise((resolve) => { finish = resolve; }) } }, "fixture.xlsx", { signal: control.signal });
  control.abort(); finish(new Uint8Array([1]));
  await assert.rejects(result, (e) => e.name === "AbortError");
});
test("download checks owner validity after serialization even without a signal", async () => {
  let finish, valid = true;
  const result = downloadManagedBook({ xlsx: { writeBuffer: () => new Promise((resolve) => { finish = resolve; }) } }, "fixture.xlsx", { assertCurrent: () => { if (!valid) throw new DOMException("owner changed", "AbortError"); } });
  valid = false; finish(new Uint8Array([1]));
  await assert.rejects(result, (e) => e.name === "AbortError");
});
async function forgedRangeXml(fragment) {
  const zip = await JSZip.loadAsync(await buildManagedTemplate(ExcelJS, snapshot()).xlsx.writeBuffer());
  const path = "xl/worksheets/sheet1.xml";
  const xml = (await zip.file(path).async("string")).replace(/<dataValidations\b[^>]*>[\s\S]*?<\/dataValidations>/g, "");
  zip.file(path, xml.replace("</worksheet>", `${fragment}</worksheet>`));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
for (const [label, fragment] of [
  ["huge merge", '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells>'],
  ["small merge also unsupported", '<mergeCells count="1"><mergeCell ref="A1:B2"/></mergeCells>'],
  ...["A1:XFD1048576", "E2:E500", "E2:E3 XFD1", "E2:E3 CY301", "E0", "A:A", "E3:E2", "A1&#58;XFD1048576", "E2:E3&#x20;CY301", "A1:CY300 A1:CY300"].map((ref) => [`validation ${ref}`, `<dataValidations count="1"><dataValidation type="whole" sqref="${ref}"><formula1>0</formula1></dataValidation></dataValidations>`]),
]) test(`preflight blocks ${label} before ExcelJS.xlsx.load`, async () => {
  let loadCalls = 0;
  const spy = { Workbook: class { constructor() { this.xlsx = { load: async () => { loadCalls++; throw new Error("reached load"); } }; } } };
  await assert.rejects(parseManagedTemplate(spy, await forgedRangeXml(fragment), "fixture.xlsx", snapshot()));
  assert.equal(loadCalls, 0);
});
test("normal template and bounded multi-range validation reach the loader", async () => {
  let calls = 0; const spy = { Workbook: class { constructor() { this.xlsx = { load: async () => { calls++; throw new Error("reached load"); } }; } } };
  const data = await forgedRangeXml('<dataValidations count="1"><dataValidation type="whole" sqref="E2:E3 E4 CY300"><formula1>0</formula1></dataValidation></dataValidations>');
  await assert.rejects(parseManagedTemplate(spy, data, "fixture.xlsx", snapshot()), /reached load/); assert.equal(calls, 1);
});
test("same uncertain mutation reuses receipt even across component attempts; changed payload has a new key", async () => {
  const args = { p_payload: { title: "Fixture" } }, a = managedAttempt(null, "create_managed_exam", args, () => "request-a"), same = managedAttempt(a, "create_managed_exam", { p_payload: { title: "Fixture" } });
  assert.equal(same.requestId, "request-a");
  const b = managedAttempt(null, "create_managed_exam", args, () => "request-b"), calls = [];
  const api = createManagedExamsApi({ rpc: async (_, payload) => { calls.push(payload); return calls.length === 1 ? { error: { message: "network failed" } } : { data: { exam_id: exam, revision_id: revision, version: 1 } }; } });
  await assert.rejects(api.mutate(a.operation, a)); await api.mutate(b.operation, b); assert.equal(calls[1].p_request_id, "request-a");
  assert.notEqual(managedAttempt(a, "create_managed_exam", { p_payload: { title: "changed" } }, () => "new").requestId, a.requestId);
});
