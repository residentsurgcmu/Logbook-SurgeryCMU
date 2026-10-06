// Client side mirror of the EPA/PBA attempt rules. The database function submit_resident_assessment_request is
// the authority; these helpers only explain the rules before the user presses "send" and translate the database's
// refusals into Thai. If a rule here and the database ever disagree, the database wins.
const BANGKOK = "Asia/Bangkok";

export const bangkokDate = (value = new Date()) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: BANGKOK });

// The academic year starts on 1 July (Bangkok time).
export function academicYearStart(value = new Date()) {
  const [year, month] = bangkokDate(value).split("-").map(Number);
  return `${month < 7 ? year - 1 : year}-07-01`;
}
const nextAcademicYearStart = (start) => `${Number(start.slice(0, 4)) + 1}-07-01`;
const inAcademicYear = (value, start) => {
  if (!value) return false;
  const day = bangkokDate(value);
  return day >= start && day < nextAcademicYearStart(start);
};
export const thaiDate = (iso) =>
  iso
    ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: BANGKOK }).format(
        new Date(`${iso}T12:00:00+07:00`),
      )
    : "—";

// The level a single assessment must reach: every criterion at L4 or L5 (M or E for the F/M/E forms).
export function levelThreshold(template) {
  if (!template || template.template_type !== "EPA" || template.template_code === "EPA-8") return null;
  const options = template.score_options || [];
  const label = options.includes("L5") ? "L4" : "M";
  return { label, rank: options.indexOf(label) + 1, options };
}

// Criteria of ONE assessment that are below the threshold. rows: resident_assessment_scores of that assessment.
export function criteriaBelowLevel(template, rows = [], criteria = []) {
  const threshold = levelThreshold(template);
  if (!threshold) return null;
  const textById = new Map(criteria.map((criterion) => [criterion.id, criterion.criterion_text]));
  const below = rows
    .filter((row) => threshold.options.indexOf(row.score) + 1 < threshold.rank)
    .map((row) => ({
      id: row.criterion_id,
      text: textById.get(row.criterion_id) || "",
      score: row.score,
      order: criteria.find((criterion) => criterion.id === row.criterion_id)?.sort_order ?? 0,
    }))
    .sort((a, b) => a.order - b.order);
  return { threshold: threshold.label, below, reached: rows.length > 0 && below.length === 0 };
}

export function evaluateRequestRules({ template, requests = [], progress = null, staffId = "", staff = [], now = new Date() }) {
  const reasons = [];
  const warnings = [];
  if (!template) return { reasons, warnings, attempt: null };
  const today = bangkokDate(now);
  const yearStart = academicYearStart(now);
  const past = requests.filter((item) => item.template_id === template.id && item.status !== "cancelled");
  const used = progress ? progress.attempts_used : past.length;
  const cap = progress && progress.attempts_cap != null ? progress.attempts_cap : (template.max_attempts ?? null);
  const perYear = template.max_attempts_per_year ?? null;
  const yearUsed = progress
    ? progress.attempts_this_year
    : past.filter((item) => inAcademicYear(item.submitted_at, yearStart)).length;
  const isEpa = template.template_type === "EPA";
  if (cap != null && used >= cap)
    reasons.push({
      code: "limit",
      text:
        `ใช้ครบ ${cap} ครั้งแล้วสำหรับแบบนี้` +
        (isEpa && progress && !progress.met
          ? " และยังไม่ถึงเกณฑ์ → ปรึกษาผู้อำนวยการหลักสูตรเพื่อพิจารณาเพิ่มจำนวนครั้ง"
          : ""),
    });
  if (template.template_type === "PBA" && past.length > 0)
    reasons.push({ code: "pba-repeat", text: "เรื่องนี้ส่งไปแล้ว PBA ไม่สอบเรื่องซ้ำ" });
  if (perYear != null && yearUsed >= perYear)
    reasons.push({
      code: "per-year",
      text: `ปีการศึกษานี้ส่งแบบนี้แล้ว (แบบเดียวกันส่งได้ ${perYear} ครั้งต่อปีการศึกษา ปีใหม่เริ่ม 1 ก.ค.)`,
    });
  const chosen = staff.find((person) => person.user_id === staffId);
  if (chosen?.unavailable_until && chosen.unavailable_until >= today)
    reasons.push({
      code: "unavailable",
      text: `${chosen.full_name} แจ้งไม่สะดวกรับการประเมินถึง ${thaiDate(chosen.unavailable_until)} กรุณาเลือก Staff ท่านอื่น`,
    });
  if (chosen && past.some((item) => item.staff_id === staffId && item.status === "completed"))
    warnings.push({
      code: "same-staff-before",
      text: "Staff ท่านนี้เคยประเมินแบบนี้ให้คุณมาก่อน (ข้ามปีการศึกษาทำได้ เพื่อดูพัฒนาการ)",
    });
  const thisYear = requests.filter((item) => item.status !== "cancelled" && inAcademicYear(item.submitted_at, yearStart));
  if (
    chosen &&
    thisYear.length >= 3 &&
    thisYear.filter((item) => item.staff_id === staffId).length / thisYear.length >= 0.6
  )
    warnings.push({
      code: "variety",
      text: "ปีนี้คุณส่งให้ Staff ท่านนี้เป็นส่วนใหญ่ ลองหลากหลายท่านขึ้นก็ได้ (เป็นแค่คำแนะนำ ไม่บล็อก)",
    });
  if (isEpa && progress?.met)
    warnings.push({
      code: "already-met",
      text: "แบบนี้ถึงเกณฑ์แล้ว ไม่จำเป็นต้องส่งเพิ่ม (ส่งได้ถ้ายังเหลือครั้งและอยากดูพัฒนาการ)",
    });
  return { reasons, warnings, attempt: { number: used + 1, cap, perYear, yearUsed } };
}

export function friendlyAssessmentError(message = "") {
  const text = String(message);
  const unavailable = text.match(/not accepting assessments until (\d{4}-\d{2}-\d{2})/);
  if (unavailable) return `Staff ท่านนี้แจ้งไม่สะดวกรับการประเมินถึง ${thaiDate(unavailable[1])} กรุณาเลือก Staff ท่านอื่น`;
  if (/already requested this academic year/.test(text))
    return "ปีการศึกษานี้ส่งแบบนี้แล้ว (แบบเดียวกันส่งได้ 1 ครั้งต่อปีการศึกษา ปีใหม่เริ่ม 1 ก.ค.)";
  if (/attempt limit reached/.test(text)) return "ใช้ครบจำนวนครั้งของแบบนี้แล้ว หากยังไม่ถึงเกณฑ์ ให้ปรึกษาผู้อำนวยการหลักสูตร";
  if (/PBA topic was already requested/.test(text)) return "เรื่องนี้ส่งไปแล้ว PBA ไม่สอบเรื่องซ้ำ";
  if (/already has a pending request/.test(text)) return "แบบนี้มีคำขอที่รอประเมินอยู่แล้ว";
  return text;
}
