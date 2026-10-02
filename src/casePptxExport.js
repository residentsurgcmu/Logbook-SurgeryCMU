import { buildCaseSlides, buildWeekSlides, deckFileName, downloadDeck, withSlideImages } from "./casePptx";
import { loadCaseMedia, loadCaseNotes } from "./residentCasesApi";

const missingImages = (media) => media.filter((item) => !item.image).length;

// Returns how many images could not be included.
export async function exportCaseDeck(row, people) {
  const media = await withSlideImages(await loadCaseMedia(row.id));
  await downloadDeck(deckFileName({ caseCode: row.case_code }), buildCaseSlides(row, { people, media }));
  return missingImages(media);
}

export async function exportWeekDeck(week, rows, people) {
  const cases = [];
  for (const row of rows) {
    const [media, notes] = await Promise.all([loadCaseMedia(row.id).then(withSlideImages), loadCaseNotes(row.id)]);
    cases.push({ row, media, notes });
  }
  await downloadDeck(deckFileName({ weekStart: week.start }), buildWeekSlides({ week, people, cases }));
  return cases.reduce((total, item) => total + missingImages(item.media), 0);
}
