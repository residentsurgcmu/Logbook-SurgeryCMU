export const XRAY_AXES = ["Gen", "MIS", "UGI", "Colo", "HBP", "B&E", "Vas", "Trauma"];

const unitNames = {
  UGI: ["ugi", "uppergi", "uppergastrointestinal"],
  Colo: ["colo", "colorectal"],
  HBP: ["hbp", "hpb", "hepatobiliary", "hepatopancreatobiliary", "hepatobiliarypancreatic"],
  "B&E": ["be", "bande", "breastendocrine", "breastandendocrine"],
  Vas: ["vas", "vascular", "vascularsurgery"],
  Trauma: ["trauma", "traumasurgery"],
};

function axisForPart(name) {
  // Match the entire approved alias. A trailing 1–4 may be part of a named section (e.g. UGI1).
  const key = String(name ?? "").normalize("NFKC").toLowerCase().replace(/[\s&/+_.-]+/g, "").replace(/[1-4]$/, "");
  return XRAY_AXES.find((axis) => unitNames[axis]?.includes(key));
}

export function buildMySpaceXray(rows, residentId) {
  const own = residentId ? rows.filter((r) => r.resident_id === residentId && r.exam_type === "xray_anatomy") : [];
  const latest = [...own].sort((a, b) => b.exam_date.localeCompare(a.exam_date) || a.exam_id.localeCompare(b.exam_id))[0];
  if (!latest) return null;
  const sections = new Map();
  let unmapped = 0;
  for (const row of own) {
    if (row.exam_id !== latest.exam_id || row.revision_id !== latest.revision_id) continue;
    const axis = axisForPart(row.part_name);
    if (!axis) { unmapped++; continue; }
    if (!sections.has(axis)) sections.set(axis, []);
    sections.get(axis).push(row);
  }
  const axes = XRAY_AXES.map((axis) => {
    const parts = sections.get(axis) ?? [];
    if (!parts.length) return { axis, value: null, reason: "unmapped" };
    if (parts.some((row) => row.value_state === "absent")) return { axis, value: null, reason: "absent" };
    if (parts.some((row) => row.value_state !== "scored")) return { axis, value: null, reason: "awaiting" };
    if (parts.some(({ max_score, score }) => !Number.isFinite(max_score) || max_score <= 0 || !Number.isFinite(score) || score < 0 || score > max_score)) {
      return { axis, value: null, reason: "invalid" };
    }
    const score = parts.reduce((sum, row) => sum + row.score, 0);
    const max = parts.reduce((sum, row) => sum + row.max_score, 0);
    return { axis, score, max, value: 100 * score / max };
  });
  return { title: latest.title, date: latest.exam_date, axes, unmapped };
}
