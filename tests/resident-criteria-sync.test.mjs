import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeCriterionText,
  planCriteriaSync,
} from "../src/criteriaSync.js";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

const row = (n, text, extra = {}) => ({
  id: `id-${n}`,
  criterion_code: `C${n}`,
  criterion_text: text,
  section_title: "Assessment criteria",
  sort_order: n,
  active: true,
  ...extra,
});
const source = (n, label, extra = {}) => ({
  code: `C${n}`,
  label,
  section: "Assessment criteria",
  sortOrder: n,
  ...extra,
});
const empty = { retire: [], insert: [], update: [] };

test("normalizeCriterionText ignores whitespace and Unicode form only", () => {
  assert.equal(normalizeCriterionText("  a \n  b\t c "), "a b c");
  assert.equal(normalizeCriterionText("é"), normalizeCriterionText("é"));
  assert.notEqual(normalizeCriterionText("Hemostasis"), normalizeCriterionText("Hemostasis."));
});

test("an unchanged catalog plans no changes, even with untidy stored text", () => {
  const existing = [row(1, "Identify the anatomy"), row(2, "  Control  bleeding ")];
  const plan = planCriteriaSync(existing, [
    source(1, "Identify the anatomy"),
    source(2, "Control bleeding"),
  ]);
  assert.deepEqual(plan, empty);
});

test("a reworded criterion is retired and re-created under the same code", () => {
  const existing = [row(1, "Identify the anatomy"), row(2, "Control bleeding")];
  const plan = planCriteriaSync(existing, [
    source(1, "Identify the anatomy"),
    source(2, "Achieve haemostasis"),
  ]);
  assert.deepEqual(plan.retire, ["id-2"]);
  assert.deepEqual(plan.insert, [
    {
      criterion_code: "C2",
      section_title: "Assessment criteria",
      criterion_text: "Achieve haemostasis",
      sort_order: 2,
      active: true,
    },
  ]);
  assert.deepEqual(plan.update, []);
});

test("inserting a criterion mid-document retires every shifted criterion and never edits text in place", () => {
  const existing = [row(1, "A"), row(2, "B"), row(3, "C")];
  const plan = planCriteriaSync(existing, [
    source(1, "A"),
    source(2, "NEW"),
    source(3, "B"),
    source(4, "C"),
  ]);
  assert.deepEqual(plan.retire.sort(), ["id-2", "id-3"]);
  assert.deepEqual(
    plan.insert.map((item) => [item.criterion_code, item.criterion_text]),
    [["C2", "NEW"], ["C3", "B"], ["C4", "C"]],
  );
  assert.deepEqual(plan.update, []);
});

test("a criterion removed from the source is retired", () => {
  const plan = planCriteriaSync(
    [row(1, "A"), row(2, "B"), row(3, "C")],
    [source(1, "A"), source(2, "B")],
  );
  assert.deepEqual(plan, { ...empty, retire: ["id-3"] });
});

test("a criterion appended to the source is inserted", () => {
  const plan = planCriteriaSync([row(1, "A")], [source(1, "A"), source(2, "B")]);
  assert.equal(plan.retire.length, 0);
  assert.deepEqual(
    plan.insert.map((item) => item.criterion_code),
    ["C2"],
  );
});

test("a section title change updates the row without retiring it", () => {
  const plan = planCriteriaSync(
    [row(1, "A")],
    [source(1, "A", { section: "Technique" })],
  );
  assert.deepEqual(plan, { ...empty, update: [{ id: "id-1", section_title: "Technique" }] });
});

test("a moved sort order retires and re-creates so active sort orders never collide", () => {
  const plan = planCriteriaSync([row(1, "A", { sort_order: 1 })], [source(1, "A", { sortOrder: 5 })]);
  assert.deepEqual(plan.retire, ["id-1"]);
  assert.equal(plan.insert[0].sort_order, 5);
});

test("retired rows are ignored, so a re-sync after a partial failure self-heals", () => {
  const existing = [
    row(1, "A"),
    row(2, "old wording", { active: false }),
  ];
  const plan = planCriteriaSync(existing, [source(1, "A"), source(2, "new wording")]);
  assert.deepEqual(plan.retire, []);
  assert.deepEqual(
    plan.insert.map((item) => item.criterion_text),
    ["new wording"],
  );
});

test("syncSourceTemplates applies the plan without upserting criteria", async () => {
  const api = await read("src/residentApi.js");
  const sync = api.slice(api.indexOf("export async function syncSourceTemplates"));
  const body = sync.slice(0, sync.indexOf("\nexport async function requestAssessment"));
  assert.match(body, /planCriteriaSync\(/);
  assert.doesNotMatch(body, /from\("resident_template_criteria"\)\s*\.upsert/);
  assert.doesNotMatch(body, /onConflict: "template_id,criterion_code"/);
  // Retire first (frees the active code/sort_order), then insert new rows.
  assert.ok(body.indexOf(".update({ active: false })") < body.indexOf(".insert("));
});

test("migration scopes criterion uniqueness to active rows", async () => {
  const sql = await read("supabase/migrations/20260929110000_criteria_unique_active_only.sql");
  assert.match(sql, /drop constraint if exists resident_template_criteria_template_id_criterion_code_key/);
  assert.match(sql, /drop constraint if exists resident_template_criteria_template_id_sort_order_key/);
  assert.match(sql, /create unique index if not exists resident_template_criteria_active_code_key\s+on public\.resident_template_criteria \(template_id, criterion_code\) where active/);
  assert.match(sql, /create unique index if not exists resident_template_criteria_active_sort_key\s+on public\.resident_template_criteria \(template_id, sort_order\) where active/);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /commit;\s*$/);
});

test("a signed assessment lists only the criteria that were scored on it", async () => {
  const views = await read("src/features/ResidentAssessmentViews.jsx");
  const table = views.slice(views.indexOf("template?.allCriteria || template?.criteria"));
  const filter = table.slice(0, table.indexOf(".map((criterion)"));
  // Not "every active criterion": a criterion re-created after signing must
  // not appear as an unscored duplicate of the retired row that was scored.
  assert.doesNotMatch(filter, /criterion\.active !== false/);
  assert.match(filter, /resident_assessment_scores\?\.some/);
  assert.match(filter, /resident_self_assessment_scores\?\.some/);
});
