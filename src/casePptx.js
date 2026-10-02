// PowerPoint export for admission cases. Slide building is pure (tested in Node);
// pptxgenjs is loaded only when the user actually exports.
import { caseSexLabel, caseStatusLabel, formatVitals } from "./residentCases.js";

const FONT = "Tahoma"; // ships with Windows and macOS and renders Thai
const GREEN = "155426";
const MUTED = "637168";
const NOTES_PER_SLIDE = 6;
const SLIDE = { w: 13.333, h: 7.5 };

const thaiDate = (iso) =>
  iso ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(`${iso}T12:00:00+07:00`)) : "—";
const thaiDateTime = (value) =>
  value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
const nameOf = (people, id) => people.find((person) => person.user_id === id)?.full_name || "ไม่ทราบชื่อ";

export function buildCaseSlides(row, { people = [], media = [], notes = [], includeNotes = false } = {}) {
  const title = `${row.case_code} · ${row.diagnosis}`;
  const slides = [{
    kind: "case",
    title,
    lines: [
      ["Diagnosis", row.diagnosis],
      ["อายุ / เพศ", `${row.age_years} ปี · ${caseSexLabel(row.sex)}`],
      ["หน่วย", row.unit_name],
      ["วันที่รับ", thaiDate(row.admit_date)],
      ["Management", row.management || "ยังไม่ระบุ"],
      ["Operation", row.operation || "ยังไม่ระบุ"],
      ["สถานะ", caseStatusLabel(row.status)],
      ["Owner", nameOf(people, row.owner_id)],
    ],
  }];
  const vitals = formatVitals(row);
  if (row.present_illness || vitals || row.physical_exam) {
    slides.push({
      kind: "clinical",
      title: `History & Examination · ${row.case_code}`,
      lines: [
        ["Present illness", row.present_illness || "ยังไม่ระบุ"],
        ["Vital signs", vitals || "ยังไม่ระบุ"],
        ["Physical examination", row.physical_exam || "ยังไม่ระบุ"],
      ],
    });
  }
  media.forEach((item, index) => {
    if (item.image) slides.push({ kind: "image", title, caption: item.caption || `ภาพที่ ${index + 1}`, image: item.image });
  });
  if (includeNotes) {
    for (let start = 0; start < notes.length; start += NOTES_PER_SLIDE) {
      slides.push({
        kind: "notes",
        title: `ข้ออภิปราย · ${row.case_code}`,
        items: notes.slice(start, start + NOTES_PER_SLIDE).map((note) => ({
          author: nameOf(people, note.author_id),
          time: thaiDateTime(note.created_at),
          body: note.body,
        })),
      });
    }
  }
  return slides;
}

export function buildWeekSlides({ week, people = [], cases = [] }) {
  return [
    { kind: "cover", title: "Friday case conference", subtitle: `${thaiDate(week.start)} – ${thaiDate(week.end)} · ${cases.length} เคส` },
    ...cases.flatMap(({ row, media, notes }) => buildCaseSlides(row, { people, media, notes, includeNotes: true })),
  ];
}

const round = (value) => Math.round(value * 10000) / 10000;
// Largest size that fits the box without distortion, centred in it (inches).
export function fitImage(imageWidth, imageHeight, boxWidth, boxHeight, x, y) {
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  const w = imageWidth * scale;
  const h = imageHeight * scale;
  return { x: round(x + (boxWidth - w) / 2), y: round(y + (boxHeight - h) / 2), w: round(w), h: round(h) };
}

export const deckFileName = ({ caseCode, weekStart }) => (caseCode ? `${caseCode}.pptx` : `Conference-${weekStart}.pptx`);

function addTitle(slide, text) {
  slide.addText(text, { x: 0.5, y: 0.3, w: SLIDE.w - 1, h: 0.8, fontFace: FONT, fontSize: 24, bold: true, color: GREEN, fit: "shrink" });
  slide.addShape("line", { x: 0.5, y: 1.15, w: SLIDE.w - 1, h: 0, line: { color: GREEN, width: 1.5 } });
}

export function renderSlides(pptx, slides) {
  pptx.layout = "LAYOUT_WIDE";
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  for (const spec of slides) {
    const slide = pptx.addSlide();
    if (spec.kind === "cover") {
      slide.background = { color: GREEN };
      slide.addText(spec.title, { x: 0.8, y: 2.4, w: SLIDE.w - 1.6, h: 1.2, fontFace: FONT, fontSize: 40, bold: true, color: "FFFFFF" });
      slide.addText(spec.subtitle, { x: 0.8, y: 3.6, w: SLIDE.w - 1.6, h: 0.8, fontFace: FONT, fontSize: 22, color: "FFFFFF" });
      slide.addText("ภาควิชาศัลยศาสตร์ · ห้ามบันทึกข้อมูลระบุตัวผู้ป่วย", { x: 0.8, y: 6.5, w: SLIDE.w - 1.6, h: 0.5, fontFace: FONT, fontSize: 14, color: "DDEEE2" });
      continue;
    }
    addTitle(slide, spec.title);
    if (spec.kind === "case" || spec.kind === "clinical") {
      slide.addTable(
        spec.lines.map(([label, value]) => [
          { text: label, options: { bold: true, color: MUTED } },
          { text: String(value ?? "") },
        ]),
        { x: 0.5, y: 1.4, w: SLIDE.w - 1, colW: [2.6, SLIDE.w - 3.6], fontFace: FONT, fontSize: 16, color: "15231A", valign: "top", border: { type: "solid", pt: 0.5, color: "DBE5DD" } },
      );
    } else if (spec.kind === "image") {
      slide.addImage({ data: spec.image.data, ...fitImage(spec.image.width, spec.image.height, SLIDE.w - 1, 5.4, 0.5, 1.35) });
      slide.addText(spec.caption, { x: 0.5, y: 6.85, w: SLIDE.w - 1, h: 0.45, fontFace: FONT, fontSize: 14, color: MUTED, align: "center" });
    } else if (spec.kind === "notes") {
      slide.addText(
        spec.items.flatMap((item) => [
          { text: `${item.author} · ${item.time}`, options: { bold: true, color: MUTED, fontSize: 13, breakLine: true } },
          { text: item.body, options: { color: "15231A", fontSize: 16, breakLine: true, paraSpaceAfter: 10 } },
        ]),
        { x: 0.5, y: 1.4, w: SLIDE.w - 1, h: 5.7, fontFace: FONT, valign: "top", fit: "shrink" },
      );
    }
  }
  return pptx;
}

// Browser only: fetch a signed image URL as a data URL plus its pixel size.
export async function loadSlideImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close?.();
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { data, width, height };
}

// An image that cannot be loaded is left out (image: null) instead of failing the whole deck.
export const withSlideImages = (media) =>
  Promise.all(media.map(async (item) => ({ ...item, image: item.url ? await loadSlideImage(item.url).catch(() => null) : null })));

export async function downloadDeck(fileName, slides) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  renderSlides(pptx, slides);
  await pptx.writeFile({ fileName });
}
