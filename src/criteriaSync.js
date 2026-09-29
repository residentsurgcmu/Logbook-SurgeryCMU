// Signed assessments point at a criterion row by id, so a row's text must never
// change once it exists. The catalog sync therefore only retires rows (keeps
// their text and scores) and inserts new ones; it never edits text in place.

// Whitespace and Unicode form are not real edits to a criterion.
export function normalizeCriterionText(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

// Compares the active rows stored for one template against its source
// criteria. A row is kept only if its code, text and sort order all match;
// anything else is retired and (when the source still has that code) re-created,
// so active codes and sort orders never collide.
export function planCriteriaSync(existingRows, sourceCriteria) {
  const active = existingRows.filter((row) => row.active !== false);
  const byCode = new Map(active.map((row) => [row.criterion_code, row]));
  const sourceCodes = new Set(sourceCriteria.map((criterion) => criterion.code));
  const plan = { retire: [], insert: [], update: [] };

  for (const row of active) {
    if (!sourceCodes.has(row.criterion_code)) plan.retire.push(row.id);
  }
  for (const criterion of sourceCriteria) {
    const current = byCode.get(criterion.code);
    const same =
      current &&
      normalizeCriterionText(current.criterion_text) === normalizeCriterionText(criterion.label) &&
      current.sort_order === criterion.sortOrder;
    if (same) {
      if (current.section_title !== criterion.section) {
        plan.update.push({ id: current.id, section_title: criterion.section });
      }
      continue;
    }
    if (current) plan.retire.push(current.id);
    plan.insert.push({
      criterion_code: criterion.code,
      section_title: criterion.section,
      criterion_text: normalizeCriterionText(criterion.label),
      sort_order: criterion.sortOrder,
      active: true,
    });
  }
  return plan;
}
