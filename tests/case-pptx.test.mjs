import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import PptxGenJS from "pptxgenjs";
import { buildCaseSlides, buildWeekSlides, deckFileName, fitImage, renderSlides } from "../src/casePptx.js";

const people = [
  { user_id: "r1", full_name: "Resident A", role: "resident", active: true },
  { user_id: "s1", full_name: "Staff A", role: "staff", active: true },
];
const row = {
  id: "c1", case_code: "ADM-00003", admit_date: "2026-09-30", age_years: 58, sex: "male",
  diagnosis: "Perforated peptic ulcer", management: "Emergency operation", operation: "Laparoscopic repair",
  unit_name: "Upper GI", status: "pending_update", treatment_type: "operative", owner_id: "r1",
};
// 1x1 transparent PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const media = [
  { id: "m1", caption: "", image: { data: PNG, width: 400, height: 300 } },
  { id: "m2", caption: "CT", image: { data: PNG, width: 300, height: 600 } },
];
const notes = [{ id: "n1", author_id: "s1", body: "ทบทวน operative findings", created_at: "2026-10-02T02:00:00Z" }];

test("a case deck is one info slide then one slide per image, without notes by default", () => {
  const slides = buildCaseSlides(row, { people, media, notes });
  assert.deepEqual(slides.map((slide) => slide.kind), ["case", "image", "image"]);
  const info = Object.fromEntries(slides[0].lines);
  assert.equal(slides[0].title, "ADM-00003 · Perforated peptic ulcer");
  assert.equal(info["อายุ / เพศ"], "58 ปี · ชาย");
  assert.equal(info["หน่วย"], "Upper GI");
  assert.equal(info["Type"], "Operative");
  assert.equal(info["สถานะ"], undefined);
  assert.equal(info["Owner"], "Resident A");
  assert.equal(info["Operation"], "Laparoscopic repair");
  assert.equal(slides[1].caption, "ภาพที่ 1");
  assert.equal(slides[2].caption, "CT");
});

test("discussion notes are added when asked, six per slide", () => {
  const many = Array.from({ length: 13 }, (_, index) => ({ ...notes[0], id: `n${index}` }));
  const slides = buildCaseSlides(row, { people, media: [], notes: many, includeNotes: true });
  assert.deepEqual(slides.map((slide) => slide.kind), ["case", "notes", "notes", "notes"]);
  assert.equal(slides[1].items.length, 6);
  assert.equal(slides[3].items.length, 1);
  assert.equal(slides[1].items[0].author, "Staff A");
  assert.equal(buildCaseSlides(row, { people, media: [], notes: [], includeNotes: true }).length, 1);
});

test("a week deck starts with a cover and includes each case with its notes", () => {
  const slides = buildWeekSlides({
    week: { start: "2026-09-28", end: "2026-10-02" },
    people,
    cases: [{ row, media, notes }, { row: { ...row, id: "c2", case_code: "ADM-00004" }, media: [], notes: [] }],
  });
  assert.deepEqual(slides.map((slide) => slide.kind), ["cover", "case", "image", "image", "notes", "case"]);
  assert.match(slides[0].subtitle, /2 เคส/);
});

test("images are fitted inside the box keeping their aspect ratio, centred", () => {
  assert.deepEqual(fitImage(400, 300, 8, 6, 1, 1), { x: 1, y: 1, w: 8, h: 6 });
  assert.deepEqual(fitImage(300, 600, 8, 6, 1, 1), { x: 3.5, y: 1, w: 3, h: 6 });
  assert.deepEqual(fitImage(1000, 100, 8, 6, 0, 0), { x: 0, y: 2.6, w: 8, h: 0.8 });
});

test("file names use the case code or the week start", () => {
  assert.equal(deckFileName({ caseCode: "ADM-00003" }), "ADM-00003.pptx");
  assert.equal(deckFileName({ weekStart: "2026-09-28" }), "Conference-2026-09-28.pptx");
});

test("pptxgenjs renders the slides into a real .pptx with Thai text in a Thai-capable font", async () => {
  const slides = buildWeekSlides({ week: { start: "2026-09-28", end: "2026-10-02" }, people, cases: [{ row, media, notes }] });
  const pptx = new PptxGenJS();
  renderSlides(pptx, slides);
  const buffer = await pptx.write({ outputType: "nodebuffer", compression: false });
  const text = buffer.toString("utf8");
  const slideFiles = new Set(text.match(/ppt\/slides\/slide\d+\.xml/g));
  assert.equal(slideFiles.size, slides.length);
  assert.match(text, /Perforated peptic ulcer/);
  assert.match(text, /ทบทวน operative findings/);
  assert.match(text, /typeface="Tahoma"/);
});

test("the browser download loads pptxgenjs only when exporting", async () => {
  const src = await readFile(new URL("../src/casePptx.js", import.meta.url), "utf8");
  assert.match(src, /await import\("pptxgenjs"\)/);
  assert.doesNotMatch(src, /^import .*pptxgenjs/m);
});

test("export buttons exist on case detail and on the conference", async () => {
  const detail = await readFile(new URL("../src/features/ResidentCases.jsx", import.meta.url), "utf8");
  assert.match(detail, /Export PowerPoint/);
  assert.match(detail, /exportCaseDeck\(/);
  const conference = await readFile(new URL("../src/features/ResidentConference.jsx", import.meta.url), "utf8");
  assert.match(conference, /Export PowerPoint ตามรายการ/);
  // the deck follows the saved agenda (included cases, in the chosen order), not "every case of the week"
  assert.match(conference, /exportWeekDeck\(\{ start: range\.from, end: range\.to \}, included, people\)/);
});

test("a case never produces a History & Examination slide, even if old rows still carry clinical columns", () => {
  const legacy = { ...row, present_illness: "ปวดท้อง 2 ชั่วโมง", bp_systolic: 100, bp_diastolic: 60, heart_rate: 120, physical_exam: "Board-like rigidity" };
  const slides = buildCaseSlides(legacy, { people, media: [] });
  assert.deepEqual(slides.map((slide) => slide.kind), ["case"]);
  assert.ok(!JSON.stringify(slides).match(/ปวดท้อง 2 ชั่วโมง|Board-like|Vital signs|History & Examination/));
});
